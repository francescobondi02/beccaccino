import http, { IncomingHttpHeaders } from "http";
import { AddressInfo } from "net";

/**
 * A stand-in for the Python bot service, so the bot-turn driver can be tested
 * without a Python process. It answers /act by delegating to a plain function,
 * which lets a test script legal moves, latency, and failures.
 */
export interface BotServiceStub {
  url: string;
  /** Every /act request received, in order. */
  requests: ActRequest[];
  actHeaders: IncomingHttpHeaders[];
  readyHeaders: IncomingHttpHeaders[];
  readyTiers: (string | null)[];
  close(): Promise<void>;
}

/** What the real service returns from /act — see ai/serving/app.py. */
export type StubMove =
  | { kind: "briscola"; suit: string }
  | { kind: "card"; suit: string; value: string; signal: string | null };

export type ActRequest = {
  state: any;
  seat: number;
  tier: string;
  expected_legal_cards?: { suit: string; value: string }[];
};

export type ActHandler = (request: ActRequest) => Promise<StubMove> | StubMove;

export type BotServiceStubOptions = {
  readyStatus?: number;
  readyBody?: unknown;
  readyDelayMs?: number;
  requiredToken?: string;
  port?: number;
};

/**
 * Start the stub. `handler` returns the move body, or throws to make the
 * endpoint fail — `{ status, body }` to control the HTTP response precisely.
 */
export async function startBotServiceStub(
  handler: ActHandler,
  options: BotServiceStubOptions = {},
): Promise<BotServiceStub> {
  const requests: BotServiceStub["requests"] = [];
  const actHeaders: BotServiceStub["actHeaders"] = [];
  const readyHeaders: BotServiceStub["readyHeaders"] = [];
  const readyTiers: BotServiceStub["readyTiers"] = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      const requestUrl = new URL(req.url ?? "/", "http://bot.test");
      const expectedAuthorization = options.requiredToken
        ? `Bearer ${options.requiredToken}`
        : null;

      if (requestUrl.pathname === "/ready") {
        const tier = requestUrl.searchParams.get("tier");
        readyHeaders.push(req.headers);
        readyTiers.push(tier);
        if (options.readyDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.readyDelayMs));
        }
        if (
          expectedAuthorization &&
          req.headers.authorization !== expectedAuthorization
        ) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "unauthorized" }));
          return;
        }
        res.writeHead(options.readyStatus ?? 200, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify(
            options.readyBody ?? { status: "ok", model: "ready", tier },
          ),
        );
        return;
      }

      if (requestUrl.pathname !== "/act") {
        res.writeHead(404).end();
        return;
      }

      actHeaders.push(req.headers);
      if (
        expectedAuthorization &&
        req.headers.authorization !== expectedAuthorization
      ) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "unauthorized" }));
        return;
      }

      const parsed = JSON.parse(raw);
      requests.push(parsed);

      try {
        const move = await handler(parsed);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(move));
      } catch (error) {
        const failure = error as { status?: number; body?: unknown };
        res.writeHead(failure.status ?? 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify(failure.body ?? { detail: String(error) }));
      }
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, "127.0.0.1", resolve),
  );
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    actHeaders,
    readyHeaders,
    readyTiers,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
