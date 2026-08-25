import { prisma } from "../../src/db";
import { clearDatabase, api, apiAs } from "../helpers/gameHelpers";
import { ensureBotUsers } from "../../src/services/botService";
import {
  BotServiceStub,
  startBotServiceStub,
} from "../helpers/botServiceStub";

/**
 * POST /api/rooms/practice must hand back a game that is ready to play: started,
 * seated 2v2 with the human at seat 0, three bots tagged with their tier, and
 * round 1 dealt with a briscola caller waiting. Anything less and the frontend
 * would land on an empty table.
 */
describe("Practice room creation", () => {
  const TOKEN = "practice-test-token";
  let stub: BotServiceStub;
  let userId: number;

  beforeEach(async () => {
    await clearDatabase();
    stub = await startBotServiceStub(
      () => {
        throw { status: 503, body: { detail: "move not needed" } };
      },
      { requiredToken: TOKEN },
    );
    process.env.BOT_SERVICE_URL = stub.url;
    process.env.BOT_SERVICE_TOKEN = TOKEN;
    const res = await api()
      .post("/api/users/register")
      .send({ username: "human", password: "test123" });
    userId = res.body.id;
  });

  afterEach(async () => {
    await stub.close();
    delete process.env.BOT_SERVICE_URL;
    delete process.env.BOT_SERVICE_TOKEN;
  });

  const createPractice = (tier: unknown) =>
    apiAs(userId, "human").post("/api/rooms/practice").send({ tier });

  const loadRoom = (code: string) =>
    prisma.gameRoom.findUnique({
      where: { code },
      include: {
        players: { orderBy: { seat: "asc" }, include: { user: true } },
        rounds: true,
      },
    });

  it("starts a seated 2v2 game with three bots and a dealt round", async () => {
    const res = await createPractice("forte");
    expect(res.statusCode).toBe(201);
    expect(stub.readyHeaders).toHaveLength(1);
    expect(stub.readyHeaders[0].authorization).toBe(`Bearer ${TOKEN}`);
    expect(stub.readyTiers).toEqual(["forte"]);

    const room = await loadRoom(res.body.code);
    expect(room!.started).toBe(true);
    expect(room!.isPractice).toBe(true);
    expect(room!.players).toHaveLength(4);

    expect(room!.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(room!.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    expect(room!.players.every((p) => p.isReady)).toBe(true);

    // The human holds seat 0 (rendered at the bottom of the table); the other
    // three are bots of the requested tier.
    expect(room!.players[0].userId).toBe(userId);
    expect(room!.players[0].botModel).toBeNull();
    expect(room!.players.slice(1).map((p) => p.botModel)).toEqual([
      "forte",
      "forte",
      "forte",
    ]);
    expect(room!.players.slice(1).every((p) => p.user.isBot)).toBe(true);

    expect(room!.rounds).toHaveLength(1);
    expect(room!.rounds[0].briscola).toBeNull();

    const dealt = await prisma.playerCard.count({
      where: { roundId: room!.rounds[0].id },
    });
    expect(dealt).toBe(40);
  });

  it("rejects an unknown tier", async () => {
    const res = await createPractice("impossibile");
    expect(res.statusCode).toBe(400);
    expect(await prisma.gameRoom.count()).toBe(0);
    expect(stub.readyHeaders).toHaveLength(0);
    expect(stub.readyTiers).toHaveLength(0);
  });

  it("refuses a second practice game while one is active", async () => {
    const first = await createPractice("medio");
    expect(first.statusCode).toBe(201);

    const second = await createPractice("medio");
    expect(second.statusCode).toBe(409);
    expect(second.body.activeRoomCode).toBe(first.body.code);
    expect(stub.readyHeaders).toHaveLength(1);
    expect(stub.readyTiers).toEqual(["medio"]);
  });

  it("creates no state when the bot service is unavailable", async () => {
    await stub.close();
    stub = await startBotServiceStub(
      () => {
        throw { status: 503 };
      },
      { readyStatus: 503, requiredToken: TOKEN },
    );
    process.env.BOT_SERVICE_URL = stub.url;

    const res = await createPractice("forte");

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Bot service unavailable" });
    expect(await prisma.gameRoom.count()).toBe(0);
    expect(await prisma.user.count({ where: { isBot: true } })).toBe(0);
  });

  it("creates no state when the bot service rejects the credential", async () => {
    process.env.BOT_SERVICE_TOKEN = "wrong-token";

    const res = await createPractice("forte");

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Bot service unavailable" });
    expect(stub.readyTiers).toEqual(["forte"]);
    expect(await prisma.gameRoom.count()).toBe(0);
    expect(await prisma.user.count({ where: { isBot: true } })).toBe(0);
  });

  it("serializes concurrent practice creation for one user", async () => {
    await stub.close();
    stub = await startBotServiceStub(
      () => {
        throw { status: 503 };
      },
      { readyDelayMs: 50, requiredToken: TOKEN },
    );
    process.env.BOT_SERVICE_URL = stub.url;

    const responses = await Promise.all([
      createPractice("forte"),
      createPractice("forte"),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
    expect(await prisma.gameRoom.count()).toBe(1);
    expect(stub.readyHeaders).toHaveLength(1);
    expect(stub.readyTiers).toEqual(["forte"]);
  });

  it("reuses the same three bot users across games", async () => {
    const first = await createPractice("facile");
    await prisma.gameRoom.update({
      where: { code: first.body.code },
      data: { finished: true },
    });
    const second = await createPractice("esperto");

    const botsOf = async (code: string) => {
      const room = await loadRoom(code);
      return room!.players
        .filter((p) => p.botModel !== null)
        .map((p) => p.userId)
        .sort();
    };

    expect(await botsOf(second.body.code)).toEqual(await botsOf(first.body.code));
    expect(await prisma.user.count({ where: { isBot: true } })).toBe(3);
  });

  it("refuses to seat a real user who holds a reserved bot username", async () => {
    const [firstBotId] = await ensureBotUsers();
    await prisma.user.update({
      where: { id: firstBotId },
      data: { isBot: false },
    });

    const res = await createPractice("forte");
    expect(res.statusCode).toBe(500);
  });
});
