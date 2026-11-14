import { sumRoundScores } from "../domain/game/gameScore";

export type PlayerGameSummary = {
  didWin: boolean;
  myTeamPoints: number;
  opponentTeamPoints: number;
};

export function summarizePlayerGame(
  playerTeam: number | null,
  winnerTeam: number | null,
  rounds: { team0Raw: number; team1Raw: number }[],
): PlayerGameSummary {
  if (playerTeam !== 0 && playerTeam !== 1) {
    throw new Error("Finished game player has no valid team");
  }
  const cumulative = sumRoundScores(rounds);
  return {
    didWin: playerTeam === winnerTeam,
    myTeamPoints:
      playerTeam === 0 ? cumulative.team0.points : cumulative.team1.points,
    opponentTeamPoints:
      playerTeam === 0 ? cumulative.team1.points : cumulative.team0.points,
  };
}
