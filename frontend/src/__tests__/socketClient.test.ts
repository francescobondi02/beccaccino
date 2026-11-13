import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { io } from "socket.io-client";

// Mock socket.io-client
const mockSocket = {
  connected: false,
  active: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  io: {
    on: vi.fn(),
    off: vi.fn(),
  },
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (msg: string) => toastError(msg) },
}));

// Must import after mocking
import {
  getSocket,
  disconnectSocket,
  getConnectionStatus,
} from "@/sockets/socketClient";

function emitSocketEvent(event: string, ...args: unknown[]) {
  const listener = mockSocket.on.mock.calls.find(([name]) => name === event)?.[1];
  if (!listener) throw new Error(`No listener registered for ${event}`);
  listener(...args);
}

describe("socketClient", () => {
  beforeEach(() => {
    disconnectSocket();
    vi.clearAllMocks();
    mockSocket.connected = false;
    mockSocket.active = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    disconnectSocket();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("getSocket", () => {
    it("creates a socket on the page origin on first call", () => {
      expect(getSocket()).toBeDefined();
      expect(io).toHaveBeenCalledWith(window.location.origin, expect.any(Object));
    });

    it("returns the same socket on subsequent calls (singleton)", () => {
      const socket1 = getSocket();
      const socket2 = getSocket();
      expect(socket1).toBe(socket2);
    });
  });

  describe("disconnectSocket", () => {
    it("disconnects and nulls the socket", () => {
      getSocket(); // create socket
      disconnectSocket();
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it("does nothing if no socket exists", () => {
      // Already disconnected in beforeEach
      disconnectSocket(); // should not throw
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
    });
  });

  describe("server errors", () => {
    it("registers one singleton listener that surfaces error messages", () => {
      getSocket();
      const onCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === "error"
      );
      const handler = onCall![1];
      handler({ message: "Room not found" });

      expect(toastError).toHaveBeenCalledWith("Room not found");
      getSocket();
      expect(
        mockSocket.on.mock.calls.filter(([event]) => event === "error"),
      ).toHaveLength(1);
    });
  });

  describe("connection recovery", () => {
    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("retries unavailable authentication without declaring the socket connected early", () => {
      getSocket();
      mockSocket.active = false;
      emitSocketEvent("connect_error", new Error("Authentication unavailable"));
      expect(getConnectionStatus()).toBe("reconnecting");

      const reconnect = mockSocket.io.on.mock.calls.find(
        ([event]) => event === "reconnect",
      )?.[1];
      reconnect?.();
      expect(getConnectionStatus()).toBe("reconnecting");
      expect(mockSocket.connect).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5000);
      expect(mockSocket.connect).toHaveBeenCalledOnce();

      emitSocketEvent("connect_error", new Error("Authentication unavailable"));
      vi.advanceTimersByTime(5000);
      expect(mockSocket.connect).toHaveBeenCalledTimes(2);

      mockSocket.connected = true;
      emitSocketEvent("connect");
      expect(getConnectionStatus()).toBe("connected");
      vi.advanceTimersByTime(10000);
      expect(mockSocket.connect).toHaveBeenCalledTimes(2);
    });

    it.each(["Authentication required", "Invalid or expired token"])(
      "cancels pending retries when the session is rejected: %s",
      (message) => {
        getSocket();
        emitSocketEvent("connect_error", new Error("Authentication unavailable"));
        emitSocketEvent("connect_error", new Error(message));
        vi.advanceTimersByTime(10000);

        expect(mockSocket.connect).not.toHaveBeenCalled();
        expect(mockSocket.disconnect).toHaveBeenCalledOnce();
        expect(getConnectionStatus()).toBe("disconnected");
        expect(toastError).toHaveBeenCalledWith(
          "Sessione scaduta. Accedi di nuovo per continuare.",
        );
      },
    );

    it("does not reconnect a logged-out socket", () => {
      getSocket();
      emitSocketEvent("connect_error", new Error("Authentication unavailable"));

      disconnectSocket();
      vi.advanceTimersByTime(10000);

      expect(mockSocket.connect).not.toHaveBeenCalled();
      expect(getConnectionStatus()).toBe("disconnected");
    });

    it.each([true, false])(
      "leaves other connection failures to Socket.IO when active=%s",
      (active) => {
        getSocket();
        mockSocket.active = active;
        emitSocketEvent("connect_error", new Error("Other connection failure"));
        vi.advanceTimersByTime(10000);

        expect(mockSocket.connect).not.toHaveBeenCalled();
        expect(getConnectionStatus()).toBe(
          active ? "reconnecting" : "disconnected",
        );
      },
    );
  });
});
