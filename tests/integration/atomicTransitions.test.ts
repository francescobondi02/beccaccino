import * as score from "../../src/utils/score";
import { prisma } from "../../src/db";
import {
  getSocketInstance,
  setSocketInstance,
} from "../../src/socketInstance";
import {
  clearRoomTimerData,
  getTurnTimerState,
} from "../../src/services/turnTimer";
import { setRng } from "../../src/utils/random";
import {
  apiAs,
  chooseBriscola,
  clearDatabase,
  oneHand,
  setupGame,
} from "../helpers/gameHelpers";

type TimerState = NonNullable<ReturnType<typeof getTurnTimerState>>;

let originalIo: ReturnType<typeof getSocketInstance>;
let events: string[];

beforeEach(async () => {
  await clearDatabase();
  originalIo = getSocketInstance();
  events = [];
  setSocketInstance({
    to: () => ({ emit: (event: string) => events.push(event) }),
    emit: (event: string) => events.push(event),
    sockets: { sockets: new Map() },
  } as any);
});

afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS atomic_fail_hand_insert ON "Hand"',
  );
  await prisma.$executeRawUnsafe(
    "DROP FUNCTION IF EXISTS atomic_fail_hand_insert()",
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "GameRoom" DROP CONSTRAINT IF EXISTS atomic_reject_finished',
  );

  const rooms = await prisma.gameRoom.findMany({ select: { code: true } });
  for (const room of rooms) clearRoomTimerData(room.code);
  setSocketInstance(originalIo);
  jest.restoreAllMocks();
});

function expectTimerUnchanged(roomCode: string, before: TimerState) {
  expect(getTurnTimerState(roomCode)).toMatchObject({
    turnUserId: before.turnUserId,
    phase: before.phase,
    totalMs: before.totalMs,
    isBot: before.isBot,
  });
}

async function nextMove(roomCode: string) {
  const room = await prisma.gameRoom.findUniqueOrThrow({
    where: { code: roomCode },
    include: { players: { include: { user: true } } },
  });
  const round = await prisma.round.findFirstOrThrow({
    where: { gameRoomId: room.id },
    orderBy: { number: "desc" },
  });
  const hand = await prisma.hand.findFirstOrThrow({
    where: { roundId: round.id },
    orderBy: { number: "desc" },
    include: { cards: true },
  });
  const starter = room.players.find((player) => player.id === hand.starterId)!;
  const nextSeat = (starter.seat! + hand.cards.length) % 4;
  const player = room.players.find((candidate) => candidate.seat === nextSeat)!;
  const playable = await apiAs(player.userId, player.user.username).get(
    `/api/games/playable-cards/${roomCode}`,
  );

  expect(playable.statusCode).toBe(200);
  expect(playable.body.playableCards).not.toHaveLength(0);

  return {
    hand,
    player,
    payload: {
      roomCode,
      suit: playable.body.playableCards[0].suit,
      value: playable.body.playableCards[0].value,
    },
  };
}

async function playNext(roomCode: string) {
  const move = await nextMove(roomCode);
  const response = await apiAs(move.player.userId, move.player.user.username)
    .post("/api/games/play-card")
    .send(move.payload);
  expect(response.statusCode).toBe(200);
  return move;
}

async function prepareLastCard(roomCode: string, round: { id: number }) {
  for (let handNumber = 1; handNumber < 10; handNumber++) {
    await oneHand(roomCode, round, handNumber);
  }
  await playNext(roomCode);
  await playNext(roomCode);
  await playNext(roomCode);
  return nextMove(roomCode);
}

describe("Atomic game transitions", () => {
  it("rolls back briscola when first-hand creation fails and retries once", async () => {
    const { roomCode, round, cards } = await setupGame();
    const room = await prisma.gameRoom.findUniqueOrThrow({
      where: { code: roomCode },
      include: { players: { include: { user: true } } },
    });
    const callerCard = cards.find(
      (card) => card.suit === "denara" && card.value === "quattro",
    )!;
    const caller = room.players.find(
      (player) => player.id === callerCard.playerId,
    )!;
    const sentinel = await prisma.hand.create({
      data: { roundId: round.id, number: 1, starterId: caller.id },
    });
    const timerBefore = getTurnTimerState(roomCode)!;
    events.length = 0;

    const failed = await apiAs(caller.userId, caller.user.username)
      .post("/api/games/choose-briscola")
      .send({ gameRoomId: room.id, suit: "coppe" });

    expect(failed.statusCode).toBe(500);
    expect(
      await prisma.round.findUniqueOrThrow({ where: { id: round.id } }),
    ).toMatchObject({ briscola: null, cricca: false });
    expect(await prisma.hand.count({ where: { roundId: round.id } })).toBe(1);
    expect(events).not.toContain("briscola_chosen");
    expectTimerUnchanged(roomCode, timerBefore);

    await prisma.hand.delete({ where: { id: sentinel.id } });
    const retry = await apiAs(caller.userId, caller.user.username)
      .post("/api/games/choose-briscola")
      .send({ gameRoomId: room.id, suit: "coppe" });

    expect(retry.statusCode).toBe(200);
    expect(await prisma.hand.count({ where: { roundId: round.id } })).toBe(1);
    expect(
      await prisma.round.findUniqueOrThrow({ where: { id: round.id } }),
    ).toMatchObject({ briscola: "coppe" });
  });

  it("rolls back the fourth card and winner when next-hand creation fails", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await playNext(roomCode);
    await playNext(roomCode);
    await playNext(roomCode);
    const move = await nextMove(roomCode);

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION atomic_fail_hand_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW."number" = 2 THEN
          RAISE EXCEPTION 'injected next-hand failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER atomic_fail_hand_insert
      BEFORE INSERT ON "Hand"
      FOR EACH ROW EXECUTE FUNCTION atomic_fail_hand_insert()
    `);
    const timerBefore = getTurnTimerState(roomCode)!;
    events.length = 0;

    const failed = await apiAs(move.player.userId, move.player.user.username)
      .post("/api/games/play-card")
      .send(move.payload);

    expect(failed.statusCode).toBe(500);
    expect(failed.body).toEqual({ error: "Internal server error" });
    expect(await prisma.playedCard.count({ where: { handId: move.hand.id } })).toBe(3);
    expect(
      await prisma.hand.findUniqueOrThrow({ where: { id: move.hand.id } }),
    ).toMatchObject({ winnerId: null });
    expect(await prisma.hand.count({ where: { roundId: round.id } })).toBe(1);
    expect(
      await prisma.playerCard.count({
        where: {
          playerId: move.player.id,
          roundId: round.id,
          suit: move.payload.suit,
          value: move.payload.value,
        },
      }),
    ).toBe(1);
    expect(events).not.toContain("card_played");
    expectTimerUnchanged(roomCode, timerBefore);

    await prisma.$executeRawUnsafe(
      'DROP TRIGGER atomic_fail_hand_insert ON "Hand"',
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION atomic_fail_hand_insert()");

    const retry = await apiAs(move.player.userId, move.player.user.username)
      .post("/api/games/play-card")
      .send(move.payload);

    expect(retry.statusCode).toBe(200);
    expect(await prisma.playedCard.count({ where: { handId: move.hand.id } })).toBe(4);
    expect(await prisma.hand.count({ where: { roundId: round.id } })).toBe(2);
    expect(
      await prisma.hand.findUniqueOrThrow({ where: { id: move.hand.id } }),
    ).toMatchObject({ winnerId: expect.any(Number) });
  });

  it("rolls back the final card, winner, scores, and game finish", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    const move = await prepareLastCard(roomCode, round);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "GameRoom"
      ADD CONSTRAINT atomic_reject_finished CHECK (NOT "finished") NOT VALID
    `);
    const timerBefore = getTurnTimerState(roomCode)!;
    events.length = 0;

    const failed = await apiAs(move.player.userId, move.player.user.username)
      .post("/api/games/play-card")
      .send(move.payload);

    expect(failed.statusCode).toBe(500);
    expect(failed.body).toEqual({ error: "Internal server error" });
    expect(
      await prisma.gameRoom.findUniqueOrThrow({ where: { code: roomCode } }),
    ).toMatchObject({ finished: false });
    expect(
      await prisma.round.findUniqueOrThrow({ where: { id: round.id } }),
    ).toMatchObject({
      winnerTeam: null,
      team0Points: 0,
      team1Points: 0,
      team0Figures: 0,
      team1Figures: 0,
    });
    expect(
      await prisma.hand.findUniqueOrThrow({ where: { id: move.hand.id } }),
    ).toMatchObject({ winnerId: null });
    expect(await prisma.playedCard.count({ where: { handId: move.hand.id } })).toBe(3);
    expect(events).not.toContain("card_played");
    expect(events).not.toContain("round_ended");
    expect(events).not.toContain("game_finished");
    expectTimerUnchanged(roomCode, timerBefore);

    await prisma.$executeRawUnsafe(
      'ALTER TABLE "GameRoom" DROP CONSTRAINT atomic_reject_finished',
    );
    const retry = await apiAs(move.player.userId, move.player.user.username)
      .post("/api/games/play-card")
      .send(move.payload);

    expect(retry.statusCode).toBe(200);
    expect(
      await prisma.gameRoom.findUniqueOrThrow({ where: { code: roomCode } }),
    ).toMatchObject({ finished: true });
    expect(
      await prisma.round.findUniqueOrThrow({ where: { id: round.id } }),
    ).toMatchObject({ winnerTeam: expect.any(Number) });
    expect(await prisma.playedCard.count({ where: { handId: move.hand.id } })).toBe(4);
  });

  it("rolls back final-hand writes when next-round setup fails", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    const move = await prepareLastCard(roomCode, round);
    jest.spyOn(score, "decideGameWinner").mockReturnValue(null);
    const restoreRng = setRng(() => {
      throw new Error("injected next-round failure");
    });
    const timerBefore = getTurnTimerState(roomCode)!;
    events.length = 0;

    let failed;
    try {
      failed = await apiAs(move.player.userId, move.player.user.username)
        .post("/api/games/play-card")
        .send(move.payload);
    } finally {
      restoreRng();
    }

    expect(failed!.statusCode).toBe(500);
    expect(failed!.body).toEqual({ error: "Internal server error" });
    expect(
      await prisma.round.findUniqueOrThrow({ where: { id: round.id } }),
    ).toMatchObject({ winnerTeam: null, team0Points: 0, team1Points: 0 });
    expect(await prisma.round.count({ where: { gameRoomId: round.gameRoomId } })).toBe(1);
    expect(
      await prisma.hand.findUniqueOrThrow({ where: { id: move.hand.id } }),
    ).toMatchObject({ winnerId: null });
    expect(await prisma.playedCard.count({ where: { handId: move.hand.id } })).toBe(3);
    expect(events).not.toContain("card_played");
    expect(events).not.toContain("round_ended");
    expect(events).not.toContain("new_round_started");
    expectTimerUnchanged(roomCode, timerBefore);

    const retry = await apiAs(move.player.userId, move.player.user.username)
      .post("/api/games/play-card")
      .send(move.payload);

    expect(retry.statusCode).toBe(200);
    const rounds = await prisma.round.findMany({
      where: { gameRoomId: round.gameRoomId },
      orderBy: { number: "asc" },
      include: { playerCards: true },
    });
    expect(rounds).toHaveLength(2);
    expect(rounds[1].playerCards).toHaveLength(40);
    expect(await prisma.playedCard.count({ where: { handId: move.hand.id } })).toBe(4);
  });
});
