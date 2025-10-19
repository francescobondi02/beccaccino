// src/sockets/lobbyHandlers.ts
import { getSocket, isSocketConnected } from "./socketClient";

export type Room = {
  id: string;
  code: string;
  currentPlayers: number;
  maxPlayers: number;
};

// Registrazione dei callback
const roomCreatedCallbacks: ((room: Room) => void)[] = [];
const roomUpdatedCallbacks: ((data: {
  roomCode: string;
  currentPlayers: number;
}) => void)[] = [];
const roomFullCallbacks: ((data: { roomCode: string }) => void)[] = [];
const roomDeletedCallbacks: ((data: { roomCode: string }) => void)[] = [];

/**
 * Inizializza e registra tutti gli handler socket relativi alla lobby.
 * Da chiamare una sola volta (es: al mount della pagina Lobby).
 */
export const registerLobbyHandlers = (userId: number) => {
  const socket = getSocket();
  if (!isSocketConnected()) {
    socket.connect();
  }

  socket.emit("join_lobby", { userId });
  console.log("🏠 [SOCKET] Joined global lobby as", userId);

  socket.off("room_created");
  socket.on("room_created", (data: { room: Room }) => {
    console.log("🆕 New room created:", data.room);
    roomCreatedCallbacks.forEach((cb) => cb(data.room));
  });

  socket.off("room_updated");
  socket.on(
    "room_updated",
    (data: { roomCode: string; currentPlayers: number }) => {
      console.log("🔄 Room updated:", data);
      roomUpdatedCallbacks.forEach((cb) => cb(data));
    }
  );

  socket.off("room_full");
  socket.on("room_full", (data: { roomCode: string }) => {
    console.log("🔒 Room full:", data.roomCode);
    roomFullCallbacks.forEach((cb) => cb(data));
  });

  socket.off("room_deleted");
  socket.on("room_deleted", (data: { roomCode: string }) => {
    console.log("❌ [SOCKET] Room deleted:", data.roomCode);
    roomDeletedCallbacks.forEach((cb) => cb(data));
  });

  socket.off("error");
  socket.on("error", (data: { message: string }) => {
    console.error("❌ Lobby socket error:", data.message);
  });
};

// Cleanup alla disconnessione
export const leaveLobby = () => {
  const socket = getSocket();
  socket.emit("leave_lobby");
  console.log("🚪 [SOCKET] Left lobby");
};

/**
 * I metodi seguenti permettono ad altri moduli di registrare callback
 */
export const onRoomCreated = (callback: (room: Room) => void) => {
  roomCreatedCallbacks.push(callback);
};

export const onRoomUpdated = (
  callback: (data: { roomCode: string; currentPlayers: number }) => void
) => {
  roomUpdatedCallbacks.push(callback);
};

export const onRoomFull = (callback: (data: { roomCode: string }) => void) => {
  roomFullCallbacks.push(callback);
};

export const onRoomDeleted = (
  callback: (data: { roomCode: string }) => void
) => {
  roomDeletedCallbacks.push(callback);
};
