// src/sockets/roomHandlers.ts
import { getSocket, isSocketConnected, disconnectSocket } from "./socketClient";

type UserShort = { userId: number; username: string };

export type Player = {
  id: number;
  userId: number;
  username: string;
  seat: number | null;
  team: number | null;
  isReady: boolean;
};

type PlayerJoinedPayload = {
  player: Player;
};

// Callback registry
const playerJoinedCallbacks: ((player: Player) => void)[] = [];
const playerLeftCallbacks: ((userId: number) => void)[] = [];

/**
 * Inizializza e registra tutti gli handler socket relativi alla stanza.
 * Da chiamare una sola volta (es: quando entri nella GameRoom).
 */
export const registerRoomHandlers = (roomCode: string, user: UserShort) => {
  const socket = getSocket();
  if (!isSocketConnected()) {
    socket.connect();
  }

  // Entra nella stanza
  socket.emit("join_room", {
    roomCode,
    userId: user.userId,
    username: user.username,
  });
  console.log("🎮 [SOCKET] Joined room", roomCode, "as", user.username);

  // Handler: player joined
  socket.off("player_joined");
  socket.on("player_joined", (payload: PlayerJoinedPayload) => {
    console.log("➕ Player joined:", payload.player);
    playerJoinedCallbacks.forEach((cb) => {
      try {
        cb(payload.player);
      } catch (err) {
        console.error("Callback error in player_joined:", err);
      }
    });
  });

  // Altri eventi (es: player_left, game_started) si aggiungono qui
  socket.off("player_left");
  socket.on("player_left", (payload: { userId: number }) => {
    console.log("👋 Player left:", payload.userId);
    playerLeftCallbacks.forEach((cb) => cb(payload.userId));
  });
};

/**
 * Cleanup e disconnessione dalla stanza
 */
export const leaveRoom = (roomCode: string) => {
  const socket = getSocket();
  socket.emit("leave_room", { roomCode });
  console.log("🚪 [SOCKET] Left room", roomCode);
};

export const disconnectRoomSocket = () => {
  disconnectSocket();
  console.log("❌ [SOCKET] Room socket disconnected");
};

/**
 * Permette ad altri moduli di registrare callback
 */
export const onPlayerJoined = (callback: (player: Player) => void) => {
  playerJoinedCallbacks.push(callback);
};

export const offPlayerJoined = (callback: (player: Player) => void) => {
  const idx = playerJoinedCallbacks.indexOf(callback);
  if (idx !== -1) playerJoinedCallbacks.splice(idx, 1);
};

export const onPlayerLeft = (cb: (userId: number) => void) => {
  playerLeftCallbacks.push(cb);
};

export const offPlayerLeft = (cb: (userId: number) => void) => {
  const idx = playerLeftCallbacks.indexOf(cb);
  if (idx !== -1) playerLeftCallbacks.splice(idx, 1);
};

// Stato connessione
export const isConnected = () => isSocketConnected();
