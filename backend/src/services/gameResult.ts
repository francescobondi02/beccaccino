import { Prisma } from "@prisma/client";
import { sumRoundScores, toTeamScore } from "../domain/game/gameScore";
import type { LiveGame } from "../game/liveGame";
import type { Team } from "../contract/cards";
import type { GameResult } from "../contract/game";

export async function readGameResult(
  client: Prisma.TransactionClient,
  game: Pick<LiveGame, "room" | "players" | "roundScores">,
): Promise<GameResult> {
  const tricks = await client.trick.findMany({
    where: { round: { gameRoomId: game.room.id, winnerTeam: { not: null } } },
    select: {
      winnerId: true,
      cards: { select: { playerId: true, value: true, signal: true } },
    },
  });
  const players = game.players.map((player) => ({
    playerId: player.id,
    username: player.username,
    team: player.team,
    tricksWon: 0,
    busso: 0,
    acesCaptured: 0,
    acesLost: 0,
  }));
  const byId = new Map(players.map((player) => [player.playerId, player]));
  for (const trick of tricks) {
    if (trick.winnerId === null) continue;
    const winner = byId.get(trick.winnerId);
    if (!winner || winner.team === null) {
      throw new Error("Completed trick winner has no valid team");
    }
    winner.tricksWon += 1;
    for (const card of trick.cards) {
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
  const rounds = game.roundScores;
  const score = sumRoundScores(rounds);
  return {
    winnerTeam: game.room.winnerTeam as Team,
    totalRounds: rounds.length,
    finalScores: { team0: score.team0.points, team1: score.team1.points },
    roundsWon: {
      team0: rounds.filter((round) => round.winnerTeam === 0).length,
      team1: rounds.filter((round) => round.winnerTeam === 1).length,
    },
    statistics: {
      players: players.map(({ playerId, team, ...player }) => ({ ...player, team: team as Team })),
      rounds: rounds.map((round) => ({
        number: round.number,
        winnerTeam: round.winnerTeam as Team,
        score: {
          team0: toTeamScore(round.team0Raw),
          team1: toTeamScore(round.team1Raw),
        },
      })),
    },
  };
}
