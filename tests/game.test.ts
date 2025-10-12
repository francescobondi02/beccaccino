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
  await prisma.playedCard.deleteMany();
  await prisma.playerCard.deleteMany();
  await prisma.hand.deleteMany();
  await prisma.round.deleteMany();
  await prisma.player.deleteMany();
  await prisma.gameRoom.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Game flow", () => {
  it("Should create 4 users, one room, join all users, set teams, start the game, choose briscola, and play one hand", async () => {
    const { roomCode, round, cards } = await setupGame();

    await chooseBriscola(roomCode, round, cards);

    //await oneHand(roomCode, round);

    await oneRound(roomCode, round);
  });
});
