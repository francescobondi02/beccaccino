import { getSocket } from "./socketClient";

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
