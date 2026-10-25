import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import {
  sumRoundScores,
  decideGameWinner,
  Team,
} from "../domain/game/gameScore";
import { GAME_WIN_POINTS, roundDealPresentation } from "../gameConfig";
import {
  readCallerPlayerId,
  readCurrentTurnUserId,
} from "../game/snapshots/turnState";
import { getTurnTimerState } from "../runtime/turnTimer";
import { withRoomLock } from "../utils/roomLock";

async function readPlayerHands(
  client: Prisma.TransactionClient,
  players: { userId: number; id: number; botModel: string | null }[],
  roundId: number,
) {
  const cards = await client.playerCard.findMany({
    where: { roundId },
    orderBy: [{ suit: "asc" }, { value: "asc" }],
  });

  return players.map((player) => ({
    userId: player.userId,
    botModel: player.botModel,
    cards: cards
      .filter((card) => card.playerId === player.id)
      .map(({ suit, value }) => ({ suit, value })),
  }));
}

async function readGameStateSnapshot(
  client: Prisma.TransactionClient,
  roomCode: string,
  userId: number,
) {
  const gameRoom = await client.gameRoom.findUnique({
    where: { code: roomCode },
    include: { players: true },
  });

  if (!gameRoom) {
    throw new GameError("Room not found", 404);
  }
  if (!gameRoom.players.some((player) => player.userId === userId)) {
    throw new GameError("You are not in this room", 403);
  }
  if (!gameRoom.started) {
    throw new GameError("Game has not started yet", 400);
  }

  const currentRound = await client.round.findFirst({
    where: { gameRoomId: gameRoom.id },
    orderBy: { number: "desc" },
  });
  if (!currentRound) {
    throw new GameError("No active round found", 404);
  }

  const callerPlayerId = await readCallerPlayerId(
    currentRound,
    gameRoom.players,
    client,
  );
  const callerUserId =
    gameRoom.players.find((player) => player.id === callerPlayerId)?.userId ??
    null;
  const myPlayer = gameRoom.players.find(
    (player) => player.userId === userId,
  );
  const myCards = await client.playerCard.findMany({
    where: {
      playerId: myPlayer!.id,
      roundId: currentRound.id,
    },
    orderBy: [{ suit: "asc" }, { value: "asc" }],
  });
  const currentTurnUserId = await readCurrentTurnUserId(
    currentRound,
    gameRoom.players,
    callerPlayerId,
    client,
  );

  const currentHand = await client.hand.findFirst({
    where: { roundId: currentRound.id, winnerId: null },
    orderBy: { number: "desc" },
    include: {
      cards: {
        orderBy: { position: "asc" },
        include: { player: { select: { userId: true } } },
      },
    },
  });
  const lastCompletedHand = await client.hand.findFirst({
    where: { roundId: currentRound.id, winnerId: { not: null } },
    orderBy: { number: "desc" },
    include: {
      cards: {
        orderBy: { position: "asc" },
        include: { player: { select: { userId: true } } },
      },
    },
  });
  const serializePlayedCards = (hand: typeof currentHand) =>
    hand?.cards.map((card) => ({
      playerId: card.playerId,
      userId: card.player.userId,
      suit: card.suit,
      value: card.value,
      position: card.position,
      signal: card.signal,
      handNumber: hand.number,
    })) ?? [];

  const completedRounds = await client.round.findMany({
    where: {
      gameRoomId: gameRoom.id,
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
  const cumulative = sumRoundScores(completedRounds);
  const callerTeam = gameRoom.players.find(
    (player) => player.id === callerPlayerId,
  )?.team;
  const winnerTeam =
    gameRoom.finished && (callerTeam === 0 || callerTeam === 1)
      ? decideGameWinner(cumulative, GAME_WIN_POINTS, callerTeam as Team)
      : null;
  const finishedGame =
    gameRoom.finished && winnerTeam !== null
      ? {
          winnerTeam,
          totalRounds: completedRounds.length,
          finalScores: {
            team0: cumulative.team0.points,
            team1: cumulative.team1.points,
          },
          roundsWon: {
            team0: completedRounds.filter((round) => round.winnerTeam === 0)
              .length,
            team1: completedRounds.filter((round) => round.winnerTeam === 1)
              .length,
          },
        }
      : null;

  const allHands = gameRoom.isPractice
    ? await readPlayerHands(client, gameRoom.players, currentRound.id)
    : null;

  return {
    gameRoom,
    currentRound,
    currentHandNumber: currentHand?.number ?? null,
    callerUserId,
    myCards,
    currentTurnUserId,
    playedCards: serializePlayedCards(currentHand),
    lastHandCards: serializePlayedCards(lastCompletedHand),
    cumulative,
    finishedGame,
    allHands,
  };
}

async function loadGameStateUnlocked(roomCode: string, userId: number) {
  let snapshot: Awaited<ReturnType<typeof readGameStateSnapshot>> | null =
    null;

  for (let attempt = 0; attempt < 3; attempt++) {
    snapshot = await prisma.$transaction(
      (client) => readGameStateSnapshot(client, roomCode, userId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const latestRoomState = await prisma.gameRoom.findUnique({
      where: { id: snapshot.gameRoom.id },
      select: {
        finished: true,
        pausedAt: true,
        pauseEpoch: true,
        rounds: {
          orderBy: { number: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (
      latestRoomState?.finished === snapshot.gameRoom.finished &&
      latestRoomState.pausedAt?.getTime() === snapshot.gameRoom.pausedAt?.getTime() &&
      latestRoomState.pauseEpoch === snapshot.gameRoom.pauseEpoch &&
      latestRoomState.rounds[0]?.id === snapshot.currentRound.id
    ) {
      break;
    }
    snapshot = null;
  }

  if (!snapshot) {
    throw new GameError("Game state changed while loading; retry", 409);
  }

  const {
    gameRoom,
    currentRound,
    currentHandNumber,
    callerUserId,
    myCards,
    currentTurnUserId,
    playedCards,
    lastHandCards,
    cumulative,
    finishedGame,
    allHands,
  } = snapshot;

  const timerState = gameRoom.pausedAt
    ? null
    : getTurnTimerState(roomCode);

  return {
    status: gameRoom.finished
      ? "finished"
      : gameRoom.pausedAt
        ? "paused"
        : currentRound.briscola === null
          ? "choosing_briscola"
          : "playing",
    round: {
      id: currentRound.id,
      number: currentRound.number,
      briscola: currentRound.briscola,
      cricca: currentRound.cricca,
      deal: currentRound.briscola === null ? roundDealPresentation(currentRound) : null,
    },
    currentHandNumber,
    callerUserId,
    myCards,
    currentTurnUserId: gameRoom.finished ? null : currentTurnUserId,
    playedCards,
    lastHandCards,
    totalPoints: {
      team0Points: cumulative.team0.points,
      team1Points: cumulative.team1.points,
      team0Figures: cumulative.team0.figures,
      team1Figures: cumulative.team1.figures,
    },
    turnTimer: timerState,
    pausedAt: gameRoom.pausedAt,
    finishedGame,
    isPractice: gameRoom.isPractice,
    allHands,
  };
}

export function loadGameState(roomCode: string, userId: number) {
  return withRoomLock(roomCode, () =>
    loadGameStateUnlocked(roomCode, userId),
  );
}
