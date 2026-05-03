import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock socket.io-client
const mockSocket = {
  connected: false,
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

// Must import after mocking
import { getSocket, isSocketConnected, disconnectSocket } from "@/sockets/socketClient";

describe("socketClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module singleton by disconnecting
    disconnectSocket();
  });

  describe("getSocket", () => {
    it("creates a socket on first call", () => {
      const socket = getSocket();
      expect(socket).toBeDefined();
    });

    it("returns the same socket on subsequent calls (singleton)", () => {
      const socket1 = getSocket();
      const socket2 = getSocket();
      expect(socket1).toBe(socket2);
    });
  });

  describe("isSocketConnected", () => {
    it("returns false when socket is not connected", () => {
      mockSocket.connected = false;
      getSocket(); // ensure socket exists
      expect(isSocketConnected()).toBe(false);
    });

    it("returns true when socket is connected", () => {
      getSocket(); // ensure socket exists
      mockSocket.connected = true;
      expect(isSocketConnected()).toBe(true);
    });

    it("returns false when no socket has been created", () => {
      // disconnectSocket was called in beforeEach
      expect(isSocketConnected()).toBe(false);
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
});
