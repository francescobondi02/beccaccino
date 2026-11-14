import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import { api, apiAs } from "../helpers/serverHarness";
import { ensureBotUsers } from "../../src/services/botUsers";
import {
  BotServiceStub,
  startBotServiceStub,
} from "../helpers/botServiceStub";
import * as gameRound from "../../src/game/transitions/round";
import {
  getTurnTimerState,
} from "../../src/runtime/turnTimer";
import { clearRuntimeRoom } from "../../src/runtime/turnRuntime";

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

    const dealt = await prisma.handCard.count({
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

  it("abandons previous practice games after creating a playable replacement", async () => {
    const first = await createPractice("medio");
    expect(first.statusCode).toBe(201);
    await prisma.gameRoom.create({
      data: {
        code: "OLD002",
        isPractice: true,
        players: { create: { userId, seat: 0 } },
      },
    });

    const second = await createPractice("medio");
    expect(second.statusCode).toBe(201);
    expect(second.body.code).not.toBe(first.body.code);
    expect(stub.readyTiers).toEqual(["medio", "medio"]);

    const rooms = await prisma.gameRoom.findMany({ select: { code: true } });
    expect(rooms.map((room) => room.code)).toEqual([second.body.code]);
  });

  it("does not block creating a multiplayer room", async () => {
    const practice = await createPractice("medio");
    expect(practice.statusCode).toBe(201);

    const res = await apiAs(userId, "human").post("/api/rooms").send({});

    expect(res.statusCode).toBe(201);
    expect(
      await prisma.gameRoom.findUnique({ where: { code: practice.body.code } }),
    ).not.toBeNull();
  });

  it("does not block joining a multiplayer room", async () => {
    const practice = await createPractice("medio");
    const owner = await api()
      .post("/api/users/register")
      .send({ username: "owner", password: "test123" });
    const target = await apiAs(owner.body.id, "owner")
      .post("/api/rooms")
      .send({});

    const res = await apiAs(userId, "human")
      .post(`/api/rooms/${target.body.code}/join`)
      ;

    expect(res.statusCode).toBe(200);
    expect(
      await prisma.gameRoom.findUnique({ where: { code: practice.body.code } }),
    ).not.toBeNull();
  });

  it("keeps active multiplayer games blocking practice", async () => {
    const active = await apiAs(userId, "human").post("/api/rooms").send({});
    await prisma.gameRoom.update({
      where: { code: active.body.code },
      data: { started: true },
    });

    const res = await createPractice("medio");

    expect(res.statusCode).toBe(409);
    expect(res.body.activeRoomCode).toBe(active.body.code);
    expect(stub.readyTiers).toHaveLength(0);
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

  it("preserves previous practice games when initial round setup fails", async () => {
    const first = await createPractice("forte");
    jest
      .spyOn(gameRound, "startFirstRound")
      .mockRejectedValueOnce(new Error("injected practice deal failure"));

    const res = await createPractice("forte");

    expect(res.statusCode).toBe(500);
    expect(stub.readyTiers).toEqual(["forte", "forte"]);
    expect(
      await prisma.gameRoom.findMany({ select: { code: true } }),
    ).toEqual([{ code: first.body.code }]);
  });

  it("removes the replacement when a previous room cannot be deleted", async () => {
    const first = await createPractice("forte");
    const firstRoom = await loadRoom(first.body.code);
    const firstTimer = getTurnTimerState(first.body.code);
    expect(firstTimer).not.toBeNull();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION practice_fail_room_delete() RETURNS trigger AS $$
      BEGIN
        IF OLD."id" = ${firstRoom!.id} THEN
          RAISE EXCEPTION 'injected practice cleanup failure';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER practice_fail_room_delete
      BEFORE DELETE ON "GameRoom"
      FOR EACH ROW EXECUTE FUNCTION practice_fail_room_delete()
    `);

    let res;
    try {
      res = await createPractice("forte");
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER practice_fail_room_delete ON "GameRoom"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION practice_fail_room_delete()");
    }

    expect(res.statusCode).toBe(500);
    expect(
      await prisma.gameRoom.findMany({ select: { code: true } }),
    ).toEqual([{ code: first.body.code }]);
    expect(getTurnTimerState(first.body.code)).toMatchObject({
      turnUserId: firstTimer!.turnUserId,
      phase: firstTimer!.phase,
    });
    clearRuntimeRoom(first.body.code);
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

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(await prisma.gameRoom.count()).toBe(1);
    expect(stub.readyTiers).toEqual(["forte", "forte"]);
  });

  it("reuses the same three bot users across games", async () => {
    const botsOf = async (code: string) => {
      const room = await loadRoom(code);
      return room!.players
        .filter((p) => p.botModel !== null)
        .map((p) => p.userId)
        .sort();
    };

    const first = await createPractice("facile");
    const firstBots = await botsOf(first.body.code);
    const second = await createPractice("esperto");

    expect(await botsOf(second.body.code)).toEqual(firstBots);
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
