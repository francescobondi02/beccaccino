import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    // Render injects RENDER_GIT_COMMIT for git-deploys; fall back to an
    // explicit override if the deploy pipeline sets one. Without a release
    // tag, uploaded source maps won't match.
    release:
      process.env.SENTRY_RELEASE || process.env.RENDER_GIT_COMMIT || undefined,
    tracesSampleRate: 0.2,
    sendDefaultPii: false,
  });
}
