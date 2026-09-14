import {
  setupGame,
  chooseBriscola,
  oneHand,
  oneRound,
} from "../helpers/gameDriver";
import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";

beforeEach(async () => {
  await clearDatabase();
});

describe("Game flow", () => {
  it("sets up a game, chooses briscola, and plays a full round", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await oneRound(roomCode, round);
  });

  it("refreshes room activity after briscola selection and card play", async () => {
    const { roomCode, round, cards } = await setupGame();
    const staleActivity = new Date("2026-08-20T00:00:00.000Z");

    await prisma.gameRoom.update({
      where: { code: roomCode },
      data: { isPractice: true, lastActivityAt: staleActivity },
    });
    await chooseBriscola(roomCode, round, cards);

    const afterBriscola = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      select: { lastActivityAt: true },
    });
    expect(afterBriscola.lastActivityAt.getTime()).toBeGreaterThan(
      staleActivity.getTime(),
    );

    await prisma.gameRoom.update({
      where: { code: roomCode },
      data: { lastActivityAt: staleActivity },
    });
    await oneHand(roomCode, round, 1);

    const afterCardPlay = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      select: { lastActivityAt: true },
    });
    expect(afterCardPlay.lastActivityAt.getTime()).toBeGreaterThan(
      staleActivity.getTime(),
    );
  });
});
