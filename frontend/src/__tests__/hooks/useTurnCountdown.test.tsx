import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTurnCountdown } from "@/hooks/useTurnCountdown";
import type { TurnTimer } from "@/game/model";

describe("useTurnCountdown", () => {
  afterEach(() => vi.useRealTimers());

  it("counts down from the anchored start, stops at zero and clears without a limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const timer: TurnTimer = { turnUserId: 1, totalMs: 60_000, startedAt: 90_000, phase: "play_card" };
    const { result, rerender } = renderHook(({ turnTimer }) => useTurnCountdown(turnTimer), {
      initialProps: { turnTimer: timer as TurnTimer | null },
    });

    expect(result.current).toBe(50);
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current).toBe(48);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(0);

    rerender({ turnTimer: { ...timer, totalMs: null } });
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
