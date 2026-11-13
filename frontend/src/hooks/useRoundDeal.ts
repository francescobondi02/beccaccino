import { useEffect, useState } from "react";
import type { RoundDeal, RoundDealView } from "@/game/model";

export function useRoundDeal(deal: RoundDeal | null, enabled: boolean): RoundDealView {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!deal || !enabled) return;
    const remainingMs = deal.readyAt - Date.now();
    setNow(Date.now());
    if (remainingMs <= 0) return;
    const interval = setInterval(() => setNow(Date.now()), deal.animationMs / 10);
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
  const startedAt = deal.readyAt - deal.reviewMs - deal.animationMs;
  const remainingMs = deal.readyAt - Math.max(now, Date.now());
  const phase = remainingMs <= 0 ? "ready"
    : remainingMs <= deal.reviewMs ? "reviewing"
    : remainingMs > deal.reviewMs + deal.animationMs ? "collecting"
    : "dealing";
  const dealtCards = phase === "collecting" ? 0
    : phase === "dealing"
      ? Math.min(10, Math.max(0, Math.floor((now - startedAt - 300) / ((deal.animationMs - 300) / 10)) + 1))
      : 10;
  return { phase, dealtCards, startedAt, animationMs: deal.animationMs };
}
