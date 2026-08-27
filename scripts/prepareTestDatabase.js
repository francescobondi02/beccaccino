const { spawnSync } = require("node:child_process");

function assertSafeTestDatabase(env = process.env) {
  if (env.NODE_ENV !== "test") {
    throw new Error("Refusing destructive database operation: NODE_ENV must be test");
  }

  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    let url;
    try {
      url = new URL(env[name]);
    } catch {
      throw new Error(`Refusing destructive database operation: ${name} must be a valid URL`);
    }

    if (url.hostname !== "localhost" || url.pathname !== "/becca_test") {
      throw new Error(
        `Refusing destructive database operation: ${name} must target localhost/becca_test`,
      );
    }
  }
}

if (require.main === module) {
  assertSafeTestDatabase();
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("prisma/build/index.js"),
      "db",
      "push",
      "--skip-generate",
      "--accept-data-loss",
    ],
    { env: process.env, stdio: "inherit" },
  );

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

module.exports = { assertSafeTestDatabase };
