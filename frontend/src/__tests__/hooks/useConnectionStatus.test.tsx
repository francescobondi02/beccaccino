import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import type { ConnectionStatus } from "@/sockets/socketClient";

const mocks = vi.hoisted(() => ({
  status: "disconnected" as ConnectionStatus,
  listeners: new Set<(status: ConnectionStatus) => void>(),
}));

vi.mock("@/sockets/socketClient", () => ({
  getConnectionStatus: () => mocks.status,
  onConnectionStatusChange: (
    listener: (status: ConnectionStatus) => void,
  ) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
}));

function emitStatus(status: ConnectionStatus) {
  mocks.status = status;
  act(() => {
    mocks.listeners.forEach((listener) => listener(status));
  });
}

describe("useConnectionStatus", () => {
  beforeEach(() => {
    mocks.status = "disconnected";
    mocks.listeners.clear();
  });

  it("exposes the current status and tracks changes", () => {
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current).toBe("disconnected");

    emitStatus("connected");
    expect(result.current).toBe("connected");
  });

  it("does not treat the initial connection as a reconnect", () => {
    const onReconnect = vi.fn();
    renderHook(() => useConnectionStatus(onReconnect));

    emitStatus("connected");

    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("runs reconciliation after a connected session is interrupted", () => {
    mocks.status = "connected";
    const onReconnect = vi.fn();
    renderHook(() => useConnectionStatus(onReconnect));

    emitStatus("reconnecting");
    emitStatus("connected");

    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useConnectionStatus());
    expect(mocks.listeners.size).toBe(1);

    unmount();

    expect(mocks.listeners.size).toBe(0);
  });
});
