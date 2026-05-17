// src/sockets/lobbyHandlers.ts
import { getSocket, isSocketConnected } from "./socketClient";

export type Room = {
  id: string;
  code: string;
  currentPlayers: number;
  maxPlayers: number;
};

// Registrazione dei callback
let roomCreatedCallbacks: ((room: Room) => void)[] = [];
let roomUpdatedCallbacks: ((data: {
  roomCode: string;
  currentPlayers: number;
}) => void)[] = [];
let roomFullCallbacks: ((data: { roomCode: string }) => void)[] = [];
let roomDeletedCallbacks: ((data: { roomCode: string }) => void)[] = [];

// Store userId for reconnection
let currentLobbyUserId: number | null = null;

// Track our own reconnect handler so we can remove it without nuking other listeners
let lobbyReconnectHandler: (() => void) | null = null;

/**
 * Inizializza e registra tutti gli handler socket relativi alla lobby.
 * Da chiamare una sola volta (es: al mount della pagina Lobby).
 */
export const registerLobbyHandlers = (userId: number) => {
  // Clear previous callbacks to prevent duplicates on re-mount
  roomCreatedCallbacks = [];
  roomUpdatedCallbacks = [];
  roomFullCallbacks = [];
  roomDeletedCallbacks = [];

  currentLobbyUserId = userId;

  const socket = getSocket();
  if (!isSocketConnected()) {
    socket.connect();
  }

  const joinLobby = () => {
    socket.emit("join_lobby", { userId });
  };

  // Join immediately
  joinLobby();

  // Remove only our previous reconnect handler (not all connect listeners!)
  if (lobbyReconnectHandler) {
    socket.off("connect", lobbyReconnectHandler);
  }

  // Re-join on reconnect so lobby events resume after a network drop
  lobbyReconnectHandler = () => {
    if (currentLobbyUserId !== null) {
      joinLobby();
    }
  };

  socket.on("connect", lobbyReconnectHandler);

  socket.off("room_created");
  socket.on("room_created", (data: { room: Room }) => {
    roomCreatedCallbacks.forEach((cb) => cb(data.room));
  });

  socket.off("room_updated");
  socket.on(
    "room_updated",
    (data: { roomCode: string; currentPlayers: number }) => {
      roomUpdatedCallbacks.forEach((cb) => cb(data));
    },
  );

  socket.off("room_full");
  socket.on("room_full", (data: { roomCode: string }) => {
    roomFullCallbacks.forEach((cb) => cb(data));
  });

  socket.off("room_deleted");
  socket.on("room_deleted", (data: { roomCode: string }) => {
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
  currentLobbyUserId = null;

  // Remove our reconnect handler when leaving lobby
  if (lobbyReconnectHandler) {
    socket.off("connect", lobbyReconnectHandler);
    lobbyReconnectHandler = null;
  }

};

/**
 * I metodi seguenti permettono ad altri moduli di registrare callback
 */
export const onRoomCreated = (callback: (room: Room) => void) => {
  roomCreatedCallbacks.push(callback);
};

export const onRoomUpdated = (
  callback: (data: { roomCode: string; currentPlayers: number }) => void,
) => {
  roomUpdatedCallbacks.push(callback);
};

export const onRoomFull = (callback: (data: { roomCode: string }) => void) => {
  roomFullCallbacks.push(callback);
};

export const onRoomDeleted = (
  callback: (data: { roomCode: string }) => void,
) => {
  roomDeletedCallbacks.push(callback);
};
