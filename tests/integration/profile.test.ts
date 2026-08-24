import request from "supertest";
import { prisma } from "../../src/db";
import {
  clearDatabase,
  setupGame,
  chooseBriscola,
  oneRound,
  getServer,
} from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

/**
 * Extract the authToken cookie from a response's Set-Cookie header.
 * Returns the "authToken=<value>" string suitable for passing via .set("Cookie", ...).
 */
function extractAuthCookie(res: request.Response): string {
  const cookies = res.headers["set-cookie"];
  if (!cookies) return "";
  const cookieStr = Array.isArray(cookies) ? cookies[0] : cookies;
  return cookieStr.split(";")[0]; // "authToken=xxx"
}

/**
 * Register a user and return the response body + auth cookie.
 */
async function registerUser(
  username: string,
  password = "test123",
  email?: string
) {
  const payload: any = { username, password };
  if (email) payload.email = email;

  const res = await request(getServer())
    .post("/api/users/register")
    .send(payload);

  expect(res.statusCode).toBe(201);

  const cookie = extractAuthCookie(res);
  expect(cookie).toContain("authToken=");

  return { user: res.body, cookie };
}

describe("Profile API", () => {
  describe("GET /api/users/me", () => {
    it("returns the authenticated user with valid cookie", async () => {
      const { user, cookie } = await registerUser("testuser", "test123", "test@example.com");

      const res = await request(getServer())
        .get("/api/users/me")
        .set("Cookie", cookie);

      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.username).toBe("testuser");
      expect(res.body.email).toBe("test@example.com");
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();
      // Should not expose password
      expect(res.body.password).toBeUndefined();
    });

    it("returns 401 without a cookie", async () => {
      const res = await request(getServer()).get("/api/users/me");

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("GET /api/users/me/stats", () => {
    it("returns zero stats for a user with no finished games", async () => {
      const { cookie } = await registerUser("newplayer");

      const res = await request(getServer())
        .get("/api/users/me/stats")
        .set("Cookie", cookie);

      expect(res.statusCode).toBe(200);
      expect(res.body.totalGames).toBe(0);
      expect(res.body.wins).toBe(0);
      expect(res.body.winRate).toBe(0);
      expect(res.body.totalPoints).toBe(0);
      expect(res.body.recentGames).toEqual([]);
    });

    it("returns correct stats after a completed game", async () => {
      // setupGame registers users A, B, C, D and plays a full game setup
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);
      await oneRound(roomCode, round);

      // Verify the game finished
      const finishedRoom = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true, rounds: true },
      });
      expect(finishedRoom!.finished).toBe(true);

      // Login as one of the players (user "userA") to check stats
      const loginRes = await request(getServer())
        .post("/api/users/login")
        .send({ username: "userA", password: "test123" });
      expect(loginRes.statusCode).toBe(200);

      const cookie = extractAuthCookie(loginRes);
      expect(cookie).toContain("authToken=");

      const statsRes = await request(getServer())
        .get("/api/users/me/stats")
        .set("Cookie", cookie);

      expect(statsRes.statusCode).toBe(200);
      expect(statsRes.body.totalGames).toBe(1);
      expect(statsRes.body.wins).toBe(0);
      expect(statsRes.body.winRate).toBe(0);
      expect(statsRes.body.totalPoints).toBeGreaterThan(0);
      expect(statsRes.body.recentGames).toHaveLength(1);
      expect(statsRes.body.recentGames[0].code).toBe(roomCode);
      expect(statsRes.body.recentGames[0].result).toBe("Sconfitta");
    });

    it("returns 401 without a cookie", async () => {
      const res = await request(getServer()).get("/api/users/me/stats");

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("PATCH /api/users/me", () => {
    it("updates username successfully with valid cookie", async () => {
      const { user, cookie } = await registerUser("original");

      const res = await request(getServer())
        .patch("/api/users/me")
        .set("Cookie", cookie)
        .send({ username: "updated_name" });

      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.username).toBe("updated_name");
      expect(res.body.email).toBeDefined();
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();

      // Verify the new cookie is set (JWT regenerated with new username)
      const newCookie = extractAuthCookie(res);
      expect(newCookie).toContain("authToken=");

      // Verify we can use the new cookie
      const meRes = await request(getServer())
        .get("/api/users/me")
        .set("Cookie", newCookie);

      expect(meRes.statusCode).toBe(200);
      expect(meRes.body.username).toBe("updated_name");
    });

    it("rejects username shorter than 3 characters", async () => {
      const { cookie } = await registerUser("validuser");

      const res = await request(getServer())
        .patch("/api/users/me")
        .set("Cookie", cookie)
        .send({ username: "ab" });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain("at least 3 characters");
    });

    it("rejects duplicate username", async () => {
      await registerUser("existinguser");
      const { cookie } = await registerUser("anotheruser");

      const res = await request(getServer())
        .patch("/api/users/me")
        .set("Cookie", cookie)
        .send({ username: "existinguser" });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toContain("already taken");
    });

    it("returns 401 without a cookie", async () => {
      const res = await request(getServer())
        .patch("/api/users/me")
        .send({ username: "newname" });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("DELETE /api/users/me", () => {
    it("deletes user and clears player records", async () => {
      const { user, cookie } = await registerUser("deleteme");

      // Create a room (not started) so a Player record exists
      const roomRes = await request(getServer())
        .post("/api/rooms/")
        .set("Cookie", cookie)
        .send({});

      expect(roomRes.statusCode).toBe(201);

      // Delete account
      const deleteRes = await request(getServer())
        .delete("/api/users/me")
        .set("Cookie", cookie);

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.body.message).toContain("deleted");

      // Verify user is anonymized (soft-deleted) rather than hard-deleted
      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(dbUser).not.toBeNull();
      expect(dbUser!.deletedAt).not.toBeNull();

      // Verify player records in non-started rooms are gone
      const players = await prisma.player.findMany({
        where: { userId: user.id },
      });
      expect(players).toHaveLength(0);
    });

    it("rejects deletion if user is in an active game", async () => {
      // Setup a game that is started but not finished
      await setupGame();
      // Game is started but not finished yet (briscola not chosen, round not played)

      // Login as player A who is in the active game
      const loginRes = await request(getServer())
        .post("/api/users/login")
        .send({ username: "userA", password: "test123" });
      expect(loginRes.statusCode).toBe(200);

      const cookie = extractAuthCookie(loginRes);

      const deleteRes = await request(getServer())
        .delete("/api/users/me")
        .set("Cookie", cookie);

      expect(deleteRes.statusCode).toBe(409);
      expect(deleteRes.body.error).toContain("active game");
      expect(deleteRes.body.error).not.toContain("leave");
    });

    it("returns 401 without a cookie", async () => {
      const res = await request(getServer()).delete("/api/users/me");

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });
});
