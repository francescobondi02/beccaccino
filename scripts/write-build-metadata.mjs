import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_URL_VARIABLES = ["VITE_API_URL", "VITE_SOCKET_URL"];

export function resolveCommit(environment) {
  return (
    environment.VERCEL_GIT_COMMIT_SHA ||
    environment.GITHUB_SHA ||
    environment.GIT_COMMIT_SHA ||
    "unknown"
  );
}

export function validateProductionEnvironment(environment) {
  if (environment.VERCEL_ENV !== "production") return;

  if (resolveCommit(environment) === "unknown") {
    throw new Error(
      "A commit SHA is required for a traceable production deployment",
    );
  }

  for (const name of PRODUCTION_URL_VARIABLES) {
    const value = environment[name];
    if (!value) {
      throw new Error(`${name} is required for a production deployment`);
    }

    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be a valid URL`);
    }
    if (url.protocol !== "https:") {
      throw new Error(`${name} must use HTTPS in production`);
    }
  }
}

export async function writeBuildMetadata({
  environment = process.env,
  outputPath = path.resolve("public/version.json"),
} = {}) {
  validateProductionEnvironment(environment);
  const metadata = {
    service: "frontend",
    commit: resolveCommit(environment),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  await writeBuildMetadata();
}
