import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  ANNOTATION_DIFFICULTIES,
  ANNOTATION_DIFFICULTY_TARGETS,
  AnnotationDifficulty,
  isAnnotationDifficulty,
} from "./constants";

export type DifficultyCounts = Record<AnnotationDifficulty, number>;

export interface SelectedAnnotationScenario {
  id: number;
  code: string;
  state: Prisma.JsonValue;
  stateHash: string;
}

export function emptyDifficultyCounts(): DifficultyCounts {
  return { easy: 0, medium: 0, hard: 0 };
}

export function difficultySelectionOrder(
  counts: DifficultyCounts,
): AnnotationDifficulty[] {
  const nextTotal = Object.values(counts).reduce((sum, count) => sum + count, 0) + 1;
  return [...ANNOTATION_DIFFICULTY_TARGETS]
    .sort((left, right) => {
      const leftDeficit = left.share * nextTotal - counts[left.difficulty];
      const rightDeficit = right.share * nextTotal - counts[right.difficulty];
      return rightDeficit - leftDeficit;
    })
    .map(({ difficulty }) => difficulty);
}

async function userDifficultyCounts(userId: number): Promise<DifficultyCounts> {
  const responses = await prisma.expertAnnotation.findMany({
    where: { userId },
    select: {
      scenario: { select: { predictedDifficulty: true } },
    },
  });
  const counts = emptyDifficultyCounts();
  for (const response of responses) {
    const difficulty = response.scenario.predictedDifficulty;
    if (isAnnotationDifficulty(difficulty)) {
      counts[difficulty] += 1;
    }
  }
  return counts;
}

async function bestUnansweredScenario(
  userId: number,
  difficulty: AnnotationDifficulty,
): Promise<SelectedAnnotationScenario | null> {
  const rows = await prisma.$queryRaw<SelectedAnnotationScenario[]>(Prisma.sql`
    SELECT
      scenario."id",
      scenario."code",
      scenario."state",
      scenario."stateHash"
    FROM "AnnotationScenario" AS scenario
    LEFT JOIN "ExpertAnnotation" AS response
      ON response."scenarioId" = scenario."id"
    WHERE scenario."active" = true
      AND scenario."predictedDifficulty" = ${difficulty}
      AND NOT EXISTS (
        SELECT 1
        FROM "ExpertAnnotation" AS own_response
        WHERE own_response."scenarioId" = scenario."id"
          AND own_response."userId" = ${userId}
      )
    GROUP BY scenario."id"
    ORDER BY
      scenario."importance" / SQRT(1 + COUNT(response."id")) DESC,
      scenario."importance" DESC,
      scenario."id" ASC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function selectNextAnnotationScenario(
  userId: number,
): Promise<SelectedAnnotationScenario | null> {
  const counts = await userDifficultyCounts(userId);
  for (const difficulty of difficultySelectionOrder(counts)) {
    const scenario = await bestUnansweredScenario(userId, difficulty);
    if (scenario) return scenario;
  }

  // Defend against invalid historical difficulty strings without letting them
  // make active scenarios unreachable.
  const known = new Set<string>(ANNOTATION_DIFFICULTIES);
  const fallback = await prisma.annotationScenario.findFirst({
    where: {
      active: true,
      predictedDifficulty: { notIn: [...known] },
      annotations: { none: { userId } },
    },
    orderBy: { id: "asc" },
    select: { id: true, code: true, state: true, stateHash: true },
  });
  return fallback;
}
