import request from "supertest";
import { prisma } from "../src/db";
import app from "../src/app";
import {
  setupGame,
  chooseBriscola,
  oneHand,
  oneRound,
} from "../src/utils/testUtils";

beforeEach(async () => {
  await prisma.$transaction([
    prisma.playedCard.deleteMany(),
    prisma.playerCard.deleteMany(),
    prisma.hand.deleteMany(),
    prisma.round.deleteMany(),
    prisma.player.deleteMany(),
    prisma.gameRoom.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

describe("Game flow", () => {
  it("Should create 4 users, one room, join all users, set teams, start the game, choose briscola, and play one hand", async () => {
    const { roomCode, round, cards } = await setupGame();

    await chooseBriscola(roomCode, round, cards);

    //await oneHand(roomCode, round);

    await oneRound(roomCode, round);
  });
});
