import { getSocket } from "./socketClient";
import type { ServerToClientEvents } from "./events";

type LobbyEventName =
  | "room_created"
  | "room_updated"
  | "room_full"
  | "room_deleted"
  | "practice_paused"
  | "practice_resumed"
  | "practice_abandoned";

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

export function registerLobbyHandlers(onReconnect?: () => void): () => void {
  const socket = getSocket();
  socket.connect();

  const joinLobby = () => {
    socket.emit("join_lobby");
  };

  joinLobby();
  const rejoinLobby = () => {
    joinLobby();
    onReconnect?.();
  };
  socket.on("connect", rejoinLobby);

  return () => {
    socket.off("connect", rejoinLobby);
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
