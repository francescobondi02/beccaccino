import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { computeRoundScore, settleRound } from "../../domain/game/roundScore";
import { determineTrickWinner } from "../../domain/game/trickWinner";
import { isLegalCard } from "../../domain/game/legalCards";
import { sumRoundScores, decideGameWinner } from "../../domain/game/gameScore";
import { resolveTurnSeat } from "../../domain/game/turnOrder";
import { CardSignal, Suit, Value } from "../../domain/game/cards";
import { GAME_WIN_POINTS, TRICK_DISPLAY_MS, roundDealRemainingMs } from "../../gameConfig";
import type { GameState, LastAction } from "../../contract/game";
import { logger } from "../../logger";
import {
  clearRuntimeRoom,
  startRuntimeTurn,
} from "../../runtime/turnRuntime";
import { GameError } from "../../utils/gameError";
import { markGameChanged, sendGameState } from "../../services/gameState";
import { withRoomLock } from "../../utils/roomLock";
import {
  actionSource,
  claimPracticeTransition,
  assertPlayerControl,
  logRoundSetup,
  PracticeTurnCancelledError,
  RuntimeTurnCancelledError,
  setupRound,
} from "./round";
import {
  isSameTurn,
  TurnIdentity,
} from "../turn";

type PlayedCardInput = {
  trickId: number;
  playerId: number;
  suit: Suit;
  value: Value;
  position: number;
  signal: CardSignal | null;
  autoPlayed: boolean;
};

async function persistPlayedCard(
  tx: Prisma.TransactionClient,
  handCardId: number,
  data: PlayedCardInput,
  expectedBotModel?: string | null,
) {
  if (expectedBotModel === undefined || expectedBotModel === null) {
    await tx.player.update({
      where: { id: data.playerId },
      data: { timeoutCount: expectedBotModel === null ? { increment: 1 } : 0 },
    });
  }
  await tx.handCard.delete({ where: { id: handCardId } });
  return tx.playedCard.create({ data });
}

export async function playCard(args: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
  signal?: CardSignal | null;
  autoPlayed?: boolean;
  expectedPauseEpoch?: number;
  expectedTurn?: TurnIdentity;
  expectedBotModel?: string | null;
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
  expectedTurn,
  expectedBotModel,
}: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
  signal?: CardSignal | null;
  autoPlayed?: boolean;
  expectedPauseEpoch?: number;
  expectedTurn?: TurnIdentity;
  expectedBotModel?: string | null;
}): Promise<Map<number, GameState>> {
  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: true,
      rounds: {
        orderBy: { number: "desc" },
        take: 1,
        include: {
          tricks: {
            orderBy: { number: "desc" },
            take: 1,
            include: { cards: { orderBy: { position: "asc" } } },
          },
        },
      },
    },
  });

  if (!room || !room.started) {
    throw new GameError("Room not found or game not started", 404);
  }
  if (room.finished) throw new GameError("Game is already finished", 400);

  const player = room.players.find((candidate) => candidate.userId === userId);
  if (!player) throw new GameError("It's not this player's turn", 403);
  assertPlayerControl(player, expectedBotModel);
  if (room.pausedAt) throw new PracticeTurnCancelledError();

  const currentRound = room.rounds[0];
  const currentTrick = currentRound?.tricks[0];
  if (!currentRound || !currentTrick) {
    throw new GameError("No active round or trick found", 400);
  }

  const playedCards = currentTrick.cards;
  if (playedCards.length >= 4) {
    throw new GameError("Trick is already full", 400);
  }
  if (
    expectedTurn &&
    !isSameTurn(expectedTurn, {
      roundId: currentRound.id,
      trickId: currentTrick.id,
      playedCardCount: playedCards.length,
    })
  ) {
    throw new RuntimeTurnCancelledError();
  }

  const starterSeat =
    room.players.find((candidate) => candidate.id === currentTrick.starterId)
      ?.seat ?? null;
  const currentTurnSeat =
    starterSeat === null
      ? null
      : resolveTurnSeat({
          briscolaChosen: true,
          callerSeat: null,
          trick: {
            starterSeat,
            playedCardCount: playedCards.length,
            winnerSeat: null,
          },
        });
  const currentTurnPlayer = room.players.find(
    (candidate) => candidate.seat === currentTurnSeat,
  );
  if (!currentTurnPlayer || currentTurnPlayer.userId !== userId) {
    throw new GameError("It's not this player's turn", 403);
  }

  const cardsInHand = await prisma.handCard.findMany({
    where: {
      playerId: player.id,
      roundId: currentRound.id,
    },
  });
  const handCard = cardsInHand.find(
    (card) => card.suit === suit && card.value === value,
  );
  if (!handCard) throw new GameError("Player does not have this card", 400);

  const leadCard = playedCards.find((card) => card.position === 0);
  if (!isLegalCard(cardsInHand, handCard, leadCard?.suit ?? null)) {
    throw new GameError("Player must follow suit", 400);
  }

  const validSignal =
    playedCards.length === 0 && signal ? signal : null;
  const position = playedCards.length;
  const playedCardData: PlayedCardInput = {
    trickId: currentTrick.id,
    playerId: player.id,
    suit,
    value,
    position,
    signal: validSignal,
    autoPlayed,
  };
  const lastAction: LastAction = {
    kind: "card_played",
    userId,
    card: { suit, value },
    signal: validSignal,
    source: actionSource(expectedBotModel, autoPlayed),
    takeover: false,
  };

  if (position < 3) {
    await prisma.$transaction(async (tx) => {
      await claimPracticeTransition(tx, room, expectedPauseEpoch);
      await persistPlayedCard(tx, handCard.id, playedCardData, expectedBotModel);
      await markGameChanged(tx, room.id);
    });
    logger.info({ roomCode, userId, suit, value, position }, "card_played");

    const nextTurnSeat = resolveTurnSeat({
      briscolaChosen: true,
      callerSeat: null,
      trick: {
        starterSeat: starterSeat!,
        playedCardCount: position + 1,
        winnerSeat: null,
      },
    });
    const nextPlayer = room.players.find(
      (candidate) => candidate.seat === nextTurnSeat,
    );
    if (nextPlayer) {
      startRuntimeTurn(
        roomCode,
        nextPlayer.userId,
        "play_card",
        room.pauseEpoch,
        {
          roundId: currentRound.id,
          trickId: currentTrick.id,
          playedCardCount: position + 1,
        },
      );
    }
    return sendGameState(roomCode, lastAction);
  }

  const trickWinnerPlayerId = determineTrickWinner(
    [...playedCards, playedCardData],
    currentRound.briscola,
  );

  if (currentTrick.number < 10) {
    const nextTrick = await prisma.$transaction(async (tx) => {
      await claimPracticeTransition(tx, room, expectedPauseEpoch);
      await persistPlayedCard(tx, handCard.id, playedCardData, expectedBotModel);
      await markGameChanged(tx, room.id);
      await tx.trick.update({
        where: { id: currentTrick.id },
        data: { winnerId: trickWinnerPlayerId, completedAt: new Date() },
      });
      return tx.trick.create({
        data: {
          roundId: currentRound.id,
          number: currentTrick.number + 1,
          starterId: trickWinnerPlayerId,
        },
      });
    });
    logger.info({ roomCode, userId, suit, value, position }, "card_played");

    const winnerPlayer = room.players.find(
      (candidate) => candidate.id === trickWinnerPlayerId,
    );
    if (winnerPlayer) {
      startRuntimeTurn(
        roomCode,
        winnerPlayer.userId,
        "play_card",
        room.pauseEpoch,
        {
          roundId: currentRound.id,
          trickId: nextTrick.id,
          playedCardCount: 0,
        },
        TRICK_DISPLAY_MS,
      );
    }
    return sendGameState(roomCode, lastAction);
  }

  const allTricks = await prisma.trick.findMany({
    where: { roundId: currentRound.id },
    orderBy: { number: "asc" },
    include: { cards: { orderBy: { position: "asc" } } },
  });
  const playerTeams: Record<number, number> = {};
  for (const roomPlayer of room.players) {
    if (roomPlayer.team !== null) {
      playerTeams[roomPlayer.id] = roomPlayer.team;
    }
  }

  const roundScore = settleRound(computeRoundScore(
    allTricks.map((trick) => ({
      winnerId:
        trick.id === currentTrick.id ? trickWinnerPlayerId : trick.winnerId,
      cards: [
        ...trick.cards.map((card) => ({
          value: card.value,
          suit: card.suit,
          playerId: card.playerId,
        })),
        ...(trick.id === currentTrick.id
          ? [{ value, suit, playerId: player.id }]
          : []),
      ],
    })),
    playerTeams,
    currentRound.briscola!,
  ), currentRound.cricca ? playerTeams[currentRound.callerId] : null);

  const previousCompletedRounds = await prisma.round.findMany({
    where: {
      gameRoomId: room.id,
      id: { not: currentRound.id },
      winnerTeam: { not: null },
    },
    select: { team0Raw: true, team1Raw: true },
  });
  const allCompletedRounds = [...previousCompletedRounds, roundScore];
  const gameScore = sumRoundScores(allCompletedRounds);
  const callerTeam = playerTeams[currentRound.callerId];
  if (callerTeam !== 0 && callerTeam !== 1) {
    throw new Error("Round caller has no valid team");
  }
  const gameWinnerTeam = decideGameWinner(
    gameScore,
    GAME_WIN_POINTS,
    callerTeam,
  );

  const nextRound = await prisma.$transaction(async (tx) => {
    await claimPracticeTransition(tx, room, expectedPauseEpoch);
    await persistPlayedCard(tx, handCard.id, playedCardData, expectedBotModel);
    await markGameChanged(tx, room.id);
    await tx.trick.update({
      where: { id: currentTrick.id },
      data: { winnerId: trickWinnerPlayerId, completedAt: new Date() },
    });
    await tx.round.update({
      where: { id: currentRound.id },
      data: roundScore,
    });
    if (gameWinnerTeam !== null) {
      await tx.gameRoom.update({
        where: { id: room.id },
        data: { finished: true, winnerTeam: gameWinnerTeam },
      });
      return null;
    }
    return setupRound(room.id, currentRound.number + 1, tx);
  });

  if (nextRound) logRoundSetup(nextRound);
  logger.info({ roomCode, userId, suit, value, position }, "card_played");
  logger.info(
    {
      roomCode,
      roundNumber: currentRound.number,
      ...roundScore,
      cricca: currentRound.cricca,
    },
    "round_ended",
  );

  if (gameWinnerTeam !== null) {
    logger.info(
      {
        roomCode,
        winnerTeam: gameWinnerTeam,
        totalRounds: allCompletedRounds.length,
        totalTeam0Points: gameScore.team0.points,
        totalTeam1Points: gameScore.team1.points,
      },
      "game_finished",
    );
    clearRuntimeRoom(roomCode);
    return sendGameState(roomCode, lastAction);
  }

  const newCaller = room.players.find(
    (candidate) => candidate.id === nextRound!.callerPlayerId,
  );
  if (newCaller) {
    startRuntimeTurn(
      roomCode,
      newCaller.userId,
      "choose_briscola",
      room.pauseEpoch,
      {
        roundId: nextRound!.roundId,
        trickId: null,
        playedCardCount: 0,
      },
      roundDealRemainingMs({
        number: nextRound!.roundNumber,
        createdAt: nextRound!.createdAt,
      }),
    );
  }
  return sendGameState(roomCode, lastAction);
}
