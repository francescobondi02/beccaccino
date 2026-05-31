// Frontend Sentry user context helper. Centralizes setUser/clearUser so
// every error report from a logged-in session carries the user id +
// username, and logout clears it.
//
// No-op when Sentry isn't initialized — safe to call unconditionally.

import * as Sentry from "@sentry/react";

export function setSentryUser(user: { id: number; username: string }) {
  Sentry.setUser({ id: String(user.id), username: user.username });
}

export function clearSentryUser() {
  Sentry.setUser(null);
}
