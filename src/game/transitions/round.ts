import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { GameError } from "../../utils/gameError";
import { detectCricca } from "../../domain/game/detectCricca";
import { getRng } from "../../utils/random";
import { withRoomLock } from "../../utils/roomLock";
import { logger } from "../../logger";
import { publishEvents } from "../../runtime/eventPublisher";
import {
  clearRuntimeRoom,
  startRuntimeTurn,
} from "../../runtime/turnRuntime";
import {
  Card,
  Suit,
  SUITS,
  Value,
  VALUES,
} from "../../domain/game/cards";
import {
  resolveCaller as resolveCallerRule,
  nextCallerPlayerId,
} from "../../domain/game/turnOrder";
import {
  isSameTurn,
  TurnIdentity,
} from "../turn";
import { readCallerPlayerId } from "../snapshots/turnState";
import { roundDealPresentation } from "../../gameConfig";
import { BotTier } from "../../services/botUsers";
import { restoreBotSeats } from "../../runtime/botRegistry";

export class PracticeTurnCancelledError extends GameError {
  constructor() {
    super("Practice game is paused", 409);
    this.name = "PracticeTurnCancelledError";
  }
}

export class RuntimeTurnCancelledError extends GameError {
  constructor() {
    super("Runtime turn is no longer current", 409);
    this.name = "RuntimeTurnCancelledError";
  }
}

export function assertPlayerControl(
  player: { botModel: string | null; abandonedAt: Date | null },
  expectedBotModel?: string | null,
): void {
  if (expectedBotModel !== undefined) {
    if (player.botModel !== expectedBotModel) throw new RuntimeTurnCancelledError();
  } else if (player.botModel !== null || player.abandonedAt) {
    throw new GameError("Un bot sta giocando al tuo posto. Riprendi prima il controllo.", 409);
  }
}

export async function claimPracticeTransition(
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

type RoundSetupResult = {
  gameRoomId: number;
  roundNumber: number;
  roundId: number;
  callerPlayerId: number;
  createdAt: Date;
};

export function logRoundSetup(result: RoundSetupResult): void {
  logger.info(result, "round_setup");
}

export async function setupRound(
  gameRoomId: number,
  roundNumber: number,
  tx: Prisma.TransactionClient,
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

  let callerPlayerId: number;

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
    callerPlayerId = playerWithQuattroDenara!;
  } else {
    const nextCaller = resolveCallerRule({
      roundNumber: newRoundNumber,
      previousCaller: previousRound!.hands[0].starterId,
      nextCaller: (caller) => nextCallerPlayerId(players, caller),
    });
    if (nextCaller === null) {
      throw new Error("Could not rotate briscola caller from previous round");
    }
    callerPlayerId = nextCaller;
  }

  return {
    gameRoomId,
    roundNumber: newRoundNumber,
    roundId: round.id,
    callerPlayerId,
    createdAt: round.createdAt,
  };
}

export async function startFirstRound(
  gameRoomId: number,
  roomCode: string,
  multiplayer?: {
    readyPlayerId: number;
    bots: { userId: number; team: number; botModel: BotTier }[];
  },
): Promise<void> {
  try {
    const { callerUserId, pauseEpoch, roundSetup, players } =
      await prisma.$transaction(async (tx) => {
        const claim = await tx.gameRoom.updateMany({
          where: { id: gameRoomId, started: false },
          data: { started: true },
        });
        if (claim.count !== 1) {
          throw new GameError("Game has already started", 409);
        }

        if (multiplayer) {
          await tx.player.update({
            where: { id: multiplayer.readyPlayerId, gameRoomId },
            data: { isReady: true },
          });
          if (multiplayer.bots.length > 0) {
            await tx.player.createMany({
              data: multiplayer.bots.map((bot) => ({
                ...bot,
                gameRoomId,
                isReady: true,
              })),
            });
          }
        }

        const roundSetup = await setupRound(gameRoomId, 1, tx);
        const room = await tx.gameRoom.findUniqueOrThrow({
          where: { id: gameRoomId },
          select: { pauseEpoch: true },
        });
        const players = await tx.player.findMany({
          where: { gameRoomId },
          select: { id: true, userId: true, botModel: true },
        });
        const caller = players.find((player) => player.id === roundSetup.callerPlayerId);
        if (!caller) throw new Error("Briscola caller not found");

        return {
          callerUserId: caller.userId,
          pauseEpoch: room.pauseEpoch,
          roundSetup,
          players,
        };
      });

    logRoundSetup(roundSetup);
    restoreBotSeats(roomCode, players);
    startRuntimeTurn(
      roomCode,
      callerUserId,
      "choose_briscola",
      pauseEpoch,
      {
        roundId: roundSetup.roundId,
        handId: null,
        playedCardCount: 0,
      },
      roundDealPresentation({
        number: roundSetup.roundNumber,
        createdAt: roundSetup.createdAt,
      }).remainingMs,
    );
    publishEvents([
      { target: roomCode, event: "game_started", payload: {} },
      { target: "lobby", event: "room_deleted", payload: { roomCode } },
    ]);
  } catch (error) {
    clearRuntimeRoom(roomCode);
    throw error;
  }
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
  expectedTurn?: TurnIdentity;
  expectedBotModel?: string | null;
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
  expectedTurn,
  expectedBotModel,
}: {
  gameRoomId: number;
  playerId: number;
  suit: Suit;
  autoChosen?: boolean;
  expectedPauseEpoch?: number;
  expectedTurn?: TurnIdentity;
  expectedBotModel?: string | null;
}) {
  const gameRoom = await prisma.gameRoom.findUnique({
    where: { id: gameRoomId },
    include: { players: true },
  });
  if (!gameRoom) throw new GameError("Game room not found", 404);

  const player = gameRoom.players.find((p) => p.id === playerId);
  if (!player) throw new GameError("Player not in this game room", 403);
  assertPlayerControl(player, expectedBotModel);
  if (gameRoom.pausedAt) throw new PracticeTurnCancelledError();

  const currentRound = await prisma.round.findFirst({
    where: { gameRoomId },
    orderBy: { number: "desc" },
  });
  if (!currentRound) throw new Error("No active round found");
  if (currentRound.briscola !== null)
    throw new GameError("Briscola already set for this round", 400);
  if (
    expectedTurn &&
    !isSameTurn(expectedTurn, {
      roundId: currentRound.id,
      handId: null,
      playedCardCount: 0,
    })
  ) {
    throw new RuntimeTurnCancelledError();
  }

  // Verify it's the correct player's turn to choose
  const callerPlayerId = await readCallerPlayerId(
    currentRound,
    gameRoom.players,
  );

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
    if (player.botModel === null) {
      await tx.player.update({
        where: { id: player.id },
        data: { timeoutCount: expectedBotModel === null ? { increment: 1 } : 0 },
      });
    }
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

  publishEvents([
    {
      target: gameRoom.code,
      event: "briscola_chosen",
      payload: {
        briscola: suit,
        roundNumber: currentRound.number,
        starterId: playerId,
        cricca: hasCricca,
      },
    },
  ]);
  startRuntimeTurn(
    gameRoom.code,
    player.userId,
    "play_card",
    gameRoom.pauseEpoch,
    {
      roundId: currentRound.id,
      handId: firstHand.id,
      playedCardCount: 0,
    },
  );
  return {
    round: updatedRound,
    hand: firstHand,
    roomCode: gameRoom.code,
  };
}
