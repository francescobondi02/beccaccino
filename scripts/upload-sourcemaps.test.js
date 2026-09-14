const assert = require("node:assert/strict");
const {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { afterEach, test } = require("node:test");

const script = path.resolve(__dirname, "upload-sourcemaps.js");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function environment(overrides = {}) {
  const env = { ...process.env };
  for (const name of [
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
    "SENTRY_RELEASE",
    "RENDER_GIT_COMMIT",
  ]) {
    delete env[name];
  }
  return { ...env, ...overrides };
}

function fakeNpx(exitCode = 0) {
  const directory = mkdtempSync(path.join(tmpdir(), "becca-sentry-test-"));
  temporaryDirectories.push(directory);

  const executable = path.join(directory, "npx");
  writeFileSync(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "$SENTRY_ARGS_FILE"\nexit ${exitCode}\n`,
  );
  chmodSync(executable, 0o755);
  return directory;
}

test("skips when upload configuration is incomplete", () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: environment({
      SENTRY_AUTH_TOKEN: "token",
      SENTRY_ORG: "org",
    }),
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /SENTRY_PROJECT/);
  assert.match(result.stdout, /SENTRY_RELEASE\/RENDER_GIT_COMMIT/);
});

test("uploads the release with the configured project", () => {
  const directory = fakeNpx();
  const argsFile = path.join(directory, "args");
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: environment({
      PATH: `${directory}:${process.env.PATH}`,
      SENTRY_ARGS_FILE: argsFile,
      SENTRY_AUTH_TOKEN: "token",
      SENTRY_ORG: "becca",
      SENTRY_PROJECT: "backend",
      SENTRY_RELEASE: "commit-sha",
    }),
  });

  assert.equal(result.status, 0);
  assert.deepEqual(readFileSync(argsFile, "utf8").trim().split("\n"), [
    "@sentry/cli",
    "sourcemaps",
    "upload",
    "--release",
    "commit-sha",
    "--org",
    "becca",
    "--project",
    "backend",
    path.resolve(__dirname, "..", "dist"),
  ]);
});

test("propagates an upload failure", () => {
  const directory = fakeNpx(9);
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: environment({
      PATH: `${directory}:${process.env.PATH}`,
      SENTRY_ARGS_FILE: path.join(directory, "args"),
      SENTRY_AUTH_TOKEN: "token",
      SENTRY_ORG: "becca",
      SENTRY_PROJECT: "backend",
      RENDER_GIT_COMMIT: "render-sha",
    }),
  });

  assert.equal(result.status, 9);
});
