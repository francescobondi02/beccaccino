export type BuildEnvironment = Record<string, string | undefined>;

export function resolveSentryUpload(env: BuildEnvironment) {
  const release =
    env.VITE_SENTRY_RELEASE ||
    env.VERCEL_GIT_COMMIT_SHA ||
    env.GIT_COMMIT_SHA ||
    env.RENDER_GIT_COMMIT;

  if (
    !env.SENTRY_AUTH_TOKEN ||
    !env.SENTRY_ORG ||
    !env.SENTRY_PROJECT ||
    !release
  ) {
    return null;
  }

  return {
    authToken: env.SENTRY_AUTH_TOKEN,
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
    release,
    sourceMap: "hidden" as const,
    filesToDeleteAfterUpload: "dist/**/*.map",
  };
}
