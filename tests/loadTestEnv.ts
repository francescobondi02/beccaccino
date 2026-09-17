// Runs via Jest setupFiles (before any module is loaded) so PrismaClient picks up
// the test database instead of the dev one from .env.
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/becca_test?connection_limit=5";
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = testDatabaseUrl;

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.ALLOW_TEST_AUTH_BYPASS = "true";
process.env.GAME_WIN_POINTS = "5";

export {};
