import * as Sentry from "@sentry/node";
import { getSocketInstance } from "../socketInstance";
import { playCard, setBriscola } from "./gameService";
import { playableCards } from "./cardService";
import { prisma } from "../db";
import { logger } from "../logger";

const TURN_TIMEOUT_SECONDS = parseInt(
  process.env.TURN_TIMEOUT_SECONDS || "60",
  10,
);
const BRISCOLA_TIMEOUT_SECONDS = parseInt(
  process.env.BRISCOLA_TIMEOUT_SECONDS || "90",
  10,
);

type Phase = "play_card" | "choose_briscola";

interface TimerState {
  timeout: NodeJS.Timeout;
  roomCode: string;
  currentTurnUserId: number;
  phase: Phase;
  startedAt: number;
  durationMs: number;
}

const activeTimers = new Map<string, TimerState>();
const timeoutCounts = new Map<string, Map<number, number>>();
const kickedPlayers = new Map<string, Set<number>>();

export function startTurnTimer(
  roomCode: string,
  currentTurnUserId: number,
  phase: Phase,
): void {
  clearTurnTimer(roomCode);

  // If this player has been kicked, auto-play immediately
  const kicked = kickedPlayers.get(roomCode);
  if (kicked?.has(currentTurnUserId)) {
    setTimeout(() => executeAutoPlay(roomCode, currentTurnUserId, phase), 500);
    return;
  }

  const durationMs =
    phase === "choose_briscola"
      ? BRISCOLA_TIMEOUT_SECONDS * 1000
      : TURN_TIMEOUT_SECONDS * 1000;

  const startedAt = Date.now();

  const timeout = setTimeout(() => {
    executeAutoPlay(roomCode, currentTurnUserId, phase);
  }, durationMs);

  activeTimers.set(roomCode, {
    timeout,
    roomCode,
    currentTurnUserId,
    phase,
    startedAt,
    durationMs,
  });

  // Broadcast timer start to all clients in the room
  try {
    const io = getSocketInstance();
    io.to(roomCode).emit("turn_timer_started", {
      turnUserId: currentTurnUserId,
      totalMs: durationMs,
      serverTimestamp: startedAt,
      phase,
    });
  } catch {
    // Socket not initialized yet (during tests)
  }
}

export function clearTurnTimer(roomCode: string): void {
  const timer = activeTimers.get(roomCode);
  if (timer) {
    clearTimeout(timer.timeout);
    activeTimers.delete(roomCode);
  }
}

export function getTurnTimerState(roomCode: string): {
  remainingMs: number;
  totalMs: number;
  turnUserId: number;
  phase: Phase;
} | null {
  const timer = activeTimers.get(roomCode);
  if (!timer) return null;

  const elapsed = Date.now() - timer.startedAt;
  const remainingMs = Math.max(0, timer.durationMs - elapsed);

  return {
    remainingMs,
    totalMs: timer.durationMs,
    turnUserId: timer.currentTurnUserId,
    phase: timer.phase,
  };
}

export function clearRoomTimerData(roomCode: string): void {
  clearTurnTimer(roomCode);
  timeoutCounts.delete(roomCode);
  kickedPlayers.delete(roomCode);
}

// Periodic cleanup: remove timer data for rooms that have been idle too long (2 hours)
const STALE_TIMER_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const cleanupStaleTimers = setInterval(() => {
  const now = Date.now();
  for (const [roomCode, timer] of activeTimers.entries()) {
    if (now - timer.startedAt > STALE_TIMER_THRESHOLD_MS) {
      clearRoomTimerData(roomCode);
    }
  }
}, 10 * 60 * 1000); // every 10 minutes
cleanupStaleTimers.unref();

async function executeAutoPlay(
  roomCode: string,
  userId: number,
  phase: Phase,
): Promise<void> {
  // Increment timeout count for this player
  if (!timeoutCounts.has(roomCode)) {
    timeoutCounts.set(roomCode, new Map());
  }
  const roomCounts = timeoutCounts.get(roomCode)!;
  const currentCount = (roomCounts.get(userId) || 0) + 1;
  roomCounts.set(userId, currentCount);

  const io = getSocketInstance();

  // Check if player should be kicked (3 timeouts)
  if (currentCount >= 3) {
    if (!kickedPlayers.has(roomCode)) {
      kickedPlayers.set(roomCode, new Set());
    }
    kickedPlayers.get(roomCode)!.add(userId);

    // Find player username for the notification
    const player = await prisma.player.findFirst({
      where: { userId, gameRoom: { code: roomCode } },
      include: { user: true },
    });
    const username = player?.user?.username ?? "Giocatore";

    io.to(roomCode).emit("player_kicked_timeout", { userId, username });
  }

  try {
    if (phase === "choose_briscola") {
      await autoChooseBriscola(roomCode, userId);
    } else {
      await autoPlayCard(roomCode, userId);
    }

    io.to(roomCode).emit("auto_played", { userId, phase });
  } catch (error) {
    // The most common cause is a benign race: the player already acted
    // between the timer firing and our DB read. We still surface to Sentry
    // (with a tag) so we can spot pathological auto-play loops.
    Sentry.captureException(error, {
      tags: { source: "auto_play_race" },
      extra: { roomCode, userId, phase },
    });
    logger.warn(
      { err: error, roomCode, userId, phase },
      "auto_play_failed",
    );
  }
}

async function autoPlayCard(roomCode: string, userId: number): Promise<void> {
  const cards = await playableCards({ roomCode, userId });
  if (cards.length === 0) return;

  const card = cards[0];
  await playCard({
    roomCode,
    userId,
    suit: card.suit as any,
    value: card.value as any,
  });
}

async function autoChooseBriscola(
  roomCode: string,
  userId: number,
): Promise<void> {
  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: true,
      rounds: { orderBy: { number: "desc" }, take: 1 },
    },
  });
  if (!room || room.rounds.length === 0) return;

  const player = room.players.find((p) => p.userId === userId);
  if (!player) return;

  const round = room.rounds[0];
  if (round.briscola !== null) return;

  const playerCards = await prisma.playerCard.findMany({
    where: { playerId: player.id, roundId: round.id },
  });

  // Pick the suit with the most cards
  const suitCounts: Record<string, number> = {};
  for (const c of playerCards) {
    suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  }
  const bestSuit = Object.entries(suitCounts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0][0];

  await setBriscola({
    gameRoomId: room.id,
    playerId: player.id,
    suit: bestSuit as any,
  });
}
