import { prisma } from "../db";
import { logger } from "../logger";
import { GameError } from "../utils/gameError";
import { cumulativeScore } from "../utils/score";
import {
  resolveCaller,
  resolveCurrentTurnUserId,
} from "./gameService";
import {
  getTurnTimerState,
  restoreBotSeats,
  startTurnTimer,
} from "./turnTimer";

async function revealAllHands(
  players: { userId: number; id: number; botModel: string | null }[],
  roundId: number,
) {
  const cards = await prisma.playerCard.findMany({
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

export async function loadGameState(roomCode: string, userId: number) {
  const gameRoom = await prisma.gameRoom.findUnique({
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

  const currentRound = await prisma.round.findFirst({
    where: { gameRoomId: gameRoom.id },
    orderBy: { number: "desc" },
  });
  if (!currentRound) {
    throw new GameError("No active round found", 404);
  }

  const callerPlayerId = await resolveCaller(currentRound, gameRoom.players);
  const callerUserId =
    gameRoom.players.find((player) => player.id === callerPlayerId)?.userId ??
    null;
  const myPlayer = gameRoom.players.find(
    (player) => player.userId === userId,
  );
  const myCards = await prisma.playerCard.findMany({
    where: {
      playerId: myPlayer!.id,
      roundId: currentRound.id,
    },
    orderBy: [{ suit: "asc" }, { value: "asc" }],
  });
  const currentTurnUserId = await resolveCurrentTurnUserId(
    currentRound,
    gameRoom.players,
    callerUserId,
  );

  const currentHand = await prisma.hand.findFirst({
    where: { roundId: currentRound.id, winnerId: null },
    orderBy: { number: "desc" },
    include: {
      cards: {
        orderBy: { position: "asc" },
        include: { player: { select: { userId: true } } },
      },
    },
  });
  const lastCompletedHand = await prisma.hand.findFirst({
    where: { roundId: currentRound.id, winnerId: { not: null } },
    orderBy: { number: "desc" },
    include: {
      cards: {
        orderBy: { position: "asc" },
        include: { player: { select: { userId: true } } },
      },
    },
  });
  const serializeCards = (
    cards: NonNullable<typeof currentHand>["cards"] | undefined,
  ) =>
    cards?.map((card) => ({
      playerId: card.playerId,
      userId: card.player.userId,
      suit: card.suit,
      value: card.value,
      position: card.position,
    })) ?? [];

  const completedRounds = await prisma.round.findMany({
    where: {
      gameRoomId: gameRoom.id,
      winnerTeam: { not: null },
    },
    select: {
      team0Points: true,
      team1Points: true,
      team0Figures: true,
      team1Figures: true,
    },
  });
  const cumulative = cumulativeScore(completedRounds);

  let timerState = getTurnTimerState(roomCode);
  if (!timerState && !gameRoom.finished && currentTurnUserId !== null) {
    const phase =
      currentRound.briscola === null ? "choose_briscola" : "play_card";
    logger.info(
      { roomCode, currentTurnUserId, phase },
      "turn_timer_recovered_after_restart",
    );
    restoreBotSeats(roomCode, gameRoom.players);
    startTurnTimer(roomCode, currentTurnUserId, phase);
    timerState = getTurnTimerState(roomCode);
  }

  return {
    round: {
      id: currentRound.id,
      number: currentRound.number,
      briscola: currentRound.briscola,
      cricca: currentRound.cricca,
    },
    currentHandNumber: currentHand?.number ?? null,
    callerUserId,
    myCards,
    currentTurnUserId,
    playedCards: serializeCards(currentHand?.cards),
    lastHandCards: serializeCards(lastCompletedHand?.cards),
    totalPoints: {
      team0Points: cumulative.team0.points,
      team1Points: cumulative.team1.points,
      team0Figures: cumulative.team0.figures,
      team1Figures: cumulative.team1.figures,
    },
    turnTimer: timerState,
    isPractice: gameRoom.isPractice,
    allHands: gameRoom.isPractice
      ? await revealAllHands(gameRoom.players, currentRound.id)
      : null,
  };
}
