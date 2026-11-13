import { useEffect, useState } from "react";
import type { RoundDealView } from "@/game/model";

// Matches the server's deal animation length (backend roundDealPresentation).
const DEAL_ANIMATION_MS = 2400;

// Times are local clock milliseconds, already corrected for server skew.
export interface RoundDeal {
  animationEndsAt: number;
  reviewEndsAt: number;
}

export function useRoundDeal(deal: RoundDeal | null, enabled: boolean): RoundDealView {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!deal || !enabled) return;
    const remainingMs = deal.reviewEndsAt - Date.now();
    setNow(Date.now());
    if (remainingMs <= 0) return;
    const interval = setInterval(() => setNow(Date.now()), DEAL_ANIMATION_MS / 10);
    const deadline = setTimeout(() => {
      clearInterval(interval);
      setNow(Date.now());
    }, remainingMs);
    return () => {
      clearInterval(interval);
      clearTimeout(deadline);
    };
  }, [deal, enabled]);

  if (!deal || !enabled) {
    return { phase: "ready", dealtCards: 10, startedAt: 0, animationMs: 0 };
  }
  const startedAt = deal.animationEndsAt - DEAL_ANIMATION_MS;
  const current = Math.max(now, Date.now());
  const phase = current >= deal.reviewEndsAt ? "ready"
    : current >= deal.animationEndsAt ? "reviewing"
    : current < startedAt ? "collecting"
    : "dealing";
  const dealtCards = phase === "collecting" ? 0
    : phase === "dealing"
      ? Math.min(10, Math.max(0, Math.floor((now - startedAt - 300) / ((DEAL_ANIMATION_MS - 300) / 10)) + 1))
      : 10;
  return { phase, dealtCards, startedAt, animationMs: DEAL_ANIMATION_MS };
}
