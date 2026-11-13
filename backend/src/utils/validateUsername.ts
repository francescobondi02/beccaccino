const USERNAME_MIN_LENGTH = 3;
// Usernames flow verbatim to broadcast surfaces (chat, leaderboard, seats);
// the cap keeps a hostile registration from wrecking every client's layout.
export const USERNAME_MAX_LENGTH = 20;

type UsernameResult = { ok: true; value: string } | { ok: false; error: string };

/** Shared by registration and profile update so the two paths cannot drift. */
export function validateUsername(username: unknown): UsernameResult {
  if (typeof username !== "string") {
    return { ok: false, error: "Username is required" };
  }
  const trimmed = username.trim();
  if (trimmed.length < USERNAME_MIN_LENGTH) {
    return {
      ok: false,
      error: `Username must be at least ${USERNAME_MIN_LENGTH} characters`,
    };
  }
  if (trimmed.length > USERNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Username must be at most ${USERNAME_MAX_LENGTH} characters`,
    };
  }
  return { ok: true, value: trimmed };
}
