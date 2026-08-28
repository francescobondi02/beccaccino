import { prisma } from "../db";
import { JwtPayload, verifyToken } from "../utils/jwt";

export async function verifyActiveSession(
  token: string,
): Promise<JwtPayload | null> {
  const decoded = verifyToken(token);
  if (!decoded) return null;

  const user = await prisma.user.findFirst({
    where: {
      id: decoded.userId,
      deletedAt: null,
    },
    select: {
      id: true,
      username: true,
    },
  });

  return user ? { userId: user.id, username: user.username } : null;
}

export function authTokenFromCookieHeader(
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader) return null;

  for (const entry of cookieHeader.split(";")) {
    const [name, ...valueParts] = entry.trim().split("=");
    if (name === "authToken") {
      const value = valueParts.join("=");
      return value.length > 0 ? decodeURIComponent(value) : null;
    }
  }
  return null;
}
