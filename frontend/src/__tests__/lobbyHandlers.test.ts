import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { leaveLobby, registerLobbyHandlers } from "@/sockets/lobbyHandlers";

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

  it("emits leave_lobby", () => {
    leaveLobby();
    expect(mockSocket.emit).toHaveBeenCalledWith("leave_lobby");
  });
});
