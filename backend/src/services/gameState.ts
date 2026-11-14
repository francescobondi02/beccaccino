import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { sumRoundScores, toTeamScore } from "../domain/game/gameScore";
import { selectLegalCards } from "../domain/game/legalCards";
import { TRICK_DISPLAY_MS, roundDealTimes } from "../gameConfig";
import { readCurrentTurn } from "../game/snapshots/turnState";
import { getTurnTimerState } from "../runtime/turnTimer";
import { publishEvent } from "../runtime/eventPublisher";
import { logger } from "../logger";
import { withRoomLock } from "../utils/roomLock";
import { readGameResult } from "./gameResult";
import type { BotTier, Signal, Team } from "../contract/cards";
import type { GameState, LastAction, PlayedCard } from "../contract/game";

// Every writer calls this in its transaction; clients drop states with a lower version.
export function markGameChanged(tx: Prisma.TransactionClient, gameRoomId: number) {
  return tx.gameRoom.update({
    where: { id: gameRoomId },
    data: { version: { increment: 1 }, lastActivityAt: new Date() },
  });
}

const playedCardsInclude = {
  cards: {
    orderBy: { position: "asc" },
    include: { player: { select: { userId: true } } },
  },
} satisfies Prisma.TrickInclude;

type TrickWithCards = Prisma.TrickGetPayload<{ include: typeof playedCardsInclude }>;

function toPlayedCards(trick: TrickWithCards): PlayedCard[] {
  return trick.cards.map((card) => ({
    userId: card.player.userId,
    suit: card.suit,
    value: card.value,
    signal: card.signal as Signal | null,
  }));
}

async function readGameSnapshot(client: Prisma.TransactionClient, roomCode: string) {
  const room = await client.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: {
        orderBy: { seat: "asc" },
        include: { user: { select: { username: true, isBot: true } } },
      },
    },
  });
  if (!room) throw new GameError("Room not found", 404);
  if (!room.started) throw new GameError("Game has not started yet", 400);

  const round = await client.round.findFirst({
    where: { gameRoomId: room.id },
    orderBy: { number: "desc" },
  });
  if (!round) throw new GameError("No active round found", 404);

  const turn = await readCurrentTurn(round, room.players, client);
  const handCards = await client.handCard.findMany({
    where: { roundId: round.id },
    orderBy: [{ suit: "asc" }, { value: "asc" }],
    select: { playerId: true, suit: true, value: true },
  });
  const trick = await client.trick.findFirst({
    where: { roundId: round.id, winnerId: null },
    orderBy: { number: "desc" },
    include: playedCardsInclude,
  });
  const lastTrick = await client.trick.findFirst({
    where: { round: { gameRoomId: room.id }, winnerId: { not: null } },
    orderBy: [{ roundId: "desc" }, { number: "desc" }],
    include: { ...playedCardsInclude, round: { select: { number: true } } },
  });
  const completedRounds = await client.round.findMany({
    where: { gameRoomId: room.id, winnerTeam: { not: null } },
    orderBy: { number: "asc" },
  });

  const result =
    room.winnerTeam === null
      ? null
      : await readGameResult(client, room.id);

  return {
    room,
    round,
    turn,
    handCards,
    trick,
    lastTrick,
    previousRound: completedRounds.find((candidate) => candidate.number === round.number - 1),
    score: sumRoundScores(completedRounds),
    result,
  };
}

type GameSnapshot = Awaited<ReturnType<typeof readGameSnapshot>>;

function toGameState(
  snapshot: GameSnapshot,
  userId: number,
  lastAction: LastAction | null,
): GameState {
  const { room, round, turn, trick, lastTrick, previousRound, score } = snapshot;
  const now = Date.now();
  const me = room.players.find((player) => player.userId === userId)!;
  const myHand = snapshot.handCards
    .filter((card) => card.playerId === me.id)
    .map(({ suit, value }) => ({ suit, value }));
  const deal = roundDealTimes(round);
  const timer = room.pausedAt || room.finished ? null : getTurnTimerState(room.code);
  const timerMatches = timer?.turnUserId === turn?.userId && timer?.phase === turn?.phase;
  const leadSuit = trick?.cards[0]?.suit ?? null;
  const canPlay =
    !room.finished &&
    !room.pausedAt &&
    turn?.userId === userId &&
    turn.phase === "play_card" &&
    me.botModel === null &&
    me.abandonedAt === null;

  return {
    roomCode: room.code,
    version: room.version,
    serverTime: new Date(now).toISOString(),
    status: room.finished
      ? "finished"
      : room.pausedAt
        ? "paused"
        : round.briscola === null
          ? "choosing_briscola"
          : "playing",
    isPractice: room.isPractice,
    players: room.players.map((player) => ({
      userId: player.userId,
      username: player.user.username,
      isBot: player.user.isBot,
      seat: player.seat!,
      team: player.team as Team,
      botModel: player.botModel as BotTier | null,
      abandoned: player.abandonedAt !== null,
    })),
    round: {
      number: round.number,
      callerUserId: room.players.find((player) => player.id === round.callerId)!.userId,
      briscola: round.briscola,
      cricca: round.cricca,
      deal:
        round.briscola === null
          ? {
              animationEndsAt: new Date(deal.animationEndsAt).toISOString(),
              reviewEndsAt: new Date(deal.reviewEndsAt).toISOString(),
            }
          : null,
    },
    trick: trick ? { number: trick.number, cards: toPlayedCards(trick) } : null,
    lastTrick: lastTrick
      ? {
          roundNumber: lastTrick.round.number,
          trickNumber: lastTrick.number,
          winnerUserId: room.players.find((player) => player.id === lastTrick.winnerId)!.userId,
          cards: toPlayedCards(lastTrick),
          onTableUntil: new Date(
            lastTrick.completedAt!.getTime() + TRICK_DISPLAY_MS,
          ).toISOString(),
        }
      : null,
    myHand,
    playableCards: canPlay ? selectLegalCards(myHand, leadSuit) : [],
    turn:
      turn && !room.pausedAt && !room.finished
        ? {
            userId: turn.userId,
            phase: turn.phase,
            startedAt: new Date(timerMatches ? timer!.startedAt : now).toISOString(),
            deadline:
              timerMatches && !timer!.isBot
                ? new Date(timer!.startedAt + timer!.totalMs).toISOString()
                : null,
          }
        : null,
    score,
    roundSummary:
      previousRound && now < deal.summaryEndsAt
        ? {
            roundNumber: previousRound.number,
            score: {
              team0: toTeamScore(previousRound.team0Raw),
              team1: toTeamScore(previousRound.team1Raw),
            },
            winnerTeam: previousRound.winnerTeam as Team,
            visibleUntil: new Date(deal.summaryEndsAt).toISOString(),
          }
        : null,
    result: snapshot.result,
    lastAction,
  };
}

function readGameSnapshotConsistently(roomCode: string) {
  return prisma.$transaction(
    (client) => readGameSnapshot(client, roomCode),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export function loadGameState(roomCode: string, userId: number) {
  return withRoomLock(roomCode, async () => {
    const snapshot = await readGameSnapshotConsistently(roomCode);
    const me = snapshot.room.players.find((player) => player.userId === userId);
    if (!me) throw new GameError("You are not in this room", 403);
    if (!snapshot.room.finished && me.abandonedAt) {
      throw new GameError("Hai abbandonato questa partita", 403);
    }
    return toGameState(snapshot, userId, null);
  });
}

/**
 * Sends each human still in the game their own state. Call it inside the room
 * lock, after the writer commits and starts the next turn timer.
 */
export async function sendGameState(
  roomCode: string,
  lastAction: LastAction,
): Promise<Map<number, GameState>> {
  const states = new Map<number, GameState>();
  try {
    const snapshot = await readGameSnapshotConsistently(roomCode);
    for (const player of snapshot.room.players) {
      if (player.user.isBot || player.abandonedAt !== null) continue;
      const gameState = toGameState(snapshot, player.userId, lastAction);
      states.set(player.userId, gameState);
      publishEvent(`user:${player.userId}`, "game_state", gameState, { roomCode });
    }
  } catch (error) {
    logger.warn({ err: error, roomCode }, "game_state_send_failed");
  }
  return states;
}
