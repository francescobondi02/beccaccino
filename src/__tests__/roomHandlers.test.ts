import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock socket.io-client
const mockSocket = {
  connected: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

import {
  registerRoomHandlers,
  leaveRoom,
  disconnectRoomSocket,
  onPlayerJoined,
  offPlayerJoined,
  onPlayerLeft,
  offPlayerLeft,
  onTeamChosen,
  offTeamChosen,
  onReadyChanged,
  offReadyChanged,
  onGameStarted,
  offGameStarted,
  isConnected,
} from "@/sockets/roomHandlers";

describe("roomHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = true;
  });

  describe("registerRoomHandlers", () => {
    it("emits join_room with roomCode, userId and username", () => {
      registerRoomHandlers("ABC123", { userId: 1, username: "Francesco" });
      expect(mockSocket.emit).toHaveBeenCalledWith("join_room", {
        roomCode: "ABC123",
        userId: 1,
        username: "Francesco",
      });
    });

    it("connects if not already connected", () => {
      mockSocket.connected = false;
      registerRoomHandlers("XYZ", { userId: 2, username: "Mario" });
      expect(mockSocket.connect).toHaveBeenCalled();
    });

    it("does not call connect if already connected", () => {
      mockSocket.connected = true;
      registerRoomHandlers("XYZ", { userId: 2, username: "Mario" });
      expect(mockSocket.connect).not.toHaveBeenCalled();
    });

    it("registers socket event listeners", () => {
      registerRoomHandlers("ROOM1", { userId: 1, username: "Test" });

      expect(mockSocket.off).toHaveBeenCalledWith("connect");
      expect(mockSocket.off).toHaveBeenCalledWith("player_joined");
      expect(mockSocket.off).toHaveBeenCalledWith("player_left");
      expect(mockSocket.off).toHaveBeenCalledWith("team_chosen");
      expect(mockSocket.off).toHaveBeenCalledWith("ready_changed");
      expect(mockSocket.off).toHaveBeenCalledWith("game_started");

      expect(mockSocket.on).toHaveBeenCalledWith("connect", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("player_joined", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("player_left", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("team_chosen", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("ready_changed", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("game_started", expect.any(Function));
    });

    it("re-joins the room on reconnect", () => {
      registerRoomHandlers("RECONNECT", { userId: 5, username: "Reconnector" });

      // Find the 'connect' handler
      const connectCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "connect"
      );
      const reconnectHandler = connectCall![1];

      // Clear previous emit calls
      mockSocket.emit.mockClear();

      // Simulate reconnect
      reconnectHandler();

      expect(mockSocket.emit).toHaveBeenCalledWith("join_room", {
        roomCode: "RECONNECT",
        userId: 5,
        username: "Reconnector",
      });
    });
  });

  describe("leaveRoom", () => {
    it("emits leave_room with roomCode", () => {
      leaveRoom("LEAVE1");
      expect(mockSocket.emit).toHaveBeenCalledWith("leave_room", {
        roomCode: "LEAVE1",
      });
    });
  });

  describe("callback registration — onPlayerJoined", () => {
    it("fires callback when player_joined event comes", () => {
      registerRoomHandlers("ROOM", { userId: 1, username: "A" });

      const cb = vi.fn();
      onPlayerJoined(cb);

      // Find the player_joined handler
      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "player_joined"
      );
      const handler = onCall![1];

      const player = { id: 1, userId: 2, username: "NewPlayer", seat: null, team: null, isReady: false };
      handler({ player });

      expect(cb).toHaveBeenCalledWith(player);
    });

    it("offPlayerJoined removes callback", () => {
      registerRoomHandlers("ROOM", { userId: 1, username: "A" });

      const cb = vi.fn();
      onPlayerJoined(cb);
      offPlayerJoined(cb);

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "player_joined"
      );
      const handler = onCall![1];
      handler({ player: { id: 1, userId: 2, username: "X", seat: null, team: null, isReady: false } });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("callback registration — onPlayerLeft", () => {
    it("fires callback when player_left event comes", () => {
      registerRoomHandlers("ROOM", { userId: 1, username: "A" });

      const cb = vi.fn();
      onPlayerLeft(cb);

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "player_left"
      );
      const handler = onCall![1];
      handler({ userId: 42 });

      expect(cb).toHaveBeenCalledWith(42);
    });

    it("offPlayerLeft removes callback", () => {
      registerRoomHandlers("ROOM", { userId: 1, username: "A" });

      const cb = vi.fn();
      onPlayerLeft(cb);
      offPlayerLeft(cb);

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "player_left"
      );
      const handler = onCall![1];
      handler({ userId: 42 });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("callback registration — onTeamChosen", () => {
    it("fires callback with team data", () => {
      registerRoomHandlers("ROOM", { userId: 1, username: "A" });

      const cb = vi.fn();
      onTeamChosen(cb);

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "team_chosen"
      );
      const handler = onCall![1];
      handler({ userId: 3, team: 2 });

      expect(cb).toHaveBeenCalledWith({ userId: 3, team: 2 });
    });

    it("offTeamChosen removes callback", () => {
      registerRoomHandlers("ROOM", { userId: 1, username: "A" });

      const cb = vi.fn();
      onTeamChosen(cb);
      offTeamChosen(cb);

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "team_chosen"
      );
      const handler = onCall![1];
      handler({ userId: 3, team: 2 });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("callback registration — onReadyChanged", () => {
    it("fires callback with ready data", () => {
      registerRoomHandlers("ROOM", { userId: 1, username: "A" });

      const cb = vi.fn();
      onReadyChanged(cb);

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "ready_changed"
      );
      const handler = onCall![1];
      handler({ userId: 7, isReady: true });

      expect(cb).toHaveBeenCalledWith({ userId: 7, isReady: true });
    });

    it("offReadyChanged removes callback", () => {
      registerRoomHandlers("ROOM", { userId: 1, username: "A" });

      const cb = vi.fn();
      onReadyChanged(cb);
      offReadyChanged(cb);

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "ready_changed"
      );
      const handler = onCall![1];
      handler({ userId: 7, isReady: true });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("callback registration — onGameStarted", () => {
    it("fires callback when game_started event comes", () => {
      registerRoomHandlers("ROOM", { userId: 1, username: "A" });

      const cb = vi.fn();
      onGameStarted(cb);

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "game_started"
      );
      const handler = onCall![1];
      handler();

      expect(cb).toHaveBeenCalledOnce();
    });

    it("offGameStarted clears the callback", () => {
      registerRoomHandlers("ROOM", { userId: 1, username: "A" });

      const cb = vi.fn();
      onGameStarted(cb);
      offGameStarted();

      const onCall = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "game_started"
      );
      const handler = onCall![1];
      handler();

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("isConnected", () => {
    it("returns true when socket is connected", () => {
      mockSocket.connected = true;
      expect(isConnected()).toBe(true);
    });

    it("returns false when socket is not connected", () => {
      mockSocket.connected = false;
      expect(isConnected()).toBe(false);
    });
  });
});
