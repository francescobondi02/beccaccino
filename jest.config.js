const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

const sharedConfig = {
  testEnvironment: "node",
  transform: { ...tsJestTransformCfg },
};

/** @type {import("jest").Config} **/
module.exports = {
  projects: [
    {
      ...sharedConfig,
      displayName: "unit",
      testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
      // Unit tests never touch the DB, but they import src/db.ts transitively
      // and PrismaClient validates its datasource URL at construction — the
      // generated client no longer auto-loads .env (prisma CLI 6.19).
      setupFiles: ["<rootDir>/tests/loadTestEnv.ts"],
      setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
    },
    {
      ...sharedConfig,
      displayName: "integration",
      testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
      // setupFiles runs before any module is imported, so PrismaClient picks up
      // the test DATABASE_URL before it is instantiated.
      setupFiles: ["<rootDir>/tests/loadTestEnv.ts"],
      setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
    },
  ],
  globalTeardown: "<rootDir>/tests/teardown.ts",
};
