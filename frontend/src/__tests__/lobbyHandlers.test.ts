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
  leaveLobby,
  registerLobbyHandlers,
  subscribeToLobbyEvent,
} from "@/sockets/lobbyHandlers";

function socketListener(event: string) {
  const call = mockSocket.on.mock.calls
    .filter(([name]) => name === event)
    .at(-1);
  if (!call) throw new Error(`No listener registered for ${event}`);
  return call[1] as (...args: unknown[]) => void;
}

describe("lobbyHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverListeners.clear();
    mockSocket.connected = true;
  });

  it("joins immediately and rejoins after reconnect", () => {
    const onReconnect = vi.fn();
    registerLobbyHandlers(onReconnect);
    expect(mockSocket.emit).toHaveBeenCalledWith("join_lobby");
    expect(onReconnect).not.toHaveBeenCalled();

    mockSocket.emit.mockClear();
    socketListener("connect")();

    expect(mockSocket.emit).toHaveBeenCalledWith("join_lobby");
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("connects before joining when needed", () => {
    mockSocket.connected = false;
    registerLobbyHandlers();
    expect(mockSocket.connect).toHaveBeenCalledOnce();
  });

  it("unregisters only its own reconnect listener", () => {
    const unregister = registerLobbyHandlers();
    const listener = socketListener("connect");

    unregister();

    expect(mockSocket.off).toHaveBeenCalledWith("connect", listener);
  });

  it("subscribes and unsubscribes the same event callback", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToLobbyEvent("room_updated", callback);
    const listener = socketListener("room_updated");

    listener({ roomCode: "ROOM", currentPlayers: 3 });
    expect(callback).toHaveBeenCalledWith({
      roomCode: "ROOM",
      currentPlayers: 3,
    });

    unsubscribe();
    expect(mockSocket.off).toHaveBeenCalledWith("room_updated", callback);
  });

  it("does not remove another subscriber for the same event", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToLobbyEvent("room_full", first);
    subscribeToLobbyEvent("room_full", second);

    serverListeners
      .get("room_full")
      ?.forEach((listener) => listener({ roomCode: "ROOM" }));
    unsubscribeFirst();
    serverListeners
      .get("room_full")
      ?.forEach((listener) => listener({ roomCode: "ROOM" }));

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("emits leave_lobby", () => {
    leaveLobby();
    expect(mockSocket.emit).toHaveBeenCalledWith("leave_lobby");
  });
});
