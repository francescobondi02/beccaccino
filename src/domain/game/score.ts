// src/domain/game/score.ts
//
// Per-round scores are stored as real points + a figures remainder in separate
// columns (raw = points * RAW_PER_POINT + figures). Cumulative totals therefore
// MUST be summed on RAW and re-split, or each round's figures are silently
// dropped. This mirrors ai/becca_env/game.py (_end_round), the reference
// semantics: it accumulates raw and derives real points as raw // 3.

/** Real points per raw point — the divisor behind the points/figures split. */
const RAW_PER_POINT = 3;

export interface RoundScoreRow {
  team0Points: number;
  team1Points: number;
  team0Figures: number;
  team1Figures: number;
}

export interface TeamScore {
  points: number;
  figures: number;
}

export interface CumulativeScore {
  team0: TeamScore;
  team1: TeamScore;
}

export type Team = 0 | 1;

/**
 * Cumulative real points across the given rounds, computed on raw totals so a
 * round's figures remainder carries into whole points instead of being lost.
 */
export function cumulativeScore(rounds: RoundScoreRow[]): CumulativeScore {
  let rawTeam0 = 0;
  let rawTeam1 = 0;
  for (const round of rounds) {
    rawTeam0 += round.team0Points * RAW_PER_POINT + round.team0Figures;
    rawTeam1 += round.team1Points * RAW_PER_POINT + round.team1Figures;
  }
  return {
    team0: {
      points: Math.floor(rawTeam0 / RAW_PER_POINT),
      figures: rawTeam0 % RAW_PER_POINT,
    },
    team1: {
      points: Math.floor(rawTeam1 / RAW_PER_POINT),
      figures: rawTeam1 % RAW_PER_POINT,
    },
  };
}

/**
 * Winner once a team reaches the game threshold, mirroring ai/becca_env/game.py
 * (_end_round): if BOTH teams cross in the same round the higher real total
 * wins, and an exact real-point tie goes to the caller's team. Returns null
 * while neither team has reached winPoints.
 */
export function decideGameWinner(
  cumulative: CumulativeScore,
  winPoints: number,
  callerTeam: Team,
): Team | null {
  const team0Points = cumulative.team0.points;
  const team1Points = cumulative.team1.points;
  const team0Won = team0Points >= winPoints;
  const team1Won = team1Points >= winPoints;

  if (!team0Won && !team1Won) return null;
  if (team0Won && team1Won) return decideScoreWinner(cumulative, callerTeam);
  return team0Won ? 0 : 1;
}

/** Resolve a finished game's winner; exact point ties go to the final caller. */
export function decideScoreWinner(
  cumulative: CumulativeScore,
  callerTeam: Team,
): Team {
  if (cumulative.team0.points > cumulative.team1.points) return 0;
  if (cumulative.team1.points > cumulative.team0.points) return 1;
  return callerTeam;
}
