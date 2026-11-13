import { JwtPayload } from "../utils/jwt";

export function isTestAuthBypassEnabled(explicit?: boolean): boolean {
  return (
    process.env.NODE_ENV === "test" &&
    (explicit ?? process.env.ALLOW_TEST_AUTH_BYPASS === "true")
  );
}

export function testRequestIdentity(
  headers: Record<string, string | string[] | undefined>,
): JwtPayload | null {
  const rawUserId = headers["x-test-user-id"];
  const rawUsername = headers["x-test-username"];
  if (typeof rawUserId !== "string" || typeof rawUsername !== "string") {
    return null;
  }

  const userId = Number(rawUserId);
  if (!Number.isInteger(userId) || userId < 1 || rawUsername.length === 0) {
    return null;
  }
  return { userId, username: rawUsername };
}
