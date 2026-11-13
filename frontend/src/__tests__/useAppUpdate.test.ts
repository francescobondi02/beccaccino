import { createElement } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useAppUpdate } from "@/hooks/useAppUpdate";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const fetchMock = vi.fn();
const reload = vi.fn();
const respond = (version: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ version })));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PROD", true);
  vi.stubEnv("VITE_APP_VERSION", "current");
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { reload });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  respond("current");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("useAppUpdate", () => {
  it("does not check for updates in development", () => {
    vi.stubEnv("PROD", false);
    renderHook(useAppUpdate);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("notifies once on a new build and reloads only when requested", async () => {
    await act(async () => { renderHook(useAppUpdate); });
    expect(toast).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/version.json", { cache: "no-store" });

    respond("new");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(toast).toHaveBeenCalledWith("Aggiornamento disponibile", expect.objectContaining({
      duration: Infinity,
      action: { label: "Ricarica", onClick: expect.any(Function) },
    }));
    expect(reload).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const action = vi.mocked(toast).mock.calls[0][1]?.action;
    if (!action || typeof action !== "object" || !("onClick" in action)) {
      throw new Error("Missing reload action");
    }
    render(createElement("button", { onClick: action.onClick }, "Ricarica"));
    fireEvent.click(screen.getByRole("button", { name: "Ricarica" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("checks when returning to a hidden tab", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    await act(async () => { renderHook(useAppUpdate); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).not.toHaveBeenCalled();

    respond("new");
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(toast).toHaveBeenCalledOnce();
  });

  it.each(["network", "http", "invalid"])("logs %s errors and retries without a false notification", async (failure) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    if (failure === "network") fetchMock.mockRejectedValue(new Error("Offline"));
    if (failure === "http") fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    if (failure === "invalid") respond(null);
    await act(async () => { renderHook(useAppUpdate); });
    expect(warn).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();

    respond("new");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(toast).toHaveBeenCalledOnce();
  });

  it("stops checks and ignores pending responses after unmount", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    const { unmount } = renderHook(useAppUpdate);
    unmount();
    await act(async () => { resolve(new Response(JSON.stringify({ version: "new" }))); });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(toast).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
