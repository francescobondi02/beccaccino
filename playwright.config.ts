import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:8081";
const reuseExistingServer = process.env.E2E_REUSE_SERVERS === "true";
const useExternalServers = process.env.E2E_EXTERNAL_SERVERS === "true";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    [
      "html",
      {
        open: "never",
        outputFolder:
          process.env.PLAYWRIGHT_REPORT_DIR ?? "playwright-report",
      },
    ],
  ],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  timeout: 60_000,

  use: {
    baseURL,
    trace: "on-first-retry",
    video: "on-first-retry",
    screenshot: "only-on-failure",
  },

  webServer: useExternalServers
    ? undefined
    : [
        {
          command: "cd ../backend && npm run dev:e2e",
          url: "http://localhost:8000/health",
          reuseExistingServer,
          timeout: 30_000,
        },
        {
          command: "npm run dev",
          url: baseURL,
          reuseExistingServer,
          timeout: 30_000,
        },
      ],
});
