import { useEffect, useState } from "react";

// deadline is a local clock time in milliseconds, already corrected for server skew.
export function useTurnCountdown(deadline: number | null): number | null {
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) {
      setCountdown(null);
      return;
    }
    const tick = () => {
      setCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return countdown;
}
