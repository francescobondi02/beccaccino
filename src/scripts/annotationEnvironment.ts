import { createHash } from "crypto";
import { constants } from "fs";
import { open } from "fs/promises";
import { parseEnv } from "node:util";

export interface DatabaseUrlDescription {
  readonly host: string;
  readonly port: string;
  readonly database: string;
}

export interface AnnotationDatabaseTargets {
  readonly pooled: DatabaseUrlDescription;
  readonly direct: DatabaseUrlDescription;
}

export interface LoadedAnnotationEnvironment {
  readonly targets: AnnotationDatabaseTargets;
  readonly connectionSha256: string;
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

  const parsed = parseEnv(contents.toString("utf8")) as Record<string, string>;
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
