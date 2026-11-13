import { getSocket } from "./socketClient";
import type { ServerToClientEvents } from "@contract/socket";

type RoomEventName = Exclude<keyof ServerToClientEvents, "lobby_changed" | "error">;

type RoomEventListener<Event extends RoomEventName> =
  ServerToClientEvents[Event];

interface RoomEventSocket {
  on<Event extends RoomEventName>(
    event: Event,
    listener: RoomEventListener<Event>,
  ): void;
  off<Event extends RoomEventName>(
    event: Event,
    listener: RoomEventListener<Event>,
  ): void;
}

export function registerRoomHandlers(
  roomCode: string,
  onJoined?: () => void,
): () => void {
  const socket = getSocket();
  let active = true;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  socket.connect();

  const joinRoom = () => {
    clearTimeout(retryTimer);
    if (!active || !socket.connected) return;

    socket.emit(
      "join_room",
      { roomCode },
      (result) => {
        if (!active || !socket.connected) return;
        if (result.ok) onJoined?.();
        else if (result.error === "Failed to join room") {
          retryTimer = setTimeout(joinRoom, 5000);
        }
      },
    );
  };

  if (socket.connected) joinRoom();
  socket.on("connect", joinRoom);

  return () => {
    active = false;
    clearTimeout(retryTimer);
    socket.off("connect", joinRoom);
  };
}

export function leaveRoom(roomCode: string) {
  getSocket().emit("leave_room", { roomCode });
}

export function subscribeToRoomEvent<Event extends RoomEventName>(
  event: Event,
  listener: RoomEventListener<Event>,
): () => void {
  const socket = getSocket() as unknown as RoomEventSocket;
  socket.on(event, listener);
  return () => socket.off(event, listener);
}
