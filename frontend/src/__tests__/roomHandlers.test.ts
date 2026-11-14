import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JoinRoomResult } from "@contract/socket";

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

import { leaveRoom, registerRoomHandlers } from "@/sockets/roomHandlers";

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
  return call[2] as (result: JoinRoomResult) => void;
}

describe("roomHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("joins immediately and rejoins after reconnect", () => {
    registerRoomHandlers("ROOM");
    expect(mockSocket.emit).toHaveBeenCalledWith("join_room", {
      roomCode: "ROOM",
    }, expect.any(Function));

    mockSocket.emit.mockClear();
    socketListener("connect")();

    expect(mockSocket.emit).toHaveBeenCalledWith("join_room", {
      roomCode: "ROOM",
    }, expect.any(Function));
  });

  it("connects before joining when needed", () => {
    mockSocket.connected = false;
    registerRoomHandlers("ROOM");
    expect(mockSocket.connect).toHaveBeenCalledOnce();
  });

  it("reconciles only after the server acknowledges a successful join", () => {
    const onJoined = vi.fn();
    registerRoomHandlers(
      "ROOM",
      onJoined,
    );

    expect(onJoined).not.toHaveBeenCalled();
    lastJoinAcknowledgement()({ ok: false, error: "Room not found" });
    expect(onJoined).not.toHaveBeenCalled();

    socketListener("connect")();
    lastJoinAcknowledgement()({ ok: true });
    expect(onJoined).toHaveBeenCalledOnce();
  });

  it("retries failed room joins and reconciles after recovery without reconnecting", () => {
    const onJoined = vi.fn();
    const unregister = registerRoomHandlers(
      "ROOM",
      onJoined,
    );
    lastJoinAcknowledgement()({ ok: false, error: "Failed to join room" });
    expect(onJoined).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(mockSocket.emit).toHaveBeenCalledTimes(2);
    lastJoinAcknowledgement()({ ok: false, error: "Failed to join room" });
    vi.advanceTimersByTime(5000);
    expect(mockSocket.emit).toHaveBeenCalledTimes(3);
    lastJoinAcknowledgement()({ ok: true });

    vi.advanceTimersByTime(10000);
    expect(mockSocket.emit).toHaveBeenCalledTimes(3);
    expect(onJoined).toHaveBeenCalledOnce();
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
    unregister();
  });

  it.each(["Room not found", "You are not in this room", "Not authenticated"])(
    "does not retry a rejected room join: %s",
    (error) => {
      const unregister = registerRoomHandlers("ROOM");
      lastJoinAcknowledgement()({ ok: false, error });
      vi.advanceTimersByTime(10000);
      expect(mockSocket.emit).toHaveBeenCalledOnce();
      unregister();
    },
  );

  it("cancels retries and ignores late acknowledgements after unregistering", () => {
    const onJoined = vi.fn();
    const unregister = registerRoomHandlers(
      "ROOM",
      onJoined,
    );
    const acknowledge = lastJoinAcknowledgement();
    acknowledge({ ok: false, error: "Failed to join room" });
    unregister();
    acknowledge({ ok: false, error: "Failed to join room" });
    acknowledge({ ok: true });
    vi.advanceTimersByTime(10000);

    expect(mockSocket.emit).toHaveBeenCalledOnce();
    expect(onJoined).not.toHaveBeenCalled();
  });

  it("waits for reconnection instead of buffering a room retry while disconnected", () => {
    const unregister = registerRoomHandlers("ROOM");
    lastJoinAcknowledgement()({ ok: false, error: "Failed to join room" });
    mockSocket.connected = false;
    vi.advanceTimersByTime(5000);
    expect(mockSocket.emit).toHaveBeenCalledOnce();

    mockSocket.connected = true;
    socketListener("connect")();
    lastJoinAcknowledgement()({ ok: true });
    vi.advanceTimersByTime(10000);
    expect(mockSocket.emit).toHaveBeenCalledTimes(2);
    unregister();
  });

  it("unregisters only its own reconnect listener", () => {
    const unregister = registerRoomHandlers("ROOM");
    const listener = socketListener("connect");

    unregister();

    expect(mockSocket.off).toHaveBeenCalledWith("connect", listener);
  });

  it("emits leave_room without disconnecting the shared socket", () => {
    leaveRoom("ROOM");
    expect(mockSocket.emit).toHaveBeenCalledWith("leave_room", {
      roomCode: "ROOM",
    });
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
  });
});
