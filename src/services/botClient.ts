// src/services/botClient.ts
/**
 * HTTP client for the Python bot service (`ai/serving/app.py`).
 *
 * Bots are disabled unless BOT_SERVICE_URL is set, so production is unaffected
 * until we deliberately point it somewhere. The service is trusted but its
 * responses are still shape-checked: a malformed move must fail here, where the
 * caller falls back to autoplay, rather than deep inside playCard.
 */

import { BotState } from "./botState";
import { BotTier } from "./botService";
import { isValidSuit, isValidValue } from "../middleware/validate";

/**
 * Per-request timeout. Well above the slowest tier (PIMC measures ~135 ms/move)
 * while staying far under the 60 s turn budget, so a wedged service surfaces as
 * a fallback rather than a hung seat.
 */
const BOT_REQUEST_TIMEOUT_MS = 5_000;

/** Read per call, not at import, so tests can point this at a stub. */
const botServiceUrl = () => process.env.BOT_SERVICE_URL;

const VALID_SIGNALS = ["striscio", "busso", "volo"] as const;

export type BotMove =
  | { kind: "briscola"; suit: string }
  | { kind: "card"; suit: string; value: string; signal: string | null };

export class BotServiceError extends Error {}

export function botServiceConfigured(): boolean {
  return Boolean(botServiceUrl());
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
  const baseUrl = botServiceUrl();
  if (!baseUrl) {
    throw new BotServiceError("BOT_SERVICE_URL is not set");
  }

  const response = await fetch(`${baseUrl}/act`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state: args.state,
      seat: args.seat,
      tier: args.tier,
      expected_legal_cards: args.expectedLegalCards,
    }),
    signal: AbortSignal.timeout(BOT_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new BotServiceError(`/act returned ${response.status}: ${detail.slice(0, 500)}`);
  }

  return parseMove(await response.json());
}

function parseMove(body: unknown): BotMove {
  const move = body as Record<string, unknown>;

  if (move?.kind === "briscola") {
    if (!isValidSuit(move.suit)) {
      throw new BotServiceError(`bad briscola suit: ${JSON.stringify(move.suit)}`);
    }
    return { kind: "briscola", suit: move.suit };
  }

  if (move?.kind === "card") {
    if (!isValidSuit(move.suit) || !isValidValue(move.value)) {
      throw new BotServiceError(`bad card: ${JSON.stringify(move)}`);
    }
    const signal = move.signal ?? null;
    if (signal !== null && !VALID_SIGNALS.includes(signal as (typeof VALID_SIGNALS)[number])) {
      throw new BotServiceError(`bad signal: ${JSON.stringify(signal)}`);
    }
    return { kind: "card", suit: move.suit, value: move.value, signal: signal as string | null };
  }

  throw new BotServiceError(`unrecognised move: ${JSON.stringify(body).slice(0, 200)}`);
}
