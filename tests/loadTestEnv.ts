// Runs via Jest setupFiles (before any module is loaded) so PrismaClient picks up
// the test database instead of the dev one from .env.
export function assertSafeTestDatabase(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "test") {
    throw new Error("Refusing destructive database operation: NODE_ENV must be test");
  }

  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    let url: URL;
    try {
      url = new URL(env[name] ?? "");
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

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/becca_test?connection_limit=5";
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = testDatabaseUrl;

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.ALLOW_TEST_AUTH_BYPASS = "true";
process.env.GAME_WIN_POINTS = "5";

assertSafeTestDatabase(process.env);
