import { createHash } from "crypto";
import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";
import { PrismaClient } from "@prisma/client";
import { annotationExportRecords } from "./exportAnnotations";
import {
  AnnotationImportSummary,
  importLoadedAnnotationBatch,
  readAnnotationBatch,
} from "./importAnnotationScenarios";
import {
  ANNOTATION_DATABASE_USAGE,
  parseAnnotationDatabaseArgs,
} from "./annotationDatabaseCli";
import {
  AnnotationDatabaseTargets,
  DatabaseUrlDescription,
  loadEnvironmentFile,
} from "./annotationEnvironment";
import { annotationDatabaseStatus } from "./annotationDatabaseStatus";
import { writeAnnotationExportFile } from "./atomicAnnotationExport";
import { BACKEND_DIRECTORY } from "./annotationToolPaths";

interface ImportPlanTokenInput {
  readonly targets: AnnotationDatabaseTargets;
  readonly connectionSha256: string;
  readonly toolSha256: string;
  readonly batchId: string;
  readonly batchSha256: string;
  readonly replaceActive: boolean;
  readonly summary: AnnotationImportSummary;
}

export function annotationImportPlanToken(input: ImportPlanTokenInput): string {
  const payload = {
    version: 2,
    targets: input.targets,
    connectionSha256: input.connectionSha256,
    toolSha256: input.toolSha256,
    batchId: input.batchId,
    batchSha256: input.batchSha256,
    replaceActive: input.replaceActive,
    catalogSha256: input.summary.catalogSha256,
    validated: input.summary.validated,
    wouldInsert: input.summary.wouldInsert,
    skipped: input.summary.skipped,
    wouldActivate: input.summary.wouldActivate,
    wouldDeactivate: input.summary.wouldDeactivate,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function listToolFiles(
  directory: string,
  extension: string,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listToolFiles(path, extension);
      return entry.isFile() && entry.name.endsWith(extension) ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

async function annotationDatabaseToolSha256(): Promise<string> {
  const sourceDirectory = join(BACKEND_DIRECTORY, "src");
  const sourceFiles = await listToolFiles(sourceDirectory, ".ts");
  const compiledFiles = sourceFiles.map((path) =>
    join(
      BACKEND_DIRECTORY,
      "dist",
      relative(sourceDirectory, path).replace(/\.ts$/, ".js"),
    ),
  );
  const files = [
    ...sourceFiles,
    ...compiledFiles,
    ...(await listToolFiles(
      join(BACKEND_DIRECTORY, "scripts", "annotations"),
      ".sh",
    )),
  ];
  files.push(
    join(BACKEND_DIRECTORY, "package.json"),
    join(BACKEND_DIRECTORY, "package-lock.json"),
    join(BACKEND_DIRECTORY, "prisma", "schema.prisma"),
    join(BACKEND_DIRECTORY, "tsconfig.json"),
  );
  files.sort();

  const hash = createHash("sha256").update(`node=${process.version}\0`);
  for (const path of files) {
    hash.update(`${relative(BACKEND_DIRECTORY, path)}\0`);
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function formatTarget(target: DatabaseUrlDescription): string {
  return `${target.host}:${target.port}/${target.database}`;
}

async function main() {
  const command = parseAnnotationDatabaseArgs(process.argv.slice(2));
  if (command.command === "help") {
    process.stdout.write(ANNOTATION_DATABASE_USAGE);
    return;
  }

  const environment = await loadEnvironmentFile(command.envFile);
  const { targets } = environment;
  process.stderr.write(
    `Annotation database target: pooled=${formatTarget(targets.pooled)} ` +
      `direct=${formatTarget(targets.direct)}\n`,
  );

  if (command.command === "import") {
    const toolSha256 = await annotationDatabaseToolSha256();
    const batch = await readAnnotationBatch(
      command.batchPath,
      command.manifestPath,
    );
    const tokenFor = (summary: AnnotationImportSummary) =>
      annotationImportPlanToken({
        targets,
        connectionSha256: environment.connectionSha256,
        toolSha256,
        batchId: batch.manifest.batchId,
        batchSha256: batch.manifest.batchSha256,
        replaceActive: command.replaceActive,
        summary,
      });
    const summary = await importLoadedAnnotationBatch(batch, {
      apply: command.apply,
      replaceActive: command.replaceActive,
      validatePlan: command.apply
        ? (plan) => {
            if (tokenFor(plan) !== command.confirmPlan) {
              throw new Error(
                "database state or import inputs differ from the confirmed dry-run plan",
              );
            }
          }
        : undefined,
    });
    process.stdout.write(
      `${JSON.stringify({
        ...summary,
        planToken: tokenFor({
          ...summary,
          inserted: 0,
          activated: 0,
          deactivated: 0,
          applied: false,
        }),
      })}\n`,
    );
    return;
  }

  const prisma = new PrismaClient({ log: [] });
  try {
    if (command.command === "status") {
      const status = await annotationDatabaseStatus(prisma);
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    const salt = process.env.ANNOTATION_EXPORT_SALT;
    if (!salt || salt.length < 16) {
      throw new Error(
        "ANNOTATION_EXPORT_SALT must contain at least 16 characters",
      );
    }
    const records = await annotationExportRecords(prisma, salt);
    const output = await writeAnnotationExportFile(command.outputPath, records);
    process.stdout.write(
      `${JSON.stringify({ exported: records.length, output })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Annotation database command failed: ${message}\n`);
    process.exitCode = 1;
  });
}
