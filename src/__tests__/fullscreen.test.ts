import { afterEach, describe, expect, it, vi } from "vitest";
import { enterGameFullscreen } from "@/lib/fullscreen";

function mockDevice({ phone }: { phone: boolean }) {
  const requestFullscreen = vi.fn().mockResolvedValue(undefined);
  const lock = vi.fn().mockRejectedValue(new Error("NotSupportedError"));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: phone && query === "(pointer: coarse)" }));
  vi.stubGlobal("screen", { width: phone ? 390 : 1440, height: phone ? 844 : 900, orientation: { lock } });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  document.documentElement.requestFullscreen = requestFullscreen;
  return { requestFullscreen, lock };
}

describe("enterGameFullscreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("goes fullscreen in landscape on phones and tolerates a refused lock", async () => {
    const { requestFullscreen, lock } = mockDevice({ phone: true });
    await expect(enterGameFullscreen()).resolves.toBeUndefined();
    expect(requestFullscreen).toHaveBeenCalled();
    expect(lock).toHaveBeenCalledWith("landscape");
  });

  it("leaves desktop windows alone", async () => {
    const { requestFullscreen, lock } = mockDevice({ phone: false });
    await enterGameFullscreen();
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
  });
});
