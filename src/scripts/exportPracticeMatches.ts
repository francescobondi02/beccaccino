// src/scripts/exportPracticeMatches.ts
/**
 * Emit archived practice games as JSONL, one game per line, for offline
 * training.
 *
 * Each game keeps its complete replay as context, but `humanActions` contains
 * only direct human choices.
 */

import { PracticeMatch, PrismaClient } from "@prisma/client";

const SUPPORTED_SCHEMA_VERSION = 1;
type ArchivedRound = {
  humanActions?: unknown[];
};

export function practiceExportRecord(match: PracticeMatch) {
  if (match.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `match ${match.id} uses unsupported schema version ${match.schemaVersion}`,
    );
  }
  const rounds = (match.payload as { rounds?: ArchivedRound[] } | null)?.rounds;
  if (!rounds?.length) throw new Error(`match ${match.id} has no rounds`);
  if (
    !rounds.some(
      (round) =>
        Array.isArray(round.humanActions) && round.humanActions.length > 0,
    )
  ) {
    throw new Error(`match ${match.id} has no human actions`);
  }

  return {
    id: match.id,
    humanSeat: match.humanSeat,
    botTier: match.botTier,
    completed: match.completed,
    schemaVersion: match.schemaVersion,
    payload: match.payload,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
  };
}

async function main() {
  const prisma = new PrismaClient({ log: [] });
  try {
    const matches = await prisma.practiceMatch.findMany({
      orderBy: { id: "asc" },
    });
    const records = matches.map(practiceExportRecord);
    for (const record of records) {
      process.stdout.write(`${JSON.stringify(record)}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Practice match export failed: ${message}\n`);
    process.exitCode = 1;
  });
}
