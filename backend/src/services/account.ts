import { randomUUID } from "crypto";
import { prisma } from "../db";
import { conflict, notFound } from "../http/errors";

const ACCOUNT_SELECT = {
  id: true,
  username: true,
  email: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function getAccount(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: ACCOUNT_SELECT,
  });
  if (!user) throw notFound("User not found");
  return user;
}

export async function updateUsername(userId: number, username: string) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing && existing.id !== userId) {
    throw conflict("Username already taken");
  }

  return prisma.user.update({
    where: { id: userId },
    data: { username },
    select: ACCOUNT_SELECT,
  });
}

export async function deleteAccount(userId: number): Promise<void> {
  const activeGames = await prisma.player.findMany({
    where: {
      userId,
      gameRoom: { finished: false, started: true },
    },
  });
  if (activeGames.length > 0) {
    throw conflict(
      "Cannot delete account while in an active game. Finish multiplayer games or abandon practice games first.",
    );
  }

  await prisma.player.deleteMany({
    where: {
      userId,
      gameRoom: { started: false },
    },
  });
  const anonToken = randomUUID();
  await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      username: `deleted_user_${userId}_${anonToken}`,
      email: `deleted_user_${userId}_${anonToken}@deleted.invalid`,
      password: null,
      expertAccessGrantedAt: null,
    },
  });
}
