import type { Team } from "../../contract/cards";
import type { Score, TeamScore } from "../../contract/game";

/** Real points and the figures remainder (thirds of a point) of a raw score. */
export function toTeamScore(raw: number): TeamScore {
  return { points: Math.floor(raw / 3), figures: raw % 3 };
}

/** Cumulative score across the given rounds, summed on raw points. */
export function sumRoundScores(
  rounds: { team0Raw: number; team1Raw: number }[],
): Score {
  let team0 = 0;
  let team1 = 0;
  for (const round of rounds) {
    team0 += round.team0Raw;
    team1 += round.team1Raw;
  }
  return { team0: toTeamScore(team0), team1: toTeamScore(team1) };
}

/**
 * Winner once a team reaches the game threshold, mirroring ai/becca_env/game.py
 * (_end_round): if BOTH teams cross in the same round the higher real total
 * wins, and an exact real-point tie goes to the caller's team. Returns null
 * while neither team has reached winPoints.
 */
export function decideGameWinner(
  cumulative: Score,
  winPoints: number,
  callerTeam: Team,
): Team | null {
  const team0Won = cumulative.team0.points >= winPoints;
  const team1Won = cumulative.team1.points >= winPoints;

  if (!team0Won && !team1Won) return null;
  if (team0Won && team1Won) return decideScoreWinner(cumulative, callerTeam);
  return team0Won ? 0 : 1;
}

/** Resolve a finished game's winner; exact point ties go to the final caller. */
function decideScoreWinner(
  cumulative: Score,
  callerTeam: Team,
): Team {
  if (cumulative.team0.points > cumulative.team1.points) return 0;
  if (cumulative.team1.points > cumulative.team0.points) return 1;
  return callerTeam;
}
