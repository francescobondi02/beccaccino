import { Suit, Value } from "@prisma/client";
import { prisma } from "../../src/db";
import { sweepPracticeRooms } from "../../src/services/practiceRoomSweeper";
import { withRoomLock } from "../../src/utils/roomLock";
import { clearDatabase } from "../helpers/database";
import {
  getTurnTimerState,
  scheduleTurnTimer,
} from "../../src/runtime/turnTimer";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const SUITS: Suit[] = ["denara", "coppe", "spade", "bastoni"];
const VALUES: Value[] = [
  "asso",
  "due",
  "tre",
  "quattro",
  "cinque",
  "sei",
  "sette",
  "fante",
  "cavallo",
  "re",
];

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

const DAY_MS = 24 * HOUR_MS;

// A started practice game with one finished trick, a human and three bots.
async function createPracticeGame(
  code: string,
  data: { lastActivityAt: Date; pausedAt?: Date; finished?: boolean; winnerTeam?: number },
) {
  const users = await createUsers([
    { username: `${code}-human` },
    { username: `${code}-bot-1`, isBot: true },
    { username: `${code}-bot-2`, isBot: true },
    { username: `${code}-bot-3`, isBot: true },
  ]);
  const room = await prisma.gameRoom.create({
    data: {
      code,
      started: true,
      isPractice: true,
      ...data,
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
      callerId: room.players[0].id,
      number: 1,
      briscola: "coppe",
      briscolaAutoChosen: true,
    },
  });
  const trick = await prisma.trick.create({
    data: {
      roundId: round.id,
      number: 1,
      starterId: room.players[0].id,
      winnerId: room.players[0].id,
      completedAt: data.lastActivityAt,
    },
  });
  await prisma.trick.create({
    data: { roundId: round.id, number: 2, starterId: room.players[0].id },
  });
  await prisma.handCard.createMany({
    data: room.players.flatMap((player, seat) =>
      VALUES.slice(1).map((value) => ({
        playerId: player.id,
        roundId: round.id,
        suit: SUITS[seat],
        value,
      })),
    ),
  });
  await prisma.playedCard.createMany({
    data: room.players.map((player, seat) => ({
      playerId: player.id,
      trickId: trick.id,
      suit: SUITS[seat],
      value: VALUES[0],
      position: seat,
      autoPlayed: true,
    })),
  });
  return { room, users, round };
}

describe("practice room sweeper", () => {
  it.each([
    ["an active", undefined],
    ["a paused", new Date(NOW.getTime() - 40 * DAY_MS)],
  ])("closes %s practice game idle for 30 days and keeps its history", async (_name, pausedAt) => {
    const { room, users, round } = await createPracticeGame("SWP001", {
      lastActivityAt: new Date(NOW.getTime() - 30 * DAY_MS),
      pausedAt,
    });
    scheduleTurnTimer(room.code, room.version, 100_000, async () => undefined);

    await expect(sweepPracticeRooms(NOW)).resolves.toBe(1);

    expect(await prisma.gameRoom.findUniqueOrThrow({ where: { id: room.id } }))
      .toMatchObject({ finished: true, winnerTeam: null, version: room.version + 1 });
    expect(await prisma.player.count({ where: { gameRoomId: room.id } })).toBe(4);
    expect(await prisma.round.count({ where: { gameRoomId: room.id } })).toBe(1);
    expect(await prisma.handCard.count({ where: { roundId: round.id } })).toBe(36);
    expect(await prisma.playedCard.count()).toBe(4);
    expect(getTurnTimerState(room.code)).toBeNull();
    expect(
      await prisma.user.count({
        where: { id: { in: users.map((user) => user.id) } },
      }),
    ).toBe(4);
  });

  it("deletes an unstarted practice room idle for 30 days", async () => {
    const [user] = await createUsers([{ username: "stale-human" }]);
    const room = await prisma.gameRoom.create({
      data: {
        code: "SWP002",
        isPractice: true,
        lastActivityAt: new Date(NOW.getTime() - 30 * DAY_MS),
        players: { create: { userId: user.id, seat: 0 } },
      },
    });

    await expect(sweepPracticeRooms(NOW)).resolves.toBe(1);

    expect(
      await prisma.gameRoom.findUnique({ where: { id: room.id } }),
    ).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it("keeps a finished practice game and its winner", async () => {
    const { room } = await createPracticeGame("SWP005", {
      lastActivityAt: new Date(NOW.getTime() - 60 * DAY_MS),
      finished: true,
      winnerTeam: 0,
    });

    await expect(sweepPracticeRooms(NOW)).resolves.toBe(0);

    expect(await prisma.gameRoom.findUniqueOrThrow({ where: { id: room.id } }))
      .toMatchObject({ finished: true, winnerTeam: 0, version: room.version });
  });

  it("preserves an old active practice room and every multiplayer room", async () => {
    const preservedRooms = [
      {
        code: "SWP003",
        isPractice: true,
        finished: false,
        createdAt: new Date(NOW.getTime() - 72 * DAY_MS),
        lastActivityAt: new Date(NOW.getTime() - 29 * DAY_MS),
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
        lastActivityAt: new Date(NOW.getTime() - 48 * DAY_MS),
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
        lastActivityAt: new Date(NOW.getTime() - 48 * DAY_MS),
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
        lastActivityAt: new Date(NOW.getTime() - 31 * DAY_MS),
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
