import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { resolveTurnSeat } from "../../domain/game/turnOrder";
import type { TurnPhase } from "../../contract/game";
import { TurnIdentity } from "../turn";

type GameReadClient = Pick<Prisma.TransactionClient, "trick">;

export async function readCurrentTurn(
  round: { id: number; briscola: string | null; callerId: number },
  players: { id: number; userId: number; seat: number | null }[],
  client: GameReadClient = prisma,
): Promise<{
  userId: number;
  phase: TurnPhase;
  identity: TurnIdentity;
} | null> {
  const trick = await client.trick.findFirst({
    where: { roundId: round.id },
    orderBy: { number: "desc" },
    include: { cards: { orderBy: { position: "asc" } } },
  });
  const callerSeat =
    players.find((player) => player.id === round.callerId)?.seat ?? null;
  const starterSeat =
    players.find((player) => player.id === trick?.starterId)?.seat ?? null;
  const winnerSeat =
    players.find((player) => player.id === trick?.winnerId)?.seat ?? null;
  const turnSeat = resolveTurnSeat({
    briscolaChosen: round.briscola !== null,
    callerSeat,
    trick:
      trick && starterSeat !== null
        ? {
            starterSeat,
            playedCardCount: trick.cards.length,
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
        ? { roundId: round.id, trickId: null, playedCardCount: 0 }
        : {
            roundId: round.id,
            trickId: trick?.id ?? null,
            playedCardCount: trick?.cards.length ?? 0,
          },
  };
}
