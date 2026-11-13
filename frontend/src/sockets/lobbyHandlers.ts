import { getSocket } from "./socketClient";
import type { ServerToClientEvents } from "@contract/socket";

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

export function subscribeToLobbyChanges(
  listener: ServerToClientEvents["lobby_changed"],
): () => void {
  const socket = getSocket();
  socket.on("lobby_changed", listener);
  return () => {
    socket.off("lobby_changed", listener);
  };
}
