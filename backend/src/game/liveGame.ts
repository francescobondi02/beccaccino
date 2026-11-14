import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { readGameResult } from "../services/gameResult";
import { toGameState } from "./gameState";
import type { Card, Signal, Suit } from "../contract/cards";
import type { GameResult, GameState } from "../contract/game";

export type LivePlayedCard = Card & { playerId: number; signal: Signal | null };
export type LiveTrick = {
  id: number;
  number: number;
  starterId: number;
  winnerId: number | null;
  completedAt: Date | null;
  cards: LivePlayedCard[];
};
export type LivePlayer = {
  id: number;
  userId: number;
  username: string;
  isBot: boolean;
  seat: number | null;
  team: number | null;
  botModel: string | null;
  abandonedAt: Date | null;
  timeoutCount: number;
};

// One game as plain data. Domain rules and the state projection read only this.
export type LiveGame = {
  room: {
    id: number;
    code: string;
    isPractice: boolean;
    started: boolean;
    pausedAt: Date | null;
    finished: boolean;
    winnerTeam: number | null;
    version: number;
    turnStartedAt: Date | null;
    lastActivityAt: Date;
    botTier: string | null;
  };
  // Seat order.
  players: LivePlayer[];
  // Current round; tricks in play order.
  round: {
    id: number;
    number: number;
    callerId: number;
    briscola: Suit | null;
    cricca: boolean;
    createdAt: Date;
    tricks: LiveTrick[];
  } | null;
  // Cards each player holds, by player id.
  hands: Map<number, Card[]>;
  // Open trick of the current round.
  trick: LiveTrick | null;
  // Latest completed trick, possibly from the previous round.
  lastTrick: (LiveTrick & { roundNumber: number }) | null;
  // Completed rounds in order.
  roundScores: { number: number; team0Raw: number; team1Raw: number; winnerTeam: number }[];
  result: GameResult | null;
};

// Reads one game. Never locks: callers hold the room lock.
export async function loadLiveGame(
  client: Prisma.TransactionClient,
  roomCode: string,
): Promise<LiveGame> {
  const room = await client.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: {
        orderBy: { seat: "asc" },
        include: { user: { select: { username: true, isBot: true } } },
      },
      rounds: {
        orderBy: { number: "desc" },
        take: 2,
        include: {
          tricks: {
            orderBy: { number: "asc" },
            include: { cards: { orderBy: { position: "asc" } } },
          },
          handCards: { orderBy: [{ suit: "asc" }, { value: "asc" }] },
        },
      },
    },
  });
  if (!room) throw new GameError("Room not found", 404);

  const roundScores = await client.round.findMany({
    where: { gameRoomId: room.id, winnerTeam: { not: null } },
    orderBy: { number: "asc" },
    select: { number: true, team0Raw: true, team1Raw: true, winnerTeam: true },
  });

  const toTrick = (trick: (typeof room.rounds)[number]["tricks"][number]): LiveTrick => ({
    id: trick.id,
    number: trick.number,
    starterId: trick.starterId,
    winnerId: trick.winnerId,
    completedAt: trick.completedAt,
    cards: trick.cards.map((card) => ({
      playerId: card.playerId,
      suit: card.suit,
      value: card.value,
      signal: card.signal as Signal | null,
    })),
  });

  const [current, previous] = room.rounds;
  const tricks = current?.tricks.map(toTrick) ?? [];
  const hands = new Map<number, Card[]>(room.players.map((player) => [player.id, []]));
  for (const card of current?.handCards ?? []) {
    hands.get(card.playerId)?.push({ suit: card.suit, value: card.value });
  }
  const completed = tricks.filter((trick) => trick.winnerId !== null);
  const previousLast = previous?.tricks[previous.tricks.length - 1];
  const lastTrick = completed.length > 0
    ? { ...completed[completed.length - 1], roundNumber: current.number }
    : previousLast
      ? { ...toTrick(previousLast), roundNumber: previous.number }
      : null;

  const game: LiveGame = {
    room: {
      id: room.id,
      code: room.code,
      isPractice: room.isPractice,
      started: room.started,
      pausedAt: room.pausedAt,
      finished: room.finished,
      winnerTeam: room.winnerTeam,
      version: room.version,
      turnStartedAt: room.turnStartedAt,
      lastActivityAt: room.lastActivityAt,
      botTier: room.botTier,
    },
    players: room.players.map((player) => ({
      id: player.id,
      userId: player.userId,
      username: player.user.username,
      isBot: player.user.isBot,
      seat: player.seat,
      team: player.team,
      botModel: player.botModel,
      abandonedAt: player.abandonedAt,
      timeoutCount: player.timeoutCount,
    })),
    round: current
      ? {
          id: current.id,
          number: current.number,
          callerId: current.callerId,
          briscola: current.briscola,
          cricca: current.cricca,
          createdAt: current.createdAt,
          tricks,
        }
      : null,
    hands,
    trick: tricks.find((trick) => trick.winnerId === null) ?? null,
    lastTrick,
    roundScores: roundScores.map((round) => ({ ...round, winnerTeam: round.winnerTeam! })),
    result: null,
  };
  if (room.winnerTeam !== null) game.result = await readGameResult(client, game);
  return game;
}

// GET /api/games/:code/state.
export function loadGameState(roomCode: string, userId: number): Promise<GameState> {
  return withRoomLock(roomCode, async () => {
    const game = await loadLiveGame(prisma, roomCode);
    if (!game.round) throw new GameError("Game has not started yet", 400);
    const me = game.players.find((player) => player.userId === userId);
    if (!me) throw new GameError("You are not in this room", 403);
    if (!game.room.finished && me.abandonedAt) {
      throw new GameError("Hai abbandonato questa partita", 403);
    }
    return toGameState(game, userId, Date.now(), null);
  });
}
