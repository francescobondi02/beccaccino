import request from "supertest";
import { prisma } from "../../src/db";
import {
  clearDatabase,
  setupGame,
  chooseBriscola,
  oneRound,
  getServer,
  api,
  apiAs,
} from "../helpers/gameHelpers";

/**
 * Practice games (human vs bots) must stay out of every public aggregate.
 * They are unranked training a player can farm at will, so counting them would
 * corrupt the leaderboard and profile stats.
 *
 * Each test finishes a REAL game, asserts it shows up, then flips the room to
 * isPractice and asserts it disappears — so a missing fence fails loudly instead
 * of passing on an empty dataset.
 */
describe("Practice games are excluded from aggregates", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  const markAsPractice = (roomCode: string) =>
    prisma.gameRoom.update({ where: { code: roomCode }, data: { isPractice: true } });

  async function finishOneGame() {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await oneRound(roomCode, round);

    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: { include: { user: true } } },
    });
    return { roomCode, players: room!.players };
  }

  it("omits practice games from the leaderboard", async () => {
    const { roomCode } = await finishOneGame();

    const before = await request(getServer()).get("/api/users/leaderboard");
    expect(before.body.leaderboard.length).toBeGreaterThan(0);

    await markAsPractice(roomCode);

    const after = await request(getServer()).get("/api/users/leaderboard");
    expect(after.body.leaderboard).toHaveLength(0);
  });

  it("omits practice games from a user's own stats", async () => {
    const { roomCode, players } = await finishOneGame();
    const { userId, user } = players[0];
    const stats = () => apiAs(userId, user.username).get("/api/users/me/stats");

    const before = await stats();
    expect(before.body.totalGames).toBeGreaterThan(0);

    await markAsPractice(roomCode);

    const after = await stats();
    expect(after.body.totalGames).toBe(0);
  });

  it("hides practice rooms from the joinable-rooms list", async () => {
    const created = await api()
      .post("/api/users/register")
      .send({ username: "host", password: "test123" });
    const hostRoom = await apiAs(created.body.id, "host").post("/api/rooms").send({});
    const roomCode = hostRoom.body.code;

    const outsider = await api()
      .post("/api/users/register")
      .send({ username: "outsider", password: "test123" });
    const asOutsider = () => apiAs(outsider.body.id, "outsider").get("/api/rooms/available");

    const before = await asOutsider();
    expect(codesOf(before)).toContain(roomCode);

    await markAsPractice(roomCode);

    const after = await asOutsider();
    expect(codesOf(after)).not.toContain(roomCode);
  });
});

const codesOf = (res: { body: { availableRooms?: { code: string }[] } }) =>
  (res.body.availableRooms ?? []).map((r) => r.code);
