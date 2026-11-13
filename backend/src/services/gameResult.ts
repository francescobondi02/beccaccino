import { Prisma } from "@prisma/client";
import { sumRoundScores } from "../domain/game/gameScore";

export async function readGameResult(
  client: Prisma.TransactionClient,
  gameRoomId: number,
  winnerTeam: number,
) {
  const room = await client.gameRoom.findUniqueOrThrow({
    where: { id: gameRoomId },
    select: {
      players: {
        orderBy: { seat: "asc" },
        select: { id: true, team: true, user: { select: { username: true } } },
      },
      rounds: {
        where: { winnerTeam: { not: null } },
        orderBy: { number: "asc" },
        select: {
          number: true,
          winnerTeam: true,
          team0Points: true,
          team1Points: true,
          team0Figures: true,
          team1Figures: true,
          hands: {
            select: {
              winnerId: true,
              cards: { select: { playerId: true, value: true, signal: true } },
            },
          },
        },
      },
    },
  });
  const players = room.players.map((player) => ({
    playerId: player.id,
    username: player.user.username,
    team: player.team,
    tricksWon: 0,
    busso: 0,
    acesCaptured: 0,
    acesLost: 0,
  }));
  const byId = new Map(players.map((player) => [player.playerId, player]));
  for (const round of room.rounds) {
    for (const hand of round.hands) {
      if (hand.winnerId === null) continue;
      const winner = byId.get(hand.winnerId);
      if (!winner || winner.team === null) {
        throw new Error("Completed trick winner has no valid team");
      }
      winner.tricksWon += 1;
      for (const card of hand.cards) {
        const player = byId.get(card.playerId);
        if (!player || player.team === null) {
          throw new Error("Played card owner has no valid team");
        }
        if (card.signal === "busso") player.busso += 1;
        if (card.value === "asso" && player.team !== winner.team) {
          winner.acesCaptured += 1;
          player.acesLost += 1;
        }
      }
    }
  }
  const score = sumRoundScores(room.rounds);
  return {
    winnerTeam,
    totalRounds: room.rounds.length,
    finalScores: { team0: score.team0.points, team1: score.team1.points },
    roundsWon: {
      team0: room.rounds.filter((round) => round.winnerTeam === 0).length,
      team1: room.rounds.filter((round) => round.winnerTeam === 1).length,
    },
    statistics: {
      players,
      rounds: room.rounds.map(({ hands, ...round }) => round),
    },
  };
}
