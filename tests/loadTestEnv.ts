// Runs via Jest setupFiles (before any module is loaded) so PrismaClient picks up
// the test DATABASE_URL instead of the dev one from .env.
process.env.DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/becca_test?connection_limit=5";
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.ALLOW_TEST_AUTH_BYPASS = "true";
process.env.GAME_WIN_POINTS = "5";