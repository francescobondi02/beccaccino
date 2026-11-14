import { getSocket } from "./socketClient";

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
