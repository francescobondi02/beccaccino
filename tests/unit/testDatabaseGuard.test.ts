import { assertSafeTestDatabase } from "../loadTestEnv";

const testUrl = "postgresql://postgres:postgres@localhost:5432/becca_test?connection_limit=5";

function testEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: testUrl,
    DIRECT_URL: testUrl,
    ...overrides,
  };
}

describe("test database guard", () => {
  it("accepts the isolated local test database", () => {
    expect(() => assertSafeTestDatabase(testEnv())).not.toThrow();
  });

  it("rejects an unsafe test database before loading application modules", () => {
    const env = jest.replaceProperty(process, "env", {
      ...process.env,
      TEST_DATABASE_URL: "postgresql://user:password@db.example.com:5432/becca_test",
    });
    try {
      expect(() => jest.isolateModules(() => require("../loadTestEnv"))).toThrow(
        "DATABASE_URL",
      );
    } finally {
      env.restore();
    }
  });

  it.each([
    ["non-test environment", { NODE_ENV: "development" }, "NODE_ENV"],
    ["missing URL", { DATABASE_URL: undefined }, "DATABASE_URL"],
    ["malformed URL", { DATABASE_URL: "not-a-url" }, "DATABASE_URL"],
    [
      "remote host",
      { DATABASE_URL: "postgresql://user:pass@db.example.com:5432/becca_test" },
      "DATABASE_URL",
    ],
    [
      "different database",
      { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/becca" },
      "DATABASE_URL",
    ],
    [
      "unsafe direct URL",
      { DIRECT_URL: "postgresql://user:pass@db.example.com:5432/becca_test" },
      "DIRECT_URL",
    ],
  ])("rejects %s", (_case, overrides, expectedMessage) => {
    expect(() => assertSafeTestDatabase(testEnv(overrides))).toThrow(expectedMessage);
  });
});

export {};
