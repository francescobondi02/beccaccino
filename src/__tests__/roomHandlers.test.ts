import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;
const serverListeners = new Map<string, Set<Listener>>();

const mockSocket = {
  connected: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn((event: string, listener: Listener) => {
    const listeners = serverListeners.get(event) ?? new Set();
    listeners.add(listener);
    serverListeners.set(event, listeners);
  }),
  off: vi.fn((event: string, listener: Listener) => {
    serverListeners.get(event)?.delete(listener);
  }),
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
  disconnectRoomSocket,
  isConnected,
  leaveRoom,
  registerRoomHandlers,
  subscribeToRoomEvent,
} from "@/sockets/roomHandlers";

function socketListener(event: string) {
  const call = mockSocket.on.mock.calls
    .filter(([name]) => name === event)
    .at(-1);
  if (!call) throw new Error(`No listener registered for ${event}`);
  return call[1] as (...args: unknown[]) => void;
}

function lastJoinAcknowledgement() {
  const call = mockSocket.emit.mock.calls
    .filter(([name]) => name === "join_room")
    .at(-1);
  if (!call) throw new Error("No join_room emission");
  return call[2] as (result: { ok: boolean; error?: string }) => void;
}

describe("roomHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverListeners.clear();
    mockSocket.connected = true;
  });

  it("joins immediately and rejoins after reconnect", () => {
    registerRoomHandlers("ROOM", { userId: 1, username: "alice" });
    expect(mockSocket.emit).toHaveBeenCalledWith("join_room", {
      roomCode: "ROOM",
      userId: 1,
      username: "alice",
    }, expect.any(Function));

    mockSocket.emit.mockClear();
    socketListener("connect")();

    expect(mockSocket.emit).toHaveBeenCalledWith("join_room", {
      roomCode: "ROOM",
      userId: 1,
      username: "alice",
    }, expect.any(Function));
  });

  it("connects before joining when needed", () => {
    mockSocket.connected = false;
    registerRoomHandlers("ROOM", { userId: 1, username: "alice" });
    expect(mockSocket.connect).toHaveBeenCalledOnce();
  });

  it("reconciles only after the server acknowledges a successful join", () => {
    const onJoined = vi.fn();
    registerRoomHandlers(
      "ROOM",
      { userId: 1, username: "alice" },
      onJoined,
    );

    expect(onJoined).not.toHaveBeenCalled();
    lastJoinAcknowledgement()({ ok: false, error: "Room not found" });
    expect(onJoined).not.toHaveBeenCalled();

    socketListener("connect")();
    lastJoinAcknowledgement()({ ok: true });
    expect(onJoined).toHaveBeenCalledOnce();
  });

  it("unregisters only its own reconnect listener", () => {
    const unregister = registerRoomHandlers("ROOM", {
      userId: 1,
      username: "alice",
    });
    const listener = socketListener("connect");

    unregister();

    expect(mockSocket.off).toHaveBeenCalledWith("connect", listener);
  });

  it("subscribes and unsubscribes the same event callback", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToRoomEvent("player_left", callback);
    const listener = socketListener("player_left");

    listener({ userId: 42 });
    expect(callback).toHaveBeenCalledWith({ userId: 42 });

    unsubscribe();
    expect(mockSocket.off).toHaveBeenCalledWith("player_left", callback);
  });

  it("does not remove another subscriber for the same event", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToRoomEvent("ready_changed", first);
    subscribeToRoomEvent("ready_changed", second);

    serverListeners
      .get("ready_changed")
      ?.forEach((listener) => listener({ userId: 1, isReady: true }));
    unsubscribeFirst();
    serverListeners
      .get("ready_changed")
      ?.forEach((listener) => listener({ userId: 1, isReady: false }));

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("emits leave_room without disconnecting the shared socket", () => {
    leaveRoom("ROOM");
    expect(mockSocket.emit).toHaveBeenCalledWith("leave_room", {
      roomCode: "ROOM",
    });
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
  });

  it("exposes connection state and explicit disconnection", () => {
    expect(isConnected()).toBe(true);
    disconnectRoomSocket();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });
});
