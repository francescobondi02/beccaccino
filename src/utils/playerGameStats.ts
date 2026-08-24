import {
  cumulativeScore,
  decideScoreWinner,
  RoundScoreRow,
  Team,
} from "./score";

type StatsRound = RoundScoreRow & {
  hands: { starterId: number }[];
};

type StatsPlayer = {
  id: number;
  team: number | null;
};

export type PlayerGameSummary = {
  didWin: boolean;
  myTeamPoints: number;
  opponentTeamPoints: number;
  winnerTeam: Team;
};

export function summarizePlayerGame(
  playerTeam: number | null,
  rounds: StatsRound[],
  players: StatsPlayer[],
): PlayerGameSummary {
  if (playerTeam !== 0 && playerTeam !== 1) {
    throw new Error("Finished game player has no valid team");
  }

  const finalRound = rounds[rounds.length - 1];
  const callerId = finalRound?.hands[0]?.starterId;
  const callerTeam = players.find((player) => player.id === callerId)?.team;
  if (callerTeam !== 0 && callerTeam !== 1) {
    throw new Error("Finished game has no valid final caller");
  }

  const cumulative = cumulativeScore(rounds);
  const winnerTeam = decideScoreWinner(cumulative, callerTeam);

  return {
    didWin: playerTeam === winnerTeam,
    myTeamPoints:
      playerTeam === 0 ? cumulative.team0.points : cumulative.team1.points,
    opponentTeamPoints:
      playerTeam === 0 ? cumulative.team1.points : cumulative.team0.points,
    winnerTeam,
  };
}
