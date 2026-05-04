import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock socket.io-client
const mockSocket = {
  connected: true,
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

import {
  registerLobbyHandlers,
  leaveLobby,
  onRoomCreated,
  onRoomUpdated,
  onRoomFull,
  onRoomDeleted,
} from "@/sockets/lobbyHandlers";

describe("lobbyHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = true;
  });

  describe("registerLobbyHandlers", () => {
    it("emits join_lobby with the userId", () => {
      registerLobbyHandlers(42);
      expect(mockSocket.emit).toHaveBeenCalledWith("join_lobby", { userId: 42 });
    });

    it("registers socket event listeners", () => {
      registerLobbyHandlers(1);

      // Should have called socket.off then socket.on for each event
      expect(mockSocket.off).toHaveBeenCalledWith("room_created");
      expect(mockSocket.off).toHaveBeenCalledWith("room_updated");
      expect(mockSocket.off).toHaveBeenCalledWith("room_full");
      expect(mockSocket.off).toHaveBeenCalledWith("room_deleted");
      expect(mockSocket.off).toHaveBeenCalledWith("error");

      expect(mockSocket.on).toHaveBeenCalledWith("connect", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("room_created", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("room_updated", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("room_full", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("room_deleted", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("clears previous callbacks on re-registration", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      registerLobbyHandlers(1);
      onRoomCreated(cb1);

      // Re-register — should clear cb1
      registerLobbyHandlers(1);
      onRoomCreated(cb2);

      // Simulate room_created event
      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "room_created"
      );
      const handler = onCall![1];
      handler({ room: { id: "1", code: "ABC123", currentPlayers: 1, maxPlayers: 4 } });

      // Only cb2 should fire (cb1 was cleared)
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledWith({
        id: "1",
        code: "ABC123",
        currentPlayers: 1,
        maxPlayers: 4,
      });
    });
  });

  describe("leaveLobby", () => {
    it("emits leave_lobby", () => {
      leaveLobby();
      expect(mockSocket.emit).toHaveBeenCalledWith("leave_lobby");
    });
  });

  describe("callback registration", () => {
    it("onRoomUpdated fires registered callback", () => {
      registerLobbyHandlers(1);

      const cb = vi.fn();
      onRoomUpdated(cb);

      // Find the room_updated handler
      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "room_updated"
      );
      const handler = onCall![1];
      handler({ roomCode: "XYZ", currentPlayers: 3 });

      expect(cb).toHaveBeenCalledWith({ roomCode: "XYZ", currentPlayers: 3 });
    });

    it("onRoomFull fires registered callback", () => {
      registerLobbyHandlers(1);

      const cb = vi.fn();
      onRoomFull(cb);

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "room_full"
      );
      const handler = onCall![1];
      handler({ roomCode: "FULL01" });

      expect(cb).toHaveBeenCalledWith({ roomCode: "FULL01" });
    });

    it("onRoomDeleted fires registered callback", () => {
      registerLobbyHandlers(1);

      const cb = vi.fn();
      onRoomDeleted(cb);

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "room_deleted"
      );
      const handler = onCall![1];
      handler({ roomCode: "DEL01" });

      expect(cb).toHaveBeenCalledWith({ roomCode: "DEL01" });
    });
  });
});
