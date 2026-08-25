// src/services/botClient.ts
/**
 * HTTP client for the Python bot service (`ai/serving/app.py`).
 *
 * Practice games require BOT_SERVICE_URL and BOT_SERVICE_TOKEN. Responses are
 * still shape-checked: a malformed move must fail here, where the caller falls
 * back to autoplay, rather than deep inside playCard.
 */

import { BotState } from "./botState";
import { BotTier } from "./botService";
import {
  CardSignal,
  isCardSignal,
  isSuit,
  isValue,
  Suit,
  Value,
} from "../domain/cards";

/**
 * Per-request timeout. Well above the slowest tier (PIMC measures ~135 ms/move)
 * while staying far under the 60 s turn budget, so a wedged service surfaces as
 * a fallback rather than a hung seat.
 */
const BOT_REQUEST_TIMEOUT_MS = 5_000;
const BOT_READY_TIMEOUT_MS = 75_000;

type BotServiceConfig = {
  baseUrl: string;
  token: string;
};

export type BotMove =
  | { kind: "briscola"; suit: Suit }
  | {
      kind: "card";
      suit: Suit;
      value: Value;
      signal: CardSignal | null;
    };

export class BotServiceError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "BotServiceError";
    this.cause = cause;
  }
}

/** Wake the service and verify both the promoted model and shared credential. */
export async function ensureBotServiceReady(tier: BotTier): Promise<void> {
  const config = botServiceConfig();
  let response: Response;
  try {
    response = await fetch(
      `${config.baseUrl}/ready?tier=${encodeURIComponent(tier)}`,
      {
        headers: authorizationHeaders(config.token),
        signal: AbortSignal.timeout(BOT_READY_TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw new BotServiceError("bot service readiness request failed", error);
  }

  if (!response.ok) {
    throw new BotServiceError(`bot service readiness returned ${response.status}`);
  }

  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (body.status !== "ok" || body.model !== "ready" || body.tier !== tier) {
      throw new Error("unexpected readiness response");
    }
  } catch {
    throw new BotServiceError("bot service returned invalid readiness");
  }
}

/**
 * Ask the bot service for a move.
 *
 * `expectedLegalCards` is the card set WE believe is playable. The service
 * compares it against its own rules engine and returns 409 on disagreement —
 * that mismatch means one of us rebuilt a different board, and a plausible move
 * on a wrong board is worse than no move at all.
 */
export async function requestBotMove(args: {
  state: BotState;
  seat: number;
  tier: BotTier;
  expectedLegalCards?: { suit: string; value: string }[];
}): Promise<BotMove> {
  const config = botServiceConfig();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/act`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authorizationHeaders(config.token),
      },
      body: JSON.stringify({
        state: args.state,
        seat: args.seat,
        tier: args.tier,
        expected_legal_cards: args.expectedLegalCards,
      }),
      signal: AbortSignal.timeout(BOT_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new BotServiceError("bot service move request failed", error);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new BotServiceError(`/act returned ${response.status}: ${detail.slice(0, 500)}`);
  }

  return parseMove(await response.json());
}

function parseMove(body: unknown): BotMove {
  const move = body as Record<string, unknown>;

  if (move?.kind === "briscola") {
    if (!isSuit(move.suit)) {
      throw new BotServiceError(`bad briscola suit: ${JSON.stringify(move.suit)}`);
    }
    return { kind: "briscola", suit: move.suit };
  }

  if (move?.kind === "card") {
    if (!isSuit(move.suit) || !isValue(move.value)) {
      throw new BotServiceError(`bad card: ${JSON.stringify(move)}`);
    }
    const signal = move.signal ?? null;
    if (signal !== null && !isCardSignal(signal)) {
      throw new BotServiceError(`bad signal: ${JSON.stringify(signal)}`);
    }
    return { kind: "card", suit: move.suit, value: move.value, signal };
  }

  throw new BotServiceError(`unrecognised move: ${JSON.stringify(body).slice(0, 200)}`);
}

/** Read per call so tests and local tools can point the client at a stub. */
function botServiceConfig(): BotServiceConfig {
  const baseUrl = process.env.BOT_SERVICE_URL?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new BotServiceError("BOT_SERVICE_URL is not set");
  }

  const token = process.env.BOT_SERVICE_TOKEN;
  if (!token) {
    throw new BotServiceError("BOT_SERVICE_TOKEN is not set");
  }

  return { baseUrl, token };
}

function authorizationHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
