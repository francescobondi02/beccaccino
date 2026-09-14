import { PrismaClient } from "@prisma/client";

export async function annotationDatabaseStatus(prisma: PrismaClient) {
  const [catalogGroups, responseCount] = await Promise.all([
    prisma.annotationScenario.groupBy({
      by: ["sourceBatch", "decisionType", "predictedDifficulty", "active"],
      _count: { _all: true },
      orderBy: [
        { sourceBatch: "asc" },
        { decisionType: "asc" },
        { predictedDifficulty: "asc" },
        { active: "desc" },
      ],
    }),
    prisma.expertAnnotation.count(),
  ]);
  const catalogs = catalogGroups.map((group) => ({
    sourceBatch: group.sourceBatch,
    decisionType: group.decisionType,
    predictedDifficulty: group.predictedDifficulty,
    active: group.active,
    count: group._count._all,
  }));
  return {
    scenarioCount: catalogs.reduce((sum, group) => sum + group.count, 0),
    activeScenarioCount: catalogs.reduce(
      (sum, group) => sum + (group.active ? group.count : 0),
      0,
    ),
    responseCount,
    catalogs,
  };
}
