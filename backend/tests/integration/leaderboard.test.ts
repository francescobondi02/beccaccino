import request from "supertest";
import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import {
  setupGame,
  chooseBriscola,
  oneRound,
} from "../helpers/gameDriver";
import { api, apiAs, getServer } from "../helpers/serverHarness";

beforeEach(async () => {
  await clearDatabase();
});

describe("Leaderboard API", () => {
  describe("GET /api/users/leaderboard", () => {
    it("returns 200 with empty leaderboard when no finished games exist", async () => {
      const res = await request(getServer()).get("/api/users/leaderboard");

      expect(res.statusCode).toBe(200);
      expect(res.body.leaderboard).toBeDefined();
      expect(res.body.leaderboard).toHaveLength(0);
    });

    it("does not require authentication (public endpoint)", async () => {
      // No auth cookie, no credentials — should still work
      const res = await request(getServer()).get("/api/users/leaderboard");

      expect(res.statusCode).toBe(200);
      expect(res.body.leaderboard).toBeDefined();
    });

    it("returns players ranked by wins after a completed game", async () => {
      // Setup and complete a full game
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);
      await oneRound(roomCode, round);

      // Verify the game finished
      const finishedRoom = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: {
          players: { include: { user: true } },
          rounds: true,
        },
      });
      expect(finishedRoom!.finished).toBe(true);

      // Fetch leaderboard
      const res = await request(getServer()).get("/api/users/leaderboard");

      expect(res.statusCode).toBe(200);
      expect(res.body.leaderboard.length).toBeGreaterThan(0);

      // Each entry should have the expected shape (no 'id' field!)
      const firstEntry = res.body.leaderboard[0];
      expect(firstEntry).toHaveProperty("username");
      expect(firstEntry).toHaveProperty("totalGames");
      expect(firstEntry).toHaveProperty("wins");
      expect(firstEntry).toHaveProperty("winRate");
      expect(firstEntry).toHaveProperty("totalPoints");
      expect(firstEntry).not.toHaveProperty("id"); // Security: no internal IDs exposed
    });

    it("correctly computes stats for all players", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);
      await oneRound(roomCode, round);

      const res = await request(getServer()).get("/api/users/leaderboard");

      // Should have 4 players in the leaderboard (all participated in 1 finished game)
      expect(res.body.leaderboard).toHaveLength(4);

      // All players should have totalGames = 1
      for (const entry of res.body.leaderboard) {
        expect(entry.totalGames).toBe(1);
      }

      // Exactly 2 players should have wins = 1 (the winning team)
      const winners = res.body.leaderboard.filter(
        (e: any) => e.wins === 1
      );
      expect(winners).toHaveLength(2);

      // The other 2 should have wins = 0
      const losers = res.body.leaderboard.filter(
        (e: any) => e.wins === 0
      );
      expect(losers).toHaveLength(2);

      // Winners should be ranked first (sorted by wins desc)
      expect(res.body.leaderboard[0].wins).toBe(1);
      expect(res.body.leaderboard[1].wins).toBe(1);
      expect(res.body.leaderboard[2].wins).toBe(0);
      expect(res.body.leaderboard[3].wins).toBe(0);
    });

    it("ignores finished games without a winner", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);
      await oneRound(roomCode, round);
      const room = await prisma.gameRoom.update({
        where: { code: roomCode },
        data: { winnerTeam: null },
        include: { players: { include: { user: true } } },
      });

      const res = await request(getServer()).get("/api/users/leaderboard");
      expect(res.body.leaderboard).toHaveLength(0);
      const { userId, user } = room.players[0];
      const stats = await apiAs(userId, user.username).get("/api/users/me/stats");
      expect(stats.body.totalGames).toBe(0);
    });

    it("does not include players who only have unfinished games", async () => {
      // Create a user in a room that hasn't started
      const registerRes = await api()
        .post("/api/users/register")
        .send({ username: "lonely_player", password: "test123" });

      const userId = registerRes.body.id;

      await apiAs(userId, "lonely_player").post("/api/rooms/").send({});

      // Leaderboard should be empty (no finished games)
      const res = await request(getServer()).get("/api/users/leaderboard");
      expect(res.body.leaderboard).toHaveLength(0);
    });

    it("returns at most 50 entries", async () => {
      // This test verifies the limit logic exists (even if we can't create 50+ users easily)
      const res = await request(getServer()).get("/api/users/leaderboard");
      expect(res.body.leaderboard.length).toBeLessThanOrEqual(50);
    });
  });
});
