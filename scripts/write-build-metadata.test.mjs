import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveCommit,
  validateProductionEnvironment,
  writeBuildMetadata,
} from "./write-build-metadata.mjs";

test("prefers the Vercel commit", () => {
  assert.equal(
    resolveCommit({
      VERCEL_GIT_COMMIT_SHA: "vercel",
      GITHUB_SHA: "github",
      GIT_COMMIT_SHA: "explicit",
    }),
    "vercel",
  );
});

test("requires traceable HTTPS production configuration", () => {
  assert.throws(
    () =>
      validateProductionEnvironment({
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_SHA: "commit",
        VITE_API_URL: "http://backend.example/api",
        VITE_SOCKET_URL: "https://backend.example",
      }),
    /VITE_API_URL must use HTTPS/,
  );
});

test("requires a commit in production", () => {
  assert.throws(
    () =>
      validateProductionEnvironment({
        VERCEL_ENV: "production",
        VITE_API_URL: "https://backend.example/api",
        VITE_SOCKET_URL: "https://backend.example",
      }),
    /commit SHA is required/,
  );
});

test("accepts the explicit GitHub Actions commit in production", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment({
      VERCEL_ENV: "production",
      GIT_COMMIT_SHA: "github-actions-commit",
      VITE_API_URL: "https://backend.example/api",
      VITE_SOCKET_URL: "https://backend.example",
    }),
  );
});

test("writes public deployment metadata", async () => {
  const outputPath = path.join(
    tmpdir(),
    `becca-frontend-version-${process.pid}.json`,
  );

  try {
    const metadata = await writeBuildMetadata({
      environment: { GITHUB_SHA: "github-commit" },
      outputPath,
    });

    assert.deepEqual(metadata, {
      service: "frontend",
      commit: "github-commit",
    });
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), metadata);
  } finally {
    await unlink(outputPath).catch(() => undefined);
  }
});
