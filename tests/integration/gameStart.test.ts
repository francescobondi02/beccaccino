import { prisma } from "../../src/db";
import { startFirstRound } from "../../src/services/gameService";
import {
  clearRoomTimerData,
  getTurnTimerState,
} from "../../src/services/turnTimer";
import {
  getSocketInstance,
  setSocketInstance,
} from "../../src/socketInstance";
import { setRng } from "../../src/utils/random";
import { apiAs, clearDatabase } from "../helpers/gameHelpers";

const roomCodes = new Set<string>();

beforeEach(async () => {
  await clearDatabase();
});

afterEach(() => {
  for (const roomCode of roomCodes) clearRoomTimerData(roomCode);
  roomCodes.clear();
});

async function createReadyRoom(
  teams: number[],
  code: string,
  ready = teams.map(() => true),
) {
  const users = [];
  for (let i = 0; i < teams.length; i++) {
    users.push(
      await prisma.user.create({
        data: { username: `${code}-user-${i}`, password: "test123" },
      }),
    );
  }

  const room = await prisma.gameRoom.create({
    data: {
      code,
      players: {
        create: users.map((user, index) => ({
          userId: user.id,
          team: teams[index],
          seat: index === 0 ? 0 : null,
          isReady: ready[index],
        })),
      },
    },
  });
  roomCodes.add(code);
  return { room, users };
}

describe("first-round startup", () => {
  it.each([
    [0, 0, 1, 1],
    [0, 1, 0, 1],
    [0, 1, 1, 0],
    [1, 0, 0, 1],
    [1, 0, 1, 0],
    [1, 1, 0, 0],
  ])("starts atomically for team order %j", async (...teams: number[]) => {
    const code = "START1";
    const { room } = await createReadyRoom(teams, code);

    await startFirstRound(room.id, code);

    const startedRoom = await prisma.gameRoom.findUnique({
      where: { id: room.id },
      include: {
        players: { orderBy: { seat: "asc" } },
        rounds: { include: { playerCards: true } },
      },
    });
    expect(startedRoom!.started).toBe(true);
    expect(startedRoom!.rounds).toHaveLength(1);
    expect(startedRoom!.rounds[0].playerCards).toHaveLength(40);
    const cardsPerPlayer = new Map<number, number>();
    for (const card of startedRoom!.rounds[0].playerCards) {
      cardsPerPlayer.set(
        card.playerId,
        (cardsPerPlayer.get(card.playerId) ?? 0) + 1,
      );
    }
    expect([...cardsPerPlayer.values()]).toEqual([10, 10, 10, 10]);
    expect(
      startedRoom!.players.filter((player) => player.team === 0).map((p) => p.seat),
    ).toEqual([0, 2]);
    expect(
      startedRoom!.players.filter((player) => player.team === 1).map((p) => p.seat),
    ).toEqual([1, 3]);

    const timer = getTurnTimerState(code);
    expect(timer).toMatchObject({ phase: "choose_briscola", isBot: false });
    expect(startedRoom!.players.map((player) => player.userId)).toContain(
      timer!.turnUserId,
    );
  });

  it("rolls back a mid-deal failure before publishing or arming a timer", async () => {
    const code = "START2";
    const { room, users } = await createReadyRoom(
      [1, 0, 1, 0],
      code,
      [true, true, true, false],
    );
    const originalIo = getSocketInstance();
    const events: string[] = [];
    setSocketInstance({
      to: () => ({
        emit: (event: string) => events.push(event),
      }),
    } as any);
    const restoreRng = setRng(() => {
      throw new Error("injected deal failure");
    });

    let response;
    try {
      response = await apiAs(users[3].id, users[3].username)
        .post(`/api/rooms/${code}/ready`)
        .send({ isReady: true });
    } finally {
      restoreRng();
      setSocketInstance(originalIo);
    }

    expect(response!.statusCode).toBe(500);
    const failedRoom = await prisma.gameRoom.findUnique({
      where: { id: room.id },
      include: { rounds: true, players: { orderBy: { id: "asc" } } },
    });
    expect(failedRoom!.started).toBe(false);
    expect(failedRoom!.rounds).toHaveLength(0);
    expect(failedRoom!.players.map((player) => player.seat)).toEqual([
      0,
      null,
      null,
      null,
    ]);
    expect(await prisma.playerCard.count()).toBe(0);
    expect(events).toContain("ready_changed");
    expect(events).not.toContain("game_started");
    expect(getTurnTimerState(code)).toBeNull();
  });
});
