import { Prisma } from "@prisma/client";
import { GameError } from "../../utils/gameError";
import { detectCricca } from "../../domain/game/detectCricca";
import { getRng } from "../../utils/random";
import { logger } from "../../logger";
import { publishRoomChanged } from "../../runtime/eventPublisher";
import { Card, Suit, SUITS, Value, VALUES } from "../../domain/game/cards";
import { currentTurn, nextCallerPlayerId } from "../../domain/game/turnOrder";
import { BotTier, replacementBotTier } from "../../services/botUsers";
import { runGameAction, runGameActionUnlocked } from "../runGameAction";
import type { LiveGame, LivePlayer } from "../liveGame";
import type { ActionSource } from "../../contract/game";

// Timers and bot replies pass the version they were armed for.
export type TurnAction = {
  roomCode: string;
  userId: number;
  source: ActionSource;
  expectedVersion?: number;
};

export function isStale(game: LiveGame, action: TurnAction): boolean {
  return action.expectedVersion !== undefined && action.expectedVersion !== game.room.version;
}

// A person cannot play a seat a bot has taken.
export function assertPlayerControl(player: LivePlayer, source: ActionSource): void {
  if (source === "human" && player.botModel !== null) {
    throw new GameError("Un bot sta giocando al tuo posto. Riprendi prima il controllo.", 409);
  }
}

// Counts timeouts in a row. Returns true when this one hands the seat to a bot.
export async function updateTimeoutCount(
  tx: Prisma.TransactionClient,
  game: LiveGame,
  player: LivePlayer,
  source: ActionSource,
): Promise<boolean> {
  if (source !== "human" && source !== "timeout") return false;
  const timeoutCount = source === "timeout" ? player.timeoutCount + 1 : 0;
  // Practice has one human: a takeover would leave nobody at the table.
  const takeover = timeoutCount >= 3 && !game.room.isPractice;
  await tx.player.update({
    where: { id: player.id },
    data: {
      timeoutCount,
      ...(takeover ? { botModel: replacementBotTier({ botTier: game.room.botTier, players: game.players }) } : {}),
    },
  });
  return takeover;
}

function generateDeck(): Card[] {
  return SUITS.flatMap((suit) => VALUES.map((value) => ({ suit, value })));
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
  tx: Prisma.TransactionClient,
): Promise<void> {
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

  let callerId: number | null;
  if (roundNumber === 1) {
    callerId =
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
    callerId = nextCallerPlayerId(players, previousRound.callerId);
  }
  if (callerId === null) {
    throw new Error("Could not find the briscola caller for this round");
  }

  const round = await tx.round.create({
    data: { number: roundNumber, gameRoomId, callerId },
  });
  await tx.handCard.createMany({
    data: hands.flatMap((hand) =>
      hand.cards.map((card) => ({ ...card, playerId: hand.playerId, roundId: round.id })),
    ),
  });

  logger.info({ gameRoomId, roundNumber, roundId: round.id, callerId }, "round_setup");
}

// The caller holds the room lock.
export async function startFirstRound(
  roomCode: string,
  multiplayer?: {
    readyPlayerId: number;
    bots: { userId: number; team: number; botModel: BotTier }[];
  },
): Promise<void> {
  await runGameActionUnlocked(roomCode, async (game, tx) => {
    if (game.room.started) throw new GameError("Game has already started", 409);
    const gameRoomId = game.room.id;
    await tx.gameRoom.update({ where: { id: gameRoomId }, data: { started: true } });
    if (multiplayer) {
      await tx.player.update({
        where: { id: multiplayer.readyPlayerId, gameRoomId },
        data: { isReady: true },
      });
      await tx.player.createMany({
        data: multiplayer.bots.map((bot) => ({ ...bot, gameRoomId, isReady: true })),
      });
    }
    await setupRound(gameRoomId, 1, tx);
    return { kind: "game_started" };
  });
  publishRoomChanged(roomCode);
}

// The suit the caller holds most of; ties go to the first suit by name.
function autoBriscola(hand: Card[]): Suit {
  const count = (suit: Suit) => hand.filter((card) => card.suit === suit).length;
  return SUITS.reduce((best, candidate) => {
    const difference = count(candidate) - count(best);
    return difference > 0 || (difference === 0 && candidate < best) ? candidate : best;
  });
}

// Without a suit the server picks one (timeout, bot fallback).
export function setBriscola(action: TurnAction & { suit?: Suit }) {
  return runGameAction(
    action.roomCode,
    async (game, tx) => {
      if (isStale(game, action)) return null;
      const player = game.players.find((candidate) => candidate.userId === action.userId);
      if (!player) throw new GameError("Player not in this game room", 403);
      assertPlayerControl(player, action.source);
      if (game.room.pausedAt) throw new GameError("Practice game is paused", 409);
      const turn = currentTurn(game);
      if (turn?.player.id !== player.id || turn.phase !== "choose_briscola") {
        throw new GameError("It's not your turn to choose briscola", 403);
      }
      const round = game.round!;

      const hand = game.hands.get(player.id) ?? [];
      const suit = action.suit ?? autoBriscola(hand);
      const cricca = detectCricca(hand, suit);
      const takeover = await updateTimeoutCount(tx, game, player, action.source);
      await tx.round.update({
        where: { id: round.id },
        data: { briscola: suit, cricca, briscolaAutoChosen: action.suit === undefined },
      });
      await tx.trick.create({ data: { roundId: round.id, number: 1, starterId: player.id } });
      logger.info(
        { roomCode: action.roomCode, roundNumber: round.number, callerId: player.id, briscola: suit, cricca },
        "briscola_set",
      );
      return { kind: "briscola_chosen", userId: action.userId, suit, source: action.source, takeover };
    },
    action.source === "human" ? action.userId : undefined,
  );
}
