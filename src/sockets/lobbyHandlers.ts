import { getSocket, isSocketConnected } from "./socketClient";
import type { ServerToClientEvents } from "./events";

type LobbyEventName =
  | "room_created"
  | "room_updated"
  | "room_full"
  | "room_deleted";

type LobbyEventListener<Event extends LobbyEventName> =
  ServerToClientEvents[Event];

interface LobbyEventSocket {
  on<Event extends LobbyEventName>(
    event: Event,
    listener: LobbyEventListener<Event>,
  ): void;
  off<Event extends LobbyEventName>(
    event: Event,
    listener: LobbyEventListener<Event>,
  ): void;
}

export function registerLobbyHandlers(userId: number): () => void {
  const socket = getSocket();
  if (!isSocketConnected()) {
    socket.connect();
  }

  const joinLobby = () => {
    socket.emit("join_lobby", { userId });
  };

  joinLobby();
  socket.on("connect", joinLobby);

  return () => {
    socket.off("connect", joinLobby);
  };
}

export function leaveLobby() {
  getSocket().emit("leave_lobby");
}

export function subscribeToLobbyEvent<Event extends LobbyEventName>(
  event: Event,
  listener: LobbyEventListener<Event>,
): () => void {
  const socket = getSocket() as unknown as LobbyEventSocket;
  socket.on(event, listener);
  return () => socket.off(event, listener);
}
