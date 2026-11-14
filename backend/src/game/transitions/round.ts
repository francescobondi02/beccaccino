import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { GameError } from "../../utils/gameError";
import { detectCricca } from "../../domain/game/detectCricca";
import { getRng } from "../../utils/random";
import { withRoomLock } from "../../utils/roomLock";
import { logger } from "../../logger";
import { publishRoomChanged } from "../../runtime/eventPublisher";
import { markGameChanged, sendGameState } from "../../services/gameState";
import type { ActionSource } from "../../contract/game";
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
import { nextCallerPlayerId } from "../../domain/game/turnOrder";
import {
  isSameTurn,
  TurnIdentity,
} from "../turn";
import { roundDealRemainingMs } from "../../gameConfig";
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

// expectedBotModel: undefined for the seat owner, null for a timeout, else the bot tier.
export function actionSource(
  expectedBotModel: string | null | undefined,
  chosenByServer: boolean,
): ActionSource {
  if (expectedBotModel === undefined) return "human";
  if (expectedBotModel === null) return "timeout";
  return chosenByServer ? "bot_fallback" : "bot";
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

  const deck = shuffleDeck(generateDeck());
  const cardsPerPlayer = 10;
  const hands = players.map((player, index) => ({
    playerId: player.id,
    cards: deck.slice(index * cardsPerPlayer, (index + 1) * cardsPerPlayer),
  }));

  let callerPlayerId: number | null;
  if (roundNumber === 1) {
    callerPlayerId =
      hands.find((hand) =>
        hand.cards.some(
          (card) => card.suit === Suit.denara && card.value === Value.quattro,
        ),
      )?.playerId ?? null;
  } else {
    const previousRound = await tx.round.findUniqueOrThrow({
      where: { gameRoomId_number: { gameRoomId, number: roundNumber - 1 } },
      select: { callerId: true },
    });
    callerPlayerId = nextCallerPlayerId(players, previousRound.callerId);
  }
  if (callerPlayerId === null) {
    throw new Error("Could not find the briscola caller for this round");
  }

  const round = await tx.round.create({
    data: { number: roundNumber, gameRoomId, callerId: callerPlayerId },
  });
  await tx.handCard.createMany({
    data: hands.flatMap((hand) =>
      hand.cards.map((card) => ({ ...card, playerId: hand.playerId, roundId: round.id })),
    ),
  });

  return {
    gameRoomId,
    roundNumber,
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
        await markGameChanged(tx, gameRoomId);
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
        trickId: null,
        playedCardCount: 0,
      },
      roundDealRemainingMs({
        number: roundSetup.roundNumber,
        createdAt: roundSetup.createdAt,
      }),
    );
    await sendGameState(roomCode, { kind: "game_started" });
    publishRoomChanged(roomCode);
  } catch (error) {
    clearRuntimeRoom(roomCode);
    throw error;
  }
}

export async function setBriscola(args: {
  roomCode: string;
  userId: number;
  suit: Suit;
  /** Set by the timer or bot fallback: the server picked this suit. */
  autoChosen?: boolean;
  /** Bot moves must belong to the same pause/resume generation they started in. */
  expectedPauseEpoch?: number;
  expectedTurn?: TurnIdentity;
  expectedBotModel?: string | null;
}) {
  return withRoomLock(args.roomCode, () => setBriscolaUnlocked(args));
}

async function setBriscolaUnlocked({
  roomCode,
  userId,
  suit,
  autoChosen = false,
  expectedPauseEpoch,
  expectedTurn,
  expectedBotModel,
}: Parameters<typeof setBriscola>[0]) {
  const gameRoom = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: { players: true },
  });
  if (!gameRoom) throw new GameError("Game room not found", 404);

  const player = gameRoom.players.find((p) => p.userId === userId);
  if (!player) throw new GameError("Player not in this game room", 403);
  assertPlayerControl(player, expectedBotModel);
  if (gameRoom.pausedAt) throw new PracticeTurnCancelledError();

  const currentRound = await prisma.round.findFirst({
    where: { gameRoomId: gameRoom.id },
    orderBy: { number: "desc" },
  });
  if (!currentRound) throw new Error("No active round found");
  if (currentRound.briscola !== null)
    throw new GameError("Briscola already set for this round", 400);
  if (
    expectedTurn &&
    !isSameTurn(expectedTurn, {
      roundId: currentRound.id,
      trickId: null,
      playedCardCount: 0,
    })
  ) {
    throw new RuntimeTurnCancelledError();
  }

  if (player.id !== currentRound.callerId) {
    throw new GameError("It's not your turn to choose briscola", 403);
  }

  // Check for Cricca: caller has Tre + Due + Asso of the chosen briscola suit
  const callerCards = await prisma.handCard.findMany({
    where: { playerId: player.id, roundId: currentRound.id },
  });
  const hasCricca = detectCricca(callerCards, suit);

  const firstTrick = await prisma.$transaction(async (tx) => {
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
    await markGameChanged(tx, gameRoom.id);
    return tx.trick.create({
      data: {
        roundId: currentRound.id,
        number: 1,
        starterId: player.id,
      },
    });
  });

  logger.info(
    {
      roomCode,
      roundNumber: currentRound.number,
      callerPlayerId: player.id,
      briscola: suit,
      cricca: hasCricca,
    },
    "briscola_set",
  );

  startRuntimeTurn(
    roomCode,
    userId,
    "play_card",
    gameRoom.pauseEpoch,
    {
      roundId: currentRound.id,
      trickId: firstTrick.id,
      playedCardCount: 0,
    },
  );
  return sendGameState(roomCode, {
    kind: "briscola_chosen",
    userId,
    suit,
    source: actionSource(expectedBotModel, autoChosen),
    takeover: false,
  });
}
