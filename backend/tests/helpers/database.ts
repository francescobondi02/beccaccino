import { prisma } from "../../src/db";

export async function clearDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.expertAnnotation.deleteMany(),
    prisma.annotationScenario.deleteMany(),
    prisma.practiceMatch.deleteMany(),
    prisma.playedCard.deleteMany(),
    prisma.playerCard.deleteMany(),
    prisma.hand.deleteMany(),
    prisma.round.deleteMany(),
    prisma.player.deleteMany(),
    prisma.gameRoom.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
