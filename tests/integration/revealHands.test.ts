import { prisma } from "../../src/db";
import {
  clearDatabase,
  setupGame,
  chooseBriscola,
  api,
  apiAs,
} from "../helpers/gameHelpers";
import {
  BotServiceStub,
  startBotServiceStub,
} from "../helpers/botServiceStub";

/**
 * The reveal-hands field must be impossible to obtain in a real multiplayer game.
 *
 * Seeing every seat's cards is how a human judges whether a bot's "volo" was
 * honest, so practice games need it — but in a normal game it is a cheat. The
 * gate is server-side on GameRoom.isPractice, and this test is what stops a
 * future refactor from turning it into a client-trusted flag.
 */
describe("Reveal-hands is gated to practice games", () => {
  const TOKEN = "reveal-test-token";
  let stub: BotServiceStub;

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
  });

  afterEach(async () => {
    await stub.close();
    delete process.env.BOT_SERVICE_URL;
    delete process.env.BOT_SERVICE_TOKEN;
  });

  const fetchState = (roomCode: string, userId: number, username: string) =>
    apiAs(userId, username).get(`/api/games/${roomCode}/state`);

  it("never exposes other players' hands in a normal game", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);

    const players = await prisma.player.findMany({
      where: { gameRoom: { code: roomCode } },
      include: { user: true },
    });
    const me = players[0];

    const res = await fetchState(roomCode, me.userId, me.user.username);
    expect(res.statusCode).toBe(200);
    expect(res.body.isPractice).toBe(false);
    expect(res.body.allHands).toBeNull();

    // And what we DO get back is only our own ten cards.
    expect(res.body.myCards).toHaveLength(10);
    expect(
      res.body.myCards.every((c: { playerId: number }) => c.playerId === me.id),
    ).toBe(true);
  });

  it("exposes every seat's hand in a practice game", async () => {
    const registered = await api()
      .post("/api/users/register")
      .send({ username: "human", password: "test123" });
    const userId = registered.body.id;

    const created = await apiAs(userId, "human")
      .post("/api/rooms/practice")
      .send({ tier: "medio" });
    expect(created.statusCode).toBe(201);

    const res = await fetchState(created.body.code, userId, "human");
    expect(res.statusCode).toBe(200);
    expect(res.body.isPractice).toBe(true);
    expect(res.body.allHands).toHaveLength(4);

    // Freshly dealt: ten cards each, and the three bots are labelled with their
    // tier so the UI can tell which seat is which model.
    for (const hand of res.body.allHands) {
      expect(hand.cards).toHaveLength(10);
    }
    const botModels = res.body.allHands
      .map((h: { botModel: string | null }) => h.botModel)
      .filter(Boolean);
    expect(botModels).toEqual(["medio", "medio", "medio"]);
  });

  it("does not leak hands when a normal room is merely requested as practice", async () => {
    // The flag lives on the room, not the request — a client cannot ask for it.
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);

    const players = await prisma.player.findMany({
      where: { gameRoom: { code: roomCode } },
      include: { user: true },
    });
    const me = players[0];

    const res = await apiAs(me.userId, me.user.username)
      .get(`/api/games/${roomCode}/state?isPractice=true`)
      .send({ isPractice: true });

    expect(res.body.allHands).toBeNull();
  });
});
