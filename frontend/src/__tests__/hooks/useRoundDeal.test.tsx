import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRoundDeal } from "@/hooks/useRoundDeal";

describe("round dealing", () => {
  afterEach(() => vi.useRealTimers());

  it("collects the trick, deals ten cards, then leaves time to read before briscola", () => {
    vi.useFakeTimers();
    const deal = { animationEndsAt: Date.now() + 5400, reviewEndsAt: Date.now() + 7000 };
    const { result, unmount } = renderHook(() => useRoundDeal(deal, true));
    expect(result.current.phase).toBe("collecting");
    expect(result.current.dealtCards).toBe(0);
    act(() => vi.advanceTimersByTime(3360));
    expect(result.current.phase).toBe("dealing");
    expect(result.current.dealtCards).toBeGreaterThan(0);
    expect(result.current.dealtCards).toBeLessThan(10);
    act(() => vi.advanceTimersByTime(2160));
    expect(result.current.phase).toBe("reviewing");
    expect(result.current.dealtCards).toBe(10);
    act(() => vi.advanceTimersByTime(1480));
    expect(result.current.phase).toBe("ready");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replay on a late reconnect and cancels when paused or play starts", () => {
    vi.useFakeTimers();
    const deal = { animationEndsAt: Date.now() + 2400, reviewEndsAt: Date.now() + 4000 };
    const { result, rerender } = renderHook(
      ({ enabled, presentation }) => useRoundDeal(presentation, enabled),
      { initialProps: { enabled: true, presentation: deal } },
    );
    expect(result.current.phase).toBe("dealing");
    rerender({ enabled: false, presentation: deal });
    expect(result.current.phase).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
    rerender({ enabled: true, presentation: { animationEndsAt: Date.now() - 1601, reviewEndsAt: Date.now() - 1 } });
    expect(result.current.phase).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });
});
