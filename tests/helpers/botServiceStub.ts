import http from "http";
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

/**
 * Start the stub. `handler` returns the move body, or throws to make the
 * endpoint fail — `{ status, body }` to control the HTTP response precisely.
 */
export async function startBotServiceStub(
  handler: ActHandler,
): Promise<BotServiceStub> {
  const requests: BotServiceStub["requests"] = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      if (req.url !== "/act") {
        res.writeHead(404).end();
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

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
