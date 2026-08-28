// src/services/gameService.ts
// This file can be used to implement game-related business logic
// that can be reused across different controllers or parts of the application.

import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { determineHandWinner } from "../utils/determineHandWinner";
import { computePoints } from "../utils/computePoints";
import { cumulativeScore, decideGameWinner } from "../utils/score";
import { detectCricca } from "../utils/detectCricca";
import { getSocketInstance } from "../socketInstance";
import { getRng } from "../utils/random";
import { withRoomLock } from "../utils/roomLock";
import { logger } from "../logger";
import { GAME_WIN_POINTS } from "../gameConfig";
import {
  Card,
  CardSignal,
  Suit,
  SUITS,
  Value,
  VALUES,
} from "../domain/cards";

type GameReadClient = Pick<
  Prisma.TransactionClient,
  "hand" | "playerCard" | "round"
>;

export type TurnDirective =
  | {
      kind: "schedule";
      roomCode: string;
      userId: number;
      phase: "play_card" | "choose_briscola";
      pauseEpoch: number;
    }
  | { kind: "clear"; roomCode: string };

export class PracticeTurnCancelledError extends GameError {
  constructor() {
    super("Practice game is paused", 409);
    this.name = "PracticeTurnCancelledError";
  }
}

async function claimPracticeTransition(
  tx: Prisma.TransactionClient,
  room: { id: number; isPractice: boolean },
  expectedPauseEpoch?: number,
): Promise<void> {
  if (!room.isPractice) return;

  const claim = await tx.gameRoom.updateMany({
    where: {
      id: room.id,
      pausedAt: null,
      ...(expectedPauseEpoch === undefined
        ? {}
        : { pauseEpoch: expectedPauseEpoch }),
    },
    data: { lastActivityAt: new Date() },
  });
  if (claim.count !== 1) {
    throw new PracticeTurnCancelledError();
  }
}

/** Seat `offset` positions clockwise from `seat`, wrapping around the 4-seat table. */
export function seatAfter(seat: number, offset = 1): number {
  return (seat + offset) % 4;
}

/**
 * The briscola caller leads the round's first hand, so the previous round's
 * first-hand starter identifies the previous caller; the next caller sits one
 * seat clockwise. Null when the rotation cannot be resolved.
 */
function callerAfter(
  players: { id: number; seat: number | null }[],
  previousCallerId: number,
): number | null {
  const previous = players.find((p) => p.id === previousCallerId);
  if (!previous || previous.seat === null) return null;
  const nextSeat = seatAfter(previous.seat);
  return players.find((p) => p.seat === nextSeat)?.id ?? null;
}

/**
 * Which player calls briscola for `round`: round 1 goes to the holder of the
 * quattro di denara, later rounds rotate one seat clockwise from the previous
 * caller.
 */
export async function resolveCaller(
  round: { id: number; number: number; gameRoomId: number },
  players: { id: number; seat: number | null }[],
  client: GameReadClient = prisma,
): Promise<number | null> {
  if (round.number === 1) {
    const quattroDenara = await client.playerCard.findFirst({
      where: { roundId: round.id, suit: "denara", value: "quattro" },
    });
    return quattroDenara?.playerId ?? null;
  }

  const previousRound = await client.round.findFirst({
    where: { gameRoomId: round.gameRoomId, number: round.number - 1 },
    include: { hands: { orderBy: { number: "asc" }, take: 1 } },
  });
  const previousCallerId = previousRound?.hands[0]?.starterId;
  return previousCallerId === undefined
    ? null
    : callerAfter(players, previousCallerId);
}

/**
 * Whose turn the game state should report, mirroring how playCard advances
 * play: the caller until briscola is chosen, then the next seat within an
 * open hand, then the completed hand's winner.
 */
export async function resolveCurrentTurnUserId(
  round: { id: number; briscola: string | null },
  players: { id: number; userId: number; seat: number | null }[],
  callerUserId: number | null,
  client: GameReadClient = prisma,
): Promise<number | null> {
  if (round.briscola === null) return callerUserId;

  const lastHand = await client.hand.findFirst({
    where: { roundId: round.id },
    orderBy: { number: "desc" },
    include: { cards: { orderBy: { position: "asc" } } },
  });
  if (!lastHand) return callerUserId;

  if (lastHand.cards.length < 4) {
    const starter = players.find((p) => p.id === lastHand.starterId);
    if (!starter || starter.seat === null) return null;
    const nextSeat = seatAfter(starter.seat, lastHand.cards.length);
    return players.find((p) => p.seat === nextSeat)?.userId ?? null;
  }

  if (lastHand.winnerId) {
    return players.find((p) => p.id === lastHand.winnerId)?.userId ?? null;
  }
  return null;
}

function generateDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value });
    }
  }
  return deck;
}

function shuffleDeck<T>(deck: T[]): T[] {
  const rng = getRng();
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function setupRound(
  gameRoomId: number,
  roundNumber: number,
  tx?: Prisma.TransactionClient,
) {
  if (tx) {
    return setupRoundTx(tx, gameRoomId, roundNumber);
  }

  const result = await prisma.$transaction((client) =>
    setupRoundTx(client, gameRoomId, roundNumber),
  );
  logRoundSetup(result);
  return result;
}

type RoundSetupResult = {
  gameRoomId: number;
  roundNumber: number;
  roundId: number;
  callerPlayerId: number;
};

function logRoundSetup(result: RoundSetupResult): void {
  logger.info(result, "round_setup");
}

async function setupRoundTx(
  tx: Prisma.TransactionClient,
  gameRoomId: number,
  roundNumber: number,
): Promise<RoundSetupResult> {
  if (roundNumber === 1) {
    await tx.player.updateMany({
      where: { gameRoomId },
      data: { seat: null },
    });
  }

  const players = await tx.player.findMany({
    where: { gameRoomId },
    orderBy: [{ seat: "asc" }, { id: "asc" }],
  });

  if (players.length !== 4) {
    throw new Error("There must be exactly 4 players to start the game");
  }

  // Partners occupy opposite seats.
  if (roundNumber === 1) {
    const team0 = players.filter((p) => p.team === 0);
    const team1 = players.filter((p) => p.team === 1);
    if (team0.length !== 2 || team1.length !== 2) {
      throw new Error("Teams must be complete with 2 players each");
    }

    const seatAssignments = [
      team0[0], // Seat 0
      team1[0], // Seat 1
      team0[1], // Seat 2
      team1[1], // Seat 3
    ];

    for (let seat = 0; seat < 4; seat++) {
      await tx.player.update({
        where: { id: seatAssignments[seat].id },
        data: { seat },
      });
    }
  }

  const previousRound = await tx.round.findFirst({
    where: { gameRoomId, number: roundNumber - 1 },
    include: { hands: { orderBy: { number: "asc" } } },
  });

  const newRoundNumber = previousRound ? previousRound.number + 1 : 1;

  let starterId: number;

  const round = await tx.round.create({
    data: {
      number: newRoundNumber,
      briscola: null,
      gameRoomId: gameRoomId,
    },
  });

  const deck = shuffleDeck(generateDeck());

  const cardsPerPlayer = 10;
  let playerWithQuattroDenara: number | null = null;
  for (let i = 0; i < players.length; i++) {
    const playerId = players[i].id;
    const handCards = deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer);

    if (
      handCards.some(
        (card) => card.suit === Suit.denara && card.value === Value.quattro,
      )
    ) {
      playerWithQuattroDenara = playerId;
    }

    await tx.playerCard.createMany({
      data: handCards.map((card) => ({
        playerId: playerId,
        suit: card.suit,
        value: card.value,
        roundId: round.id,
      })),
    });
  }

  // Determine the briscola caller for this round
  if (newRoundNumber === 1) {
    starterId = playerWithQuattroDenara!;
  } else {
    const nextCaller = callerAfter(players, previousRound!.hands[0].starterId);
    if (nextCaller === null) {
      throw new Error("Could not rotate briscola caller from previous round");
    }
    starterId = nextCaller;
  }

  return {
    gameRoomId,
    roundNumber: newRoundNumber,
    roundId: round.id,
    callerPlayerId: starterId,
  };
}

/**
 * Announce the game and set up round 1, returning the caller's timer directive.
 *
 * Shared by the lobby ready-up gate and practice-game creation so a game
 * against bots starts on exactly the same path as a game between humans.
 * The caller owns flipping `started` (the lobby needs a conditional flip to
 * settle a race; a fresh practice room does not).
 */
export async function startFirstRound(
  gameRoomId: number,
  roomCode: string,
): Promise<TurnDirective> {
  const { callerUserId, pauseEpoch, roundSetup } = await prisma.$transaction(async (tx) => {
    const claim = await tx.gameRoom.updateMany({
      where: { id: gameRoomId, started: false },
      data: { started: true },
    });
    if (claim.count !== 1) {
      throw new GameError("Game has already started", 409);
    }

    const roundSetup = await setupRound(gameRoomId, 1, tx);
    const room = await tx.gameRoom.findUniqueOrThrow({
      where: { id: gameRoomId },
      select: { pauseEpoch: true },
    });
    const caller = await tx.player.findUnique({
      where: { id: roundSetup.callerPlayerId },
      select: { userId: true },
    });
    if (!caller) throw new Error("Briscola caller not found");

    return {
      callerUserId: caller.userId,
      pauseEpoch: room.pauseEpoch,
      roundSetup,
    };
  });

  logRoundSetup(roundSetup);
  getSocketInstance().to(roomCode).emit("game_started", {});
  return {
    kind: "schedule",
    roomCode,
    userId: callerUserId,
    phase: "choose_briscola",
    pauseEpoch,
  };
}

/**
 * Set briscola for the current round and create the first hand.
 * Extracted as a service so it can be called from both the REST controller and auto-play.
 *
 * Wraps the implementation in a per-room mutex so two simultaneous calls
 * (e.g. caller hitting the button + auto-play timer firing in the same tick)
 * cannot both pass the "briscola === null" check.
 */
export async function setBriscola(args: {
  gameRoomId: number;
  playerId: number;
  suit: Suit;
  /** Set by the timer: the server picked this suit, the caller did not. */
  autoChosen?: boolean;
  /** Bot moves must belong to the same pause/resume generation they started in. */
  expectedPauseEpoch?: number;
}) {
  // We need the roomCode to key the lock. Look it up once; the inner function
  // will re-fetch the full room with players for correctness.
  const room = await prisma.gameRoom.findUnique({
    where: { id: args.gameRoomId },
    select: { code: true },
  });
  if (!room) throw new GameError("Game room not found", 404);
  return withRoomLock(room.code, () => setBriscolaUnlocked(args));
}

async function setBriscolaUnlocked({
  gameRoomId,
  playerId,
  suit,
  autoChosen = false,
  expectedPauseEpoch,
}: {
  gameRoomId: number;
  playerId: number;
  suit: Suit;
  autoChosen?: boolean;
  expectedPauseEpoch?: number;
}) {
  const gameRoom = await prisma.gameRoom.findUnique({
    where: { id: gameRoomId },
    include: { players: true },
  });
  if (!gameRoom) throw new GameError("Game room not found", 404);

  const player = gameRoom.players.find((p) => p.id === playerId);
  if (!player) throw new GameError("Player not in this game room", 403);
  if (gameRoom.pausedAt) throw new PracticeTurnCancelledError();

  const currentRound = await prisma.round.findFirst({
    where: { gameRoomId },
    orderBy: { number: "desc" },
  });
  if (!currentRound) throw new Error("No active round found");
  if (currentRound.briscola !== null)
    throw new GameError("Briscola already set for this round", 400);

  // Verify it's the correct player's turn to choose
  const callerPlayerId = await resolveCaller(currentRound, gameRoom.players);

  if (playerId !== callerPlayerId) {
    throw new GameError("It's not your turn to choose briscola", 403);
  }

  // Check for Cricca: caller has Tre + Due + Asso of the chosen briscola suit
  const callerCards = await prisma.playerCard.findMany({
    where: { playerId, roundId: currentRound.id },
  });
  const hasCricca = detectCricca(callerCards, suit);

  const { updatedRound, firstHand } = await prisma.$transaction(async (tx) => {
    await claimPracticeTransition(tx, gameRoom, expectedPauseEpoch);
    const claim = await tx.round.updateMany({
      where: { id: currentRound.id, briscola: null },
      data: { briscola: suit, cricca: hasCricca, briscolaAutoChosen: autoChosen },
    });
    if (claim.count !== 1) {
      throw new GameError("Briscola already set for this round", 409);
    }
    const firstHand = await tx.hand.create({
      data: {
        roundId: currentRound.id,
        number: 1,
        starterId: playerId,
      },
    });
    const updatedRound = await tx.round.findUniqueOrThrow({
      where: { id: currentRound.id },
    });
    return { updatedRound, firstHand };
  });

  const io = getSocketInstance();
  io.to(gameRoom.code).emit("briscola_chosen", {
    briscola: suit,
    roundNumber: currentRound.number,
    starterId: playerId,
    cricca: hasCricca,
  });

  const callerPlayer = gameRoom.players.find((p) => p.id === playerId);
  if (!callerPlayer) throw new Error("Briscola caller not found");

  logger.info(
    {
      roomCode: gameRoom.code,
      gameRoomId,
      roundNumber: currentRound.number,
      callerPlayerId: playerId,
      briscola: suit,
      cricca: hasCricca,
    },
    "briscola_set",
  );

  return {
    round: updatedRound,
    hand: firstHand,
    roomCode: gameRoom.code,
    turnDirective: {
      kind: "schedule",
      roomCode: gameRoom.code,
      userId: callerPlayer.userId,
      phase: "play_card",
      pauseEpoch: gameRoom.pauseEpoch,
    } satisfies TurnDirective,
  };
}

type PlayedCardInput = {
  handId: number;
  playerId: number;
  suit: Suit;
  value: Value;
  position: number;
  signal: CardSignal | null;
  autoPlayed: boolean;
};

async function persistPlayedCard(
  tx: Prisma.TransactionClient,
  playerCardId: number,
  data: PlayedCardInput,
) {
  await tx.playerCard.delete({ where: { id: playerCardId } });
  return tx.playedCard.create({ data });
}

function publishPlayedCard(args: {
  roomCode: string;
  userId: number;
  playerId: number;
  suit: Suit;
  value: Value;
  position: number;
  handNumber: number;
  roundNumber: number;
  signal: PlayedCardInput["signal"];
}) {
  getSocketInstance().to(args.roomCode).emit("card_played", {
    playerId: args.playerId,
    userId: args.userId,
    suit: args.suit,
    value: args.value,
    position: args.position,
    handNumber: args.handNumber,
    signal: args.signal,
  });
  logger.info(args, "card_played");
}

/**
 * Play a card in the current hand.
 *
 * Wraps the implementation in a per-room mutex so two simultaneous plays
 * (network retry, double-click, manual-play colliding with auto-play timer)
 * cannot both pass the turn / hand-not-full / has-card checks.
 */
export async function playCard(args: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
  signal?: CardSignal | null;
  /** Set by the timer: the server picked this card, the seat's owner did not. */
  autoPlayed?: boolean;
  /** Bot moves must belong to the same pause/resume generation they started in. */
  expectedPauseEpoch?: number;
}) {
  return withRoomLock(args.roomCode, () => playCardUnlocked(args));
}

async function playCardUnlocked({
  roomCode,
  userId,
  suit,
  value,
  signal,
  autoPlayed = false,
  expectedPauseEpoch,
}: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
  signal?: CardSignal | null;
  autoPlayed?: boolean;
  expectedPauseEpoch?: number;
}): Promise<TurnDirective | null> {
  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: true,
      rounds: {
        orderBy: { number: "desc" },
        take: 1,
        include: {
          hands: {
            orderBy: { number: "desc" },
            take: 1,
            include: { cards: { orderBy: { position: "asc" } } },
          },
        },
      },
    },
  });

  if (!room || !room.started)
    throw new GameError("Room not found or game not started", 404);

  if (room.finished) throw new GameError("Game is already finished", 400);
  const player = room.players.find((candidate) => candidate.userId === userId);
  if (!player) throw new GameError("It's not this player's turn", 403);
  if (room.pausedAt) throw new PracticeTurnCancelledError();

  const currentRound = room.rounds[0];
  const currentHand = currentRound?.hands[0];
  if (!currentRound || !currentHand)
    throw new GameError("No active round or hand found", 400);

  const playedCards = currentHand.cards;

  if (playedCards.length >= 4) {
    throw new GameError("Hand is already full", 400);
  }

  const seatOrder = Array.from({ length: 4 }, (_, i) =>
    seatAfter(
      room.players.find((p) => p.id === currentHand.starterId)!.seat!,
      i,
    ),
  );
  const currentTurnPlayer = room.players.find(
    (p) => p.seat === seatOrder[playedCards.length],
  );
  if (!currentTurnPlayer || currentTurnPlayer.userId !== userId)
    throw new GameError("It's not this player's turn", 403);

  const playerCard = await prisma.playerCard.findFirst({
    where: {
      playerId: player.id,
      suit,
      value,
      roundId: currentRound.id,
    },
  });

  if (!playerCard) throw new GameError("Player does not have this card", 400);

  const leadCard = playedCards.find((card) => card.position === 0);
  if (leadCard && suit !== leadCard.suit) {
    const hasLeadSuit = await prisma.playerCard.findFirst({
      where: {
        playerId: player.id,
        roundId: currentRound.id,
        suit: leadCard.suit,
      },
      select: { id: true },
    });
    if (hasLeadSuit) {
      throw new GameError("Player must follow suit", 400);
    }
  }

  // Only the trick leader (position 0) can declare a signal
  const validSignal =
    playedCards.length === 0 && signal ? signal : null;
  const position = playedCards.length;
  const playedCardData: PlayedCardInput = {
    handId: currentHand.id,
    playerId: player.id,
    suit,
    value,
    position,
    signal: validSignal,
    autoPlayed,
  };
  const publish = () =>
    publishPlayedCard({
      roomCode,
      userId,
      playerId: player.id,
      suit,
      value,
      position,
      handNumber: currentHand.number,
      roundNumber: currentRound.number,
      signal: validSignal,
    });

  if (position < 3) {
    await prisma.$transaction(async (tx) => {
      await claimPracticeTransition(tx, room, expectedPauseEpoch);
      await persistPlayedCard(tx, playerCard.id, playedCardData);
    });
    publish();

    const nextPlayer = room.players.find(
      (candidate) => candidate.seat === seatOrder[position + 1],
    );
    return nextPlayer
      ? {
          kind: "schedule",
          roomCode,
          userId: nextPlayer.userId,
          phase: "play_card",
          pauseEpoch: room.pauseEpoch,
        }
      : null;
  }

  const winnerPlayerId = determineHandWinner(
    [...playedCards, playedCardData],
    currentRound.briscola,
  );

  if (currentHand.number < 10) {
    await prisma.$transaction(async (tx) => {
      await claimPracticeTransition(tx, room, expectedPauseEpoch);
      await persistPlayedCard(tx, playerCard.id, playedCardData);
      await tx.hand.update({
        where: { id: currentHand.id },
        data: { winnerId: winnerPlayerId },
      });
      await tx.hand.create({
        data: {
          roundId: currentRound.id,
          number: currentHand.number + 1,
          starterId: winnerPlayerId,
        },
      });
    });
    publish();

    const winnerPlayer = room.players.find((p) => p.id === winnerPlayerId);
    return winnerPlayer
      ? {
          kind: "schedule",
          roomCode,
          userId: winnerPlayer.userId,
          phase: "play_card",
          pauseEpoch: room.pauseEpoch,
        }
      : null;
  }

  const allHands = await prisma.hand.findMany({
    where: { roundId: currentRound.id },
    orderBy: { number: "asc" },
    include: { cards: { orderBy: { position: "asc" } } },
  });
  const teamPlayers: Record<number, number> = {};
  for (const roomPlayer of room.players) {
    if (roomPlayer.team !== null) {
      teamPlayers[roomPlayer.id] = roomPlayer.team;
    }
  }

  const scores = computePoints(
    allHands.map((hand) => ({
      winnerId:
        hand.id === currentHand.id ? winnerPlayerId : hand.winnerId,
      cards: [
        ...hand.cards.map((card) => ({
          value: card.value,
          suit: card.suit,
          playerId: card.playerId,
        })),
        ...(hand.id === currentHand.id
          ? [{ value, suit, playerId: player.id }]
          : []),
      ],
    })),
    teamPlayers,
    currentRound.briscola!,
  );

  if (currentRound.cricca) {
    const callerTeam = teamPlayers[allHands[0].starterId];
    if (callerTeam === 0) scores.team0.points += 3;
    if (callerTeam === 1) scores.team1.points += 3;
  }

  let winnerTeam: number;
  if (scores.team0.points !== scores.team1.points) {
    winnerTeam = scores.team0.points > scores.team1.points ? 0 : 1;
  } else if (scores.team0.figures !== scores.team1.figures) {
    winnerTeam = scores.team0.figures > scores.team1.figures ? 0 : 1;
  } else {
    winnerTeam = 0;
  }

  const previousCompletedRounds = await prisma.round.findMany({
    where: {
      gameRoomId: room.id,
      id: { not: currentRound.id },
      winnerTeam: { not: null },
    },
    select: {
      team0Points: true,
      team1Points: true,
      team0Figures: true,
      team1Figures: true,
      winnerTeam: true,
    },
  });
  const allCompletedRounds = [
    ...previousCompletedRounds,
    {
      team0Points: scores.team0.points,
      team1Points: scores.team1.points,
      team0Figures: scores.team0.figures,
      team1Figures: scores.team1.figures,
      winnerTeam,
    },
  ];
  const total = cumulativeScore(allCompletedRounds);
  const callerTeam = teamPlayers[allHands[0].starterId];
  if (callerTeam !== 0 && callerTeam !== 1) {
    throw new Error("Round caller has no valid team");
  }
  const finalWinnerTeam = decideGameWinner(
    total,
    GAME_WIN_POINTS,
    callerTeam,
  );

  const nextRound = await prisma.$transaction(async (tx) => {
    await claimPracticeTransition(tx, room, expectedPauseEpoch);
    await persistPlayedCard(tx, playerCard.id, playedCardData);
    await tx.hand.update({
      where: { id: currentHand.id },
      data: { winnerId: winnerPlayerId },
    });
    await tx.round.update({
      where: { id: currentRound.id },
      data: {
        team0Points: scores.team0.points,
        team1Points: scores.team1.points,
        team0Figures: scores.team0.figures,
        team1Figures: scores.team1.figures,
        winnerTeam,
      },
    });
    if (finalWinnerTeam !== null) {
      await tx.gameRoom.update({
        where: { id: room.id },
        data: {
          finished: true,
        },
      });
    }
    if (finalWinnerTeam !== null) {
      return null;
    }
    return setupRound(room.id, currentRound.number + 1, tx);
  });

  if (nextRound) logRoundSetup(nextRound);
  publish();
  const io = getSocketInstance();
  io.to(roomCode).emit("round_ended", {
    roundNumber: currentRound.number,
    team0: scores.team0,
    team1: scores.team1,
    winnerTeam,
    cricca: currentRound.cricca,
  });
  logger.info(
    {
      roomCode,
      roundNumber: currentRound.number,
      team0Points: scores.team0.points,
      team1Points: scores.team1.points,
      team0Figures: scores.team0.figures,
      team1Figures: scores.team1.figures,
      winnerTeam,
      cricca: currentRound.cricca,
    },
    "round_ended",
  );

  if (finalWinnerTeam !== null) {
    const totalRounds = allCompletedRounds.length;
    const team0Wins = allCompletedRounds.filter(
      (round) => round.winnerTeam === 0,
    ).length;
    io.to(roomCode).emit("game_finished", {
      winnerTeam: finalWinnerTeam,
      totalRounds,
      finalScores: {
        team0: total.team0.points,
        team1: total.team1.points,
      },
      roundsWon: {
        team0: team0Wins,
        team1: totalRounds - team0Wins,
      },
    });
    logger.info(
      {
        roomCode,
        winnerTeam: finalWinnerTeam,
        totalRounds,
        totalTeam0Points: total.team0.points,
        totalTeam1Points: total.team1.points,
      },
      "game_finished",
    );
    return { kind: "clear", roomCode };
  }

  const newCaller = room.players.find(
    (p) => p.id === nextRound!.callerPlayerId,
  );
  io.to(roomCode).emit("new_round_started", {
    roundId: nextRound!.roundId,
    roundNumber: nextRound!.roundNumber,
    callerUserId: newCaller?.userId ?? null,
  });
  return newCaller
    ? {
        kind: "schedule",
        roomCode,
        userId: newCaller.userId,
        phase: "choose_briscola",
        pauseEpoch: room.pauseEpoch,
      }
    : null;
}
