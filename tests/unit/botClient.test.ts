import {
  BotServiceError,
  ensureBotServiceReady,
  requestBotMove,
} from "../../src/services/botClient";

describe("Bot service client", () => {
  const TOKEN = "test-bot-token";
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    process.env.BOT_SERVICE_TOKEN = TOKEN;
    process.env.BOT_SERVICE_URL = "https://bot.example.test/";
    fetchMock = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchMock.mockRestore();
    delete process.env.BOT_SERVICE_URL;
    delete process.env.BOT_SERVICE_TOKEN;
  });

  it("authenticates readiness and validates the response contract", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ status: "ok", model: "ready", tier: "forte" }),
        { status: 200 },
      ),
    );

    await expect(ensureBotServiceReady("forte")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://bot.example.test/ready?tier=forte",
      expect.objectContaining({
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );
  });

  it("authenticates move requests and parses their response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ kind: "briscola", suit: "denara" }), {
        status: 200,
      }),
    );

    const move = await requestBotMove({
      state: {} as never,
      seat: 1,
      tier: "forte",
    });

    expect(move).toEqual({ kind: "briscola", suit: "denara" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://bot.example.test/act",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
      }),
    );
  });

  it("fails before making a request when the token is missing", async () => {
    delete process.env.BOT_SERVICE_TOKEN;

    await expect(ensureBotServiceReady("forte")).rejects.toThrow(
      new BotServiceError("BOT_SERVICE_TOKEN is not set"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unavailable or malformed readiness responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(ensureBotServiceReady("forte")).rejects.toThrow(
      "bot service readiness returned 503",
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );

    await expect(ensureBotServiceReady("forte")).rejects.toThrow(
      "bot service returned invalid readiness",
    );
  });

  it("rejects readiness for a different tier", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ status: "ok", model: "ready", tier: "medio" }),
        { status: 200 },
      ),
    );

    await expect(ensureBotServiceReady("forte")).rejects.toThrow(
      "bot service returned invalid readiness",
    );
  });
});
