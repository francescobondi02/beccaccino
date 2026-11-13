import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import {
  resolveCaller,
  resolveTurnSeat,
  nextCallerPlayerId,
} from "../../domain/game/turnOrder";
import {
  TurnIdentity,
  TurnPhase,
} from "../turn";

type GameReadClient = Pick<
  Prisma.TransactionClient,
  "hand" | "playerCard" | "round"
>;

export async function readCallerPlayerId(
  round: { id: number; number: number; gameRoomId: number },
  players: { id: number; seat: number | null }[],
  client: GameReadClient = prisma,
): Promise<number | null> {
  const firstTrick = await client.hand.findFirst({
    where: { roundId: round.id },
    orderBy: { number: "asc" },
    select: { starterId: true },
  });
  let quattroDenaraHolder: number | null = null;
  let previousCaller: number | null = null;

  if (!firstTrick && round.number === 1) {
    quattroDenaraHolder =
      (
        await client.playerCard.findFirst({
          where: { roundId: round.id, suit: "denara", value: "quattro" },
          select: { playerId: true },
        })
      )?.playerId ?? null;
  }
  if (!firstTrick && round.number > 1) {
    previousCaller =
      (
        await client.round.findFirst({
          where: { gameRoomId: round.gameRoomId, number: round.number - 1 },
          include: { hands: { orderBy: { number: "asc" }, take: 1 } },
        })
      )?.hands[0]?.starterId ?? null;
  }

  return resolveCaller({
    roundNumber: round.number,
    firstTrickStarter: firstTrick?.starterId,
    quattroDenaraHolder,
    previousCaller,
    nextCaller: (caller) => nextCallerPlayerId(players, caller),
  });
}

export async function readCurrentTurnUserId(
  round: { id: number; briscola: string | null },
  players: { id: number; userId: number; seat: number | null }[],
  callerPlayerId: number | null,
  client: GameReadClient = prisma,
): Promise<number | null> {
  return (
    await readCurrentTurn(round, players, callerPlayerId, client)
  )?.userId ?? null;
}

export async function readCurrentTurn(
  round: { id: number; briscola: string | null },
  players: { id: number; userId: number; seat: number | null }[],
  callerPlayerId: number | null,
  client: GameReadClient = prisma,
): Promise<{
  userId: number;
  phase: TurnPhase;
  identity: TurnIdentity;
} | null> {
  const lastHand = await client.hand.findFirst({
    where: { roundId: round.id },
    orderBy: { number: "desc" },
    include: { cards: { orderBy: { position: "asc" } } },
  });
  const callerSeat =
    players.find((player) => player.id === callerPlayerId)?.seat ?? null;
  const starterSeat =
    players.find((player) => player.id === lastHand?.starterId)?.seat ?? null;
  const winnerSeat =
    players.find((player) => player.id === lastHand?.winnerId)?.seat ?? null;
  const turnSeat = resolveTurnSeat({
    briscolaChosen: round.briscola !== null,
    callerSeat,
    hand:
      lastHand && starterSeat !== null
        ? {
            starterSeat,
            playedCardCount: lastHand.cards.length,
            winnerSeat,
          }
        : null,
  });
  const userId =
    players.find((player) => player.seat === turnSeat)?.userId ?? null;
  if (userId === null) return null;

  const phase = round.briscola === null ? "choose_briscola" : "play_card";
  return {
    userId,
    phase,
    identity:
      phase === "choose_briscola"
        ? { roundId: round.id, handId: null, playedCardCount: 0 }
        : {
            roundId: round.id,
            handId: lastHand?.id ?? null,
            playedCardCount: lastHand?.cards.length ?? 0,
          },
  };
}
