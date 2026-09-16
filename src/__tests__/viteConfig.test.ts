import { describe, expect, it } from "vitest";
import { resolveSentryUpload } from "../../sentryBuildConfig";

describe("source map build configuration", () => {
  it("disables source maps without Sentry upload configuration", () => {
    const config = resolveSentryUpload({});

    expect(config).toBeNull();
  });

  it("disables source maps when the release is missing", () => {
    const config = resolveSentryUpload({
      SENTRY_AUTH_TOKEN: "token",
      SENTRY_ORG: "becca",
      SENTRY_PROJECT: "frontend",
    });

    expect(config).toBeNull();
  });

  it("generates hidden maps only for a complete upload configuration", () => {
    const config = resolveSentryUpload({
      SENTRY_AUTH_TOKEN: "token",
      SENTRY_ORG: "becca",
      SENTRY_PROJECT: "frontend",
      VITE_SENTRY_RELEASE: "commit-sha",
    });

    expect(config).toEqual({
      authToken: "token",
      org: "becca",
      project: "frontend",
      release: "commit-sha",
      sourceMap: "hidden",
      filesToDeleteAfterUpload: "dist/**/*.map",
    });
  });
});
