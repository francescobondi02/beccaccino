import request from "supertest";
import { prisma } from "../../src/db";
import {
  clearDatabase,
  setupGame,
  chooseBriscola,
  oneRound,
  getServer,
  apiAs,
} from "../helpers/gameHelpers";

// setupGame registers players A–D with this password.
const PLAYER_PASSWORD = "test123";

beforeEach(async () => {
  await clearDatabase();
});

async function playFinishedGame() {
  const { roomCode, round, cards } = await setupGame();
  await chooseBriscola(roomCode, round, cards);
  await oneRound(roomCode, round);

  const room = await prisma.gameRoom.findUnique({ where: { code: roomCode } });
  expect(room!.finished).toBe(true);
}

describe("DELETE /api/users/me (account deletion)", () => {
  it("anonymizes a user who has finished-game history and returns 200", async () => {
    await playFinishedGame();
    const user = await prisma.user.findUnique({ where: { username: "A" } });

    const res = await apiAs(user!.id, "A").delete("/api/users/me");
    expect(res.statusCode).toBe(200);

    // Player rows are kept so the other three players' history stays intact.
    const players = await prisma.player.findMany({ where: { userId: user!.id } });
    expect(players.length).toBeGreaterThan(0);

    // The user row still exists but is anonymized and login-disabled.
    const after = await prisma.user.findUnique({ where: { id: user!.id } });
    expect(after).not.toBeNull();
    expect(after!.deletedAt).not.toBeNull();
    expect(after!.username).not.toBe("A");
    expect(after!.password).toBeNull();
  });

  it("prevents login with the old credentials after deletion", async () => {
    await playFinishedGame();
    const user = await prisma.user.findUnique({ where: { username: "A" } });

    const before = await request(getServer())
      .post("/api/users/login")
      .send({ username: "A", password: PLAYER_PASSWORD });
    expect(before.statusCode).toBe(200);

    await apiAs(user!.id, "A").delete("/api/users/me");

    const after = await request(getServer())
      .post("/api/users/login")
      .send({ username: "A", password: PLAYER_PASSWORD });
    expect(after.statusCode).toBe(401);
  });

  it("omits the deleted user from the leaderboard", async () => {
    await playFinishedGame();
    const user = await prisma.user.findUnique({ where: { username: "A" } });

    const before = await request(getServer()).get("/api/users/leaderboard");
    expect(before.body.leaderboard.some((e: any) => e.username === "A")).toBe(true);

    await apiAs(user!.id, "A").delete("/api/users/me");

    const after = await request(getServer()).get("/api/users/leaderboard");
    expect(after.body.leaderboard.some((e: any) => e.username === "A")).toBe(false);
  });
});
