// src/sockets/lobbyHandlers.ts
import { getSocket, isSocketConnected } from "./socketClient";
import type {
  LobbyRoom,
  RoomUpdatedPayload,
  RoomCodePayload,
} from "./events";

export type Room = LobbyRoom;

// Registrazione dei callback
const roomCreatedCallbacks: ((room: Room) => void)[] = [];
const roomUpdatedCallbacks: ((data: RoomUpdatedPayload) => void)[] = [];
const roomFullCallbacks: ((data: RoomCodePayload) => void)[] = [];
const roomDeletedCallbacks: ((data: RoomCodePayload) => void)[] = [];

// Store userId for reconnection
let currentLobbyUserId: number | null = null;

// Track our own reconnect handler so we can remove it without nuking other listeners
let lobbyReconnectHandler: (() => void) | null = null;

/**
 * Inizializza e registra tutti gli handler socket relativi alla lobby.
 * Da chiamare una sola volta (es: al mount della pagina Lobby).
 */
export const registerLobbyHandlers = (userId: number) => {
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
  socket.on("room_created", (data) => {
    roomCreatedCallbacks.forEach((cb) => cb(data.room));
  });

  socket.off("room_updated");
  socket.on("room_updated", (data) => {
    roomUpdatedCallbacks.forEach((cb) => cb(data));
  });

  socket.off("room_full");
  socket.on("room_full", (data) => {
    roomFullCallbacks.forEach((cb) => cb(data));
  });

  socket.off("room_deleted");
  socket.on("room_deleted", (data) => {
    roomDeletedCallbacks.forEach((cb) => cb(data));
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

export const offRoomCreated = (callback: (room: Room) => void) => {
  const idx = roomCreatedCallbacks.indexOf(callback);
  if (idx !== -1) roomCreatedCallbacks.splice(idx, 1);
};

export const onRoomUpdated = (
  callback: (data: RoomUpdatedPayload) => void,
) => {
  roomUpdatedCallbacks.push(callback);
};

export const offRoomUpdated = (
  callback: (data: RoomUpdatedPayload) => void,
) => {
  const idx = roomUpdatedCallbacks.indexOf(callback);
  if (idx !== -1) roomUpdatedCallbacks.splice(idx, 1);
};

export const onRoomFull = (callback: (data: RoomCodePayload) => void) => {
  roomFullCallbacks.push(callback);
};

export const offRoomFull = (callback: (data: RoomCodePayload) => void) => {
  const idx = roomFullCallbacks.indexOf(callback);
  if (idx !== -1) roomFullCallbacks.splice(idx, 1);
};

export const onRoomDeleted = (callback: (data: RoomCodePayload) => void) => {
  roomDeletedCallbacks.push(callback);
};

export const offRoomDeleted = (callback: (data: RoomCodePayload) => void) => {
  const idx = roomDeletedCallbacks.indexOf(callback);
  if (idx !== -1) roomDeletedCallbacks.splice(idx, 1);
};
