import { getSocket, isSocketConnected, disconnectSocket } from "./socketClient";
import type { ServerToClientEvents } from "./events";

type UserShort = { userId: number; username: string };

type RoomEventName = Exclude<
  keyof ServerToClientEvents,
  "room_created" | "room_updated" | "room_full" | "room_deleted" | "error"
>;

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
  user: UserShort,
  onJoined?: () => void,
): () => void {
  const socket = getSocket();
  if (!isSocketConnected()) {
    socket.connect();
  }

  const joinRoom = () => {
    socket.emit(
      "join_room",
      {
        roomCode,
        userId: user.userId,
        username: user.username,
      },
      (result) => {
        if (result.ok) onJoined?.();
      },
    );
  };

  if (socket.connected) joinRoom();
  socket.on("connect", joinRoom);

  return () => {
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

export function disconnectRoomSocket() {
  disconnectSocket();
}

export const isConnected = () => isSocketConnected();
