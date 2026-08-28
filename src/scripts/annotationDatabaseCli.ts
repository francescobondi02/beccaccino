import { isAbsolute, relative, resolve, sep } from "path";
import { BACKEND_DIRECTORY } from "./annotationToolPaths";

export type AnnotationDatabaseCommand =
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

export const ANNOTATION_DATABASE_USAGE = `Usage:
  annotationDatabase status --env-file <path>
  annotationDatabase import <batch.json> <manifest.json> --env-file <path> [--replace-active]
  annotationDatabase import <batch.json> <manifest.json> --env-file <path> --apply --confirm-plan <token> [--replace-active]
  annotationDatabase export --env-file <path> --output </absolute/path/annotations.jsonl>

Database commands do not write to the database unless import includes --apply.
A dry run emits the plan token required by apply. Export requires
ANNOTATION_EXPORT_SALT and atomically creates a new mode-600 JSONL file without
overwriting an existing path.
`;

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
