import { useEffect, useState } from "react";
import type { TurnTimer } from "@/game/model";

export function useTurnCountdown(turnTimer: TurnTimer | null): number | null {
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!turnTimer || turnTimer.totalMs === null) {
      setCountdown(null);
      return;
    }
    const totalMs = turnTimer.totalMs;

    const tick = () => {
      const elapsed = Date.now() - turnTimer.startedAt;
      setCountdown(Math.max(0, Math.ceil((totalMs - elapsed) / 1000)));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [turnTimer]);

  return countdown;
}
