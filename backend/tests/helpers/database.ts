import { prisma } from "../../src/db";

export async function clearDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.playedCard.deleteMany(),
    prisma.handCard.deleteMany(),
    prisma.trick.deleteMany(),
    prisma.round.deleteMany(),
    prisma.player.deleteMany(),
    prisma.gameRoom.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
