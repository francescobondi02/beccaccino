import { createHash } from "crypto";
import { constants } from "fs";
import {
  link,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
} from "fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";
import { PrismaClient } from "@prisma/client";
import { parse as parseDotenv } from "dotenv";
import { annotationExportRecords } from "./exportAnnotations";
import {
  AnnotationImportSummary,
  importLoadedAnnotationBatch,
  readAnnotationBatch,
} from "./importAnnotationScenarios";

type AnnotationDatabaseCommand =
  | { command: "help" }
  | { command: "status"; envFile: string }
  | { command: "export"; envFile: string; outputPath: string }
  | {
      command: "import";
      envFile: string;
      batchPath: string;
      manifestPath: string;
      apply: boolean;
      replaceActive: boolean;
      confirmPlan?: string;
    };

export interface DatabaseUrlDescription {
  readonly host: string;
  readonly port: string;
  readonly database: string;
}

export interface AnnotationDatabaseTargets {
  readonly pooled: DatabaseUrlDescription;
  readonly direct: DatabaseUrlDescription;
}

interface ImportPlanTokenInput {
  readonly targets: AnnotationDatabaseTargets;
  readonly connectionSha256: string;
  readonly toolSha256: string;
  readonly batchId: string;
  readonly batchSha256: string;
  readonly replaceActive: boolean;
  readonly summary: AnnotationImportSummary;
}

const USAGE = `Usage:
  annotationDatabase status --env-file <path>
  annotationDatabase import <batch.json> <manifest.json> --env-file <path> [--replace-active]
  annotationDatabase import <batch.json> <manifest.json> --env-file <path> --apply --confirm-plan <token> [--replace-active]
  annotationDatabase export --env-file <path> --output </absolute/path/annotations.jsonl>

Database commands do not write to the database unless import includes --apply.
A dry run emits the plan token required by apply. Export requires
ANNOTATION_EXPORT_SALT and atomically creates a new mode-600 JSONL file without
overwriting an existing path.
`;

const BACKEND_DIRECTORY = resolve(__dirname, "../..");

function takeOption(
  args: readonly string[],
  name: string,
): { value?: string; remaining: string[] } {
  const indexes = args.flatMap((arg, index) => (arg === name ? [index] : []));
  if (indexes.length > 1) throw new Error(`${name} may be provided only once`);
  if (indexes.length === 0) return { remaining: [...args] };

  const index = indexes[0];
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return {
    value,
    remaining: args.filter(
      (_, currentIndex) => currentIndex !== index && currentIndex !== index + 1,
    ),
  };
}

function takeFlag(
  args: readonly string[],
  name: string,
): { present: boolean; remaining: string[] } {
  const count = args.filter((arg) => arg === name).length;
  if (count > 1) throw new Error(`${name} may be provided only once`);
  return {
    present: count === 1,
    remaining: args.filter((arg) => arg !== name),
  };
}

export function parseAnnotationDatabaseArgs(
  argv: readonly string[],
): AnnotationDatabaseCommand {
  if (
    argv.length === 0 ||
    argv[0] === "help" ||
    argv.includes("--help") ||
    argv.includes("-h")
  ) {
    return { command: "help" };
  }

  const command = argv[0];
  const envOption = takeOption(argv.slice(1), "--env-file");
  if (!envOption.value) throw new Error("--env-file is required");

  if (command === "status") {
    if (envOption.remaining.length > 0) {
      throw new Error(`unexpected argument: ${envOption.remaining[0]}`);
    }
    return { command, envFile: envOption.value };
  }

  if (command === "export") {
    const outputOption = takeOption(envOption.remaining, "--output");
    if (!outputOption.value) throw new Error("export requires --output <path>");
    if (!isAbsolute(outputOption.value)) {
      throw new Error(
        "--output must be an absolute path outside the backend checkout",
      );
    }
    const outputRelativeToBackend = relative(
      BACKEND_DIRECTORY,
      resolve(outputOption.value),
    );
    if (
      outputRelativeToBackend === "" ||
      (!outputRelativeToBackend.startsWith(`..${sep}`) &&
        outputRelativeToBackend !== ".." &&
        !isAbsolute(outputRelativeToBackend))
    ) {
      throw new Error("--output must be outside the backend checkout");
    }
    if (outputOption.remaining.length > 0) {
      throw new Error(`unexpected argument: ${outputOption.remaining[0]}`);
    }
    return {
      command,
      envFile: envOption.value,
      outputPath: outputOption.value,
    };
  }

  if (command !== "import") {
    throw new Error(`unknown command: ${command}`);
  }

  const applyFlag = takeFlag(envOption.remaining, "--apply");
  const replaceFlag = takeFlag(applyFlag.remaining, "--replace-active");
  const confirmation = takeOption(replaceFlag.remaining, "--confirm-plan");
  if (confirmation.remaining.length !== 2) {
    throw new Error("import requires a batch path and manifest path");
  }
  if (applyFlag.present && !confirmation.value) {
    throw new Error("--apply requires --confirm-plan <token>");
  }
  if (!applyFlag.present && confirmation.value) {
    throw new Error("--confirm-plan is valid only with --apply");
  }

  return {
    command: "import",
    envFile: envOption.value,
    batchPath: confirmation.remaining[0],
    manifestPath: confirmation.remaining[1],
    apply: applyFlag.present,
    replaceActive: replaceFlag.present,
    confirmPlan: confirmation.value,
  };
}

export function describeDatabaseUrl(value: string): DatabaseUrlDescription {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("database URL must be a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("database URL must use postgres or postgresql");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !database || database.includes("/")) {
    throw new Error("database URL must include one database name");
  }
  return {
    host: url.hostname,
    port: url.port || "5432",
    database,
  };
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

interface LoadedAnnotationEnvironment {
  readonly targets: AnnotationDatabaseTargets;
  readonly connectionSha256: string;
}

export async function loadEnvironmentFile(
  path: string,
): Promise<LoadedAnnotationEnvironment> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ELOOP"
    ) {
      throw new Error("--env-file must not be a symbolic link");
    }
    throw error;
  }

  let contents: Buffer;
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) throw new Error("--env-file must point to a file");
    if ((fileStat.mode & 0o077) !== 0) {
      throw new Error("--env-file permissions must be 600 or stricter");
    }
    contents = await handle.readFile();
  } finally {
    await handle.close();
  }

  const parsed = parseDotenv(contents);
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    if (!parsed[name]) throw new Error(`${name} is required in --env-file`);
    process.env[name] = parsed[name];
  }
  if (parsed.ANNOTATION_EXPORT_SALT) {
    process.env.ANNOTATION_EXPORT_SALT = parsed.ANNOTATION_EXPORT_SALT;
  } else {
    delete process.env.ANNOTATION_EXPORT_SALT;
  }

  const pooled = describeDatabaseUrl(parsed.DATABASE_URL);
  const direct = describeDatabaseUrl(parsed.DIRECT_URL);
  if (pooled.database !== direct.database) {
    throw new Error(
      "DATABASE_URL and DIRECT_URL must target the same database",
    );
  }
  const connectionSha256 = createHash("sha256")
    .update(
      JSON.stringify({
        databaseUrl: parsed.DATABASE_URL,
        directUrl: parsed.DIRECT_URL,
      }),
    )
    .digest("hex");
  return { targets: { pooled, direct }, connectionSha256 };
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

export async function writeAnnotationExportFile(
  outputPath: string,
  records: readonly unknown[],
): Promise<string> {
  const resolvedOutput = resolve(outputPath);
  const [canonicalParent, canonicalBackend] = await Promise.all([
    realpath(dirname(resolvedOutput)),
    realpath(BACKEND_DIRECTORY),
  ]);
  const outputRelativeToBackend = relative(canonicalBackend, canonicalParent);
  if (
    outputRelativeToBackend === "" ||
    (!outputRelativeToBackend.startsWith(`..${sep}`) &&
      outputRelativeToBackend !== ".." &&
      !isAbsolute(outputRelativeToBackend))
  ) {
    throw new Error("--output must be outside the backend checkout");
  }
  const canonicalOutput = join(canonicalParent, basename(resolvedOutput));
  const temporaryDirectory = await mkdtemp(
    join(canonicalParent, ".becca-annotation-export-"),
  );
  const temporaryPath = join(temporaryDirectory, basename(canonicalOutput));
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      const jsonl = records
        .map((record) => `${JSON.stringify(record)}\n`)
        .join("");
      await handle.writeFile(jsonl);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, canonicalOutput);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        throw new Error(
          `refusing to overwrite existing export: ${canonicalOutput}`,
        );
      }
      throw error;
    }
    return canonicalOutput;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function formatTarget(target: DatabaseUrlDescription): string {
  return `${target.host}:${target.port}/${target.database}`;
}

async function main() {
  const command = parseAnnotationDatabaseArgs(process.argv.slice(2));
  if (command.command === "help") {
    process.stdout.write(USAGE);
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
