import { link, mkdtemp, open, realpath, rm } from "fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";
import { BACKEND_DIRECTORY } from "./annotationToolPaths";

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
