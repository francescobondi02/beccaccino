import * as Sentry from "@sentry/node";
import { getSocketInstance } from "../socketInstance";
import { playCard, setBriscola } from "./gameService";
import { playableCards } from "./cardService";
import { prisma } from "../db";
import { logger } from "../logger";
import { BotTier, isBotTier } from "./botService";
import { buildBotTurn } from "./botState";
import { BotServiceError, requestBotMove } from "./botClient";

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
  /** Bot turns share this map so they are cancellable, but count no timeouts. */
  isBot: boolean;
}

const activeTimers = new Map<string, TimerState>();
const timeoutCounts = new Map<string, Map<number, number>>();
const kickedPlayers = new Map<string, Set<number>>();

/**
 * Which seats in a practice room are bots, and which tier drives them.
 * In-memory (like the maps above) so the human turn path stays synchronous and
 * DB-free — resolving bot-ness with a query would add a round-trip to every
 * handoff of every game, including games with no bots in them.
 */
const botSeats = new Map<string, Map<number, BotTier>>();

export function registerBotSeats(
  roomCode: string,
  seats: { userId: number; tier: BotTier }[],
): void {
  botSeats.set(roomCode, new Map(seats.map((s) => [s.userId, s.tier])));
}

/**
 * Re-populate the registry from persisted `Player.botModel` values, for a
 * practice game that outlived the process that started it.
 */
export function restoreBotSeats(
  roomCode: string,
  players: { userId: number; botModel: string | null }[],
): void {
  if (botSeats.has(roomCode)) return;

  const seats = players
    .filter((p) => isBotTier(p.botModel))
    .map((p) => ({ userId: p.userId, tier: p.botModel as BotTier }));

  if (seats.length > 0) registerBotSeats(roomCode, seats);
}

export function startTurnTimer(
  roomCode: string,
  currentTurnUserId: number,
  phase: Phase,
): void {
  clearTurnTimer(roomCode);

  const botTier = botSeats.get(roomCode)?.get(currentTurnUserId);
  if (botTier) {
    scheduleBotMove(roomCode, currentTurnUserId, botTier, phase);
    return;
  }

  // If this player has been kicked, auto-play immediately
  const kicked = kickedPlayers.get(roomCode);
  if (kicked?.has(currentTurnUserId)) {
    setTimeout(
      () => executeAutoPlay(roomCode, currentTurnUserId, phase),
      500,
    ).unref();
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
    isBot: false,
  });

  announceTurn(roomCode, currentTurnUserId, phase, durationMs);
}

function announceTurn(
  roomCode: string,
  turnUserId: number,
  phase: Phase,
  totalMs: number | null,
): void {
  try {
    getSocketInstance().to(roomCode).emit("turn_timer_started", {
      turnUserId,
      totalMs,
      serverTimestamp: Date.now(),
      phase,
      // Bot turns have no deadline to count down to; the UI shows "thinking".
      isBot: totalMs === null,
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
  isBot: boolean;
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
    isBot: timer.isBot,
  };
}

export function clearRoomTimerData(roomCode: string): void {
  clearTurnTimer(roomCode);
  timeoutCounts.delete(roomCode);
  kickedPlayers.delete(roomCode);
  botSeats.delete(roomCode);
}

/**
 * How many turn timeouts a seat has accrued, and whether it has been kicked.
 * Exposed so tests can assert a bot seat NEVER accrues either — the kick path is
 * the one failure that would silently swap the model for the dumb fallback.
 */
export function getTimeoutState(
  roomCode: string,
  userId: number,
): { timeouts: number; kicked: boolean } {
  return {
    timeouts: timeoutCounts.get(roomCode)?.get(userId) ?? 0,
    kicked: kickedPlayers.get(roomCode)?.has(userId) ?? false,
  };
}

/**
 * Pause before a bot acts, so consecutive bot turns land one card at a time
 * instead of resolving as an instant tick storm the human can't follow.
 * Read per call, not at import, so tests can shorten it.
 */
const DEFAULT_BOT_THINK_DELAY_MS = 1000;
const botThinkDelayMs = () =>
  parseInt(process.env.BOT_THINK_DELAY_MS || String(DEFAULT_BOT_THINK_DELAY_MS), 10);

/**
 * Drive one bot turn: think, ask the bot service, apply the move.
 *
 * The pending think-delay IS registered in `activeTimers`, flagged `isBot`, for
 * two reasons: `clearTurnTimer` can then cancel a bot that is about to act (the
 * human playing, or the room being torn down), and `getTurnTimerState` reports a
 * live turn — which stops the lazy timer recovery in `getGameState` from
 * dispatching a second move for the same turn every time the client refetches.
 *
 * What it deliberately does NOT do is arm the auto-play timeout or touch
 * `timeoutCounts`. So a bot's move can never race a 60 s auto-play, and a slow
 * bot can never accrue timeouts and get kicked — a kicked bot would be silently
 * replaced by the dumb fallback for the rest of the game, which would corrupt
 * exactly what we are trying to observe.
 *
 * Because playCard/setBriscola re-arm the timer for the next seat, consecutive
 * bot turns chain on their own; there is no bot loop.
 */
function scheduleBotMove(
  roomCode: string,
  userId: number,
  tier: BotTier,
  phase: Phase,
): void {
  const thinkDelayMs = botThinkDelayMs();
  const timeout = setTimeout(() => {
    void playBotMove(roomCode, userId, tier, phase);
  }, thinkDelayMs);
  timeout.unref();

  activeTimers.set(roomCode, {
    timeout,
    roomCode,
    currentTurnUserId: userId,
    phase,
    startedAt: Date.now(),
    durationMs: thinkDelayMs,
    isBot: true,
  });

  announceTurn(roomCode, userId, phase, null);
}

async function playBotMove(
  roomCode: string,
  userId: number,
  tier: BotTier,
  phase: Phase,
): Promise<void> {
  // The think-delay has elapsed, so drop our slot in activeTimers before acting:
  // playCard/setBriscola arm the NEXT seat's timer, and leaving a stale entry
  // here would have them clear a timer that is no longer ours.
  const timer = activeTimers.get(roomCode);
  if (timer?.isBot && timer.currentTurnUserId === userId) {
    activeTimers.delete(roomCode);
  }

  // The seat may have gone away while we were thinking (human abandoned the
  // practice game, so the room was torn down). Re-checking is the point: the
  // alternative is playing a turn for a deleted Player row.
  if (!botSeats.get(roomCode)?.has(userId)) return;

  try {
    const move = await chooseBotMove(roomCode, userId, tier, phase);

    if (move.kind === "briscola") {
      const { gameRoomId, playerId } = move;
      await setBriscola({ gameRoomId, playerId, suit: move.suit as any });
    } else {
      await playCard({
        roomCode,
        userId,
        suit: move.suit as any,
        value: move.value as any,
        signal: move.signal as any,
      });
    }
  } catch (error) {
    // Re-check: the human can abandon the game while /act is in flight, which
    // deletes the room and makes this failure expected. Reporting that as a
    // model fallback would cry wolf on the one alarm that tells us a seat was
    // NOT played by the model.
    if (!botSeats.get(roomCode)?.has(userId)) {
      logger.debug({ roomCode, userId }, "bot_move_abandoned_room_gone");
      return;
    }

    // A real fallback keeps the game moving, but it means this seat was played
    // by the dumb heuristic and NOT by the model — so log it loudly and
    // distinctly. A fallback mistaken for the model invalidates the diagnostic.
    Sentry.captureException(error, {
      tags: { source: "bot_fallback_to_autoplay" },
      extra: { roomCode, userId, tier, phase },
    });
    logger.error(
      { err: error, roomCode, userId, tier, phase },
      "bot_fallback_to_autoplay",
    );

    try {
      if (phase === "choose_briscola") {
        await autoChooseBriscola(roomCode, userId);
      } else {
        await autoPlayCard(roomCode, userId);
      }
    } catch (fallbackError) {
      // Both paths failed. Most likely the turn already advanced (a reconnect
      // double-dispatched and the other call won), which is harmless.
      logger.warn(
        { err: fallbackError, roomCode, userId, phase },
        "bot_autoplay_fallback_failed",
      );
    }
  }
}

/** Serialize the board, ask the service for a move, and tag it for application. */
async function chooseBotMove(
  roomCode: string,
  userId: number,
  tier: BotTier,
  phase: Phase,
): Promise<
  | { kind: "briscola"; suit: string; gameRoomId: number; playerId: number }
  | { kind: "card"; suit: string; value: string; signal: string | null }
> {
  const { state, seat, playerId, gameRoomId } = await buildBotTurn(roomCode, userId);

  // Send the cards we think are legal so the service can 409 if its rules engine
  // disagrees. Only meaningful mid-trick, and only for card plays.
  const expectedLegalCards =
    phase === "play_card"
      ? (await playableCards({ roomCode, userId })).map((c) => ({
          suit: c.suit as string,
          value: c.value as string,
        }))
      : undefined;

  const move = await requestBotMove({ state, seat, tier, expectedLegalCards });

  if (move.kind !== (phase === "choose_briscola" ? "briscola" : "card")) {
    throw new BotServiceError(
      `bot returned a ${move.kind} move during ${phase}`,
    );
  }

  return move.kind === "briscola"
    ? { ...move, gameRoomId, playerId }
    : move;
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

/**
 * Forget a player's accrued timeouts. Called on every successful HUMAN action
 * (REST play-card / choose-briscola), so only genuinely abandoned turns count
 * toward the 3-timeout kick — a laggy player who keeps playing stays in.
 */
export function resetTimeoutCount(roomCode: string, userId: number): void {
  timeoutCounts.get(roomCode)?.delete(userId);
}

const KICK_TIMEOUT_LIMIT = 3;

async function executeAutoPlay(
  roomCode: string,
  userId: number,
  phase: Phase,
): Promise<void> {
  const io = getSocketInstance();

  try {
    if (phase === "choose_briscola") {
      await autoChooseBriscola(roomCode, userId);
    } else {
      await autoPlayCard(roomCode, userId);
    }

    io.to(roomCode).emit("auto_played", { userId, phase });

    // Count the timeout only after the auto-play actually happened — a failed
    // attempt (usually the player acting first and winning the race) is not an
    // abandoned turn.
    if (!timeoutCounts.has(roomCode)) {
      timeoutCounts.set(roomCode, new Map());
    }
    const roomCounts = timeoutCounts.get(roomCode)!;
    const currentCount = (roomCounts.get(userId) || 0) + 1;
    roomCounts.set(userId, currentCount);

    const alreadyKicked = kickedPlayers.get(roomCode)?.has(userId) ?? false;
    if (currentCount >= KICK_TIMEOUT_LIMIT && !alreadyKicked) {
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
