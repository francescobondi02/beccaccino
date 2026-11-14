import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTurnCountdown } from "@/hooks/useTurnCountdown";

describe("useTurnCountdown", () => {
  afterEach(() => vi.useRealTimers());

  it("counts down to the deadline, stops at zero and clears without a deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { result, rerender } = renderHook(({ deadline }) => useTurnCountdown(deadline), {
      initialProps: { deadline: 150_000 as number | null },
    });

    expect(result.current).toBe(50);
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current).toBe(48);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(0);

    rerender({ deadline: null });
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
