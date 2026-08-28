#!/usr/bin/env node
// Upload backend source maps to Sentry. Skips if any required environment
// variable is missing so local and secret-free CI builds remain usable.
//
// Required env at upload time:
//   SENTRY_AUTH_TOKEN  — auth token with `project:releases` scope
//   SENTRY_ORG         — Sentry org slug
//   SENTRY_PROJECT     — Sentry project slug (backend project)
//   SENTRY_RELEASE     — release identifier (we default to RENDER_GIT_COMMIT)
//
// Run via `npm run sentry:sourcemaps` after `npm run build`.

const { spawnSync } = require("child_process");
const path = require("path");

const required = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"];
const missing = required.filter((name) => !process.env[name]);

const release =
  process.env.SENTRY_RELEASE || process.env.RENDER_GIT_COMMIT || "";

if (missing.length || !release) {
  console.log(
    `[sentry] skipping source map upload (missing: ${[...missing, !release && "SENTRY_RELEASE/RENDER_GIT_COMMIT"]
      .filter(Boolean)
      .join(", ")})`,
  );
  process.exit(0);
}

const distDir = path.resolve(__dirname, "..", "dist");
const args = [
  "sourcemaps",
  "upload",
  "--release",
  release,
  "--org",
  process.env.SENTRY_ORG,
  "--project",
  process.env.SENTRY_PROJECT,
  distDir,
];

const result = spawnSync("npx", ["@sentry/cli", ...args], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
