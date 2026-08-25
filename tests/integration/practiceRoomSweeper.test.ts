import { prisma } from "../../src/db";
import { sweepPracticeRooms } from "../../src/services/practiceRoomSweeper";
import { withRoomLock } from "../../src/utils/roomLock";
import { clearDatabase } from "../helpers/gameHelpers";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

beforeEach(async () => {
  await clearDatabase();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createUsers(
  definitions: { username: string; isBot?: boolean }[],
) {
  const users = [];
  for (const definition of definitions) {
    users.push(
      await prisma.user.create({
        data: {
          username: definition.username,
          password: "test-password",
          isBot: definition.isBot ?? false,
        },
      }),
    );
  }
  return users;
}

describe("practice room sweeper", () => {
  it("deletes a finished practice game graph but retains its bot users", async () => {
    const users = await createUsers([
      { username: "sweep-human" },
      { username: "sweep-bot-1", isBot: true },
      { username: "sweep-bot-2", isBot: true },
      { username: "sweep-bot-3", isBot: true },
    ]);
    const room = await prisma.gameRoom.create({
      data: {
        code: "SWP001",
        started: true,
        finished: true,
        isPractice: true,
        players: {
          create: users.map((user, seat) => ({
            userId: user.id,
            seat,
            team: seat % 2,
            botModel: user.isBot ? "medio" : null,
          })),
        },
      },
      include: { players: { orderBy: { seat: "asc" } } },
    });
    const round = await prisma.round.create({
      data: {
        gameRoomId: room.id,
        number: 1,
        briscola: "coppe",
        winnerTeam: 0,
      },
    });
    const hand = await prisma.hand.create({
      data: {
        roundId: round.id,
        number: 1,
        starterId: room.players[0].id,
        winnerId: room.players[0].id,
      },
    });
    await prisma.playerCard.create({
      data: {
        playerId: room.players[0].id,
        roundId: round.id,
        suit: "coppe",
        value: "asso",
      },
    });
    const playedCard = await prisma.playedCard.create({
      data: {
        playerId: room.players[0].id,
        handId: hand.id,
        suit: "coppe",
        value: "asso",
        position: 0,
      },
    });

    await expect(sweepPracticeRooms(NOW)).resolves.toBe(1);

    expect(
      await prisma.gameRoom.findUnique({ where: { id: room.id } }),
    ).toBeNull();
    expect(await prisma.player.count({ where: { gameRoomId: room.id } })).toBe(0);
    expect(await prisma.round.count({ where: { gameRoomId: room.id } })).toBe(0);
    expect(await prisma.hand.findUnique({ where: { id: hand.id } })).toBeNull();
    expect(await prisma.playerCard.count({ where: { roundId: round.id } })).toBe(0);
    expect(
      await prisma.playedCard.findUnique({ where: { id: playedCard.id } }),
    ).toBeNull();

    const botIds = users.filter((user) => user.isBot).map((user) => user.id);
    expect(
      await prisma.user.count({
        where: { id: { in: botIds }, isBot: true },
      }),
    ).toBe(3);
  });

  it("deletes an unfinished practice room at the 24-hour boundary", async () => {
    const [user] = await createUsers([{ username: "stale-human" }]);
    const room = await prisma.gameRoom.create({
      data: {
        code: "SWP002",
        isPractice: true,
        lastActivityAt: new Date(NOW.getTime() - 24 * HOUR_MS),
        players: { create: { userId: user.id, seat: 0 } },
      },
    });

    await expect(sweepPracticeRooms(NOW)).resolves.toBe(1);

    expect(
      await prisma.gameRoom.findUnique({ where: { id: room.id } }),
    ).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it("preserves an old active practice room and every multiplayer room", async () => {
    const preservedRooms = [
      {
        code: "SWP003",
        isPractice: true,
        finished: false,
        createdAt: new Date(NOW.getTime() - 72 * HOUR_MS),
        lastActivityAt: new Date(NOW.getTime() - 23 * HOUR_MS),
      },
      {
        code: "MULT01",
        isPractice: false,
        finished: false,
        lastActivityAt: new Date(NOW.getTime() - HOUR_MS),
      },
      {
        code: "MULT02",
        isPractice: false,
        finished: false,
        lastActivityAt: new Date(NOW.getTime() - 48 * HOUR_MS),
      },
      {
        code: "MULT03",
        isPractice: false,
        finished: true,
        lastActivityAt: new Date(NOW.getTime() - HOUR_MS),
      },
      {
        code: "MULT04",
        isPractice: false,
        finished: true,
        lastActivityAt: new Date(NOW.getTime() - 48 * HOUR_MS),
      },
    ];
    await prisma.gameRoom.createMany({ data: preservedRooms });

    await expect(sweepPracticeRooms(NOW)).resolves.toBe(0);

    const remainingCodes = (
      await prisma.gameRoom.findMany({
        select: { code: true },
        orderBy: { code: "asc" },
      })
    ).map((room) => room.code);
    expect(remainingCodes).toEqual(
      preservedRooms.map((room) => room.code).sort(),
    );
  });

  it("rechecks eligibility after waiting for the room lock", async () => {
    const room = await prisma.gameRoom.create({
      data: {
        code: "SWP004",
        isPractice: true,
        lastActivityAt: new Date(NOW.getTime() - 48 * HOUR_MS),
      },
    });
    let releaseLock!: () => void;
    const lockRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let reportLockAcquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      reportLockAcquired = resolve;
    });
    const lock = withRoomLock(room.code, async () => {
      reportLockAcquired();
      await lockRelease;
      await prisma.gameRoom.update({
        where: { id: room.id },
        data: { lastActivityAt: new Date(NOW.getTime() - HOUR_MS) },
      });
    });
    await lockAcquired;

    const findCandidates = jest.spyOn(prisma.gameRoom, "findMany");
    const sweep = sweepPracticeRooms(NOW);
    expect(sweepPracticeRooms(new Date(NOW.getTime() + HOUR_MS))).toBe(sweep);
    expect(findCandidates).toHaveBeenCalledTimes(1);
    await findCandidates.mock.results[0].value;

    releaseLock();
    await lock;
    await expect(sweep).resolves.toBe(0);

    expect(
      await prisma.gameRoom.findUnique({ where: { id: room.id } }),
    ).toMatchObject({ isPractice: true, finished: false });
  });
});
