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
const teamChosenCallbacks: ((data: {
  userId: number;
  team: number;
}) => void)[] = [];
const readyChangedCallbacks: ((data: {
  userId: number;
  isReady: boolean;
}) => void)[] = [];
let onGameStartedCallbacks: (() => void) | null = null;

// Track our own reconnect handler so we can remove it without nuking other listeners
let reconnectHandler: (() => void) | null = null;

/**
 * Inizializza e registra tutti gli handler socket relativi alla stanza.
 * Da chiamare una sola volta (es: quando entri nella GameRoom).
 */
export const registerRoomHandlers = (roomCode: string, user: UserShort) => {
  const socket = getSocket();
  if (!isSocketConnected()) {
    socket.connect();
  }

  const joinRoom = () => {
    socket.emit("join_room", {
      roomCode,
      userId: user.userId,
      username: user.username,
    });
    console.log("🎮 [SOCKET] Joined room", roomCode, "as", user.username);
  };

  // Entra nella stanza subito
  joinRoom();

  // Remove only our previous reconnect handler (not all connect listeners!)
  if (reconnectHandler) {
    socket.off("connect", reconnectHandler);
  }

  // Create a new handler that re-joins on reconnect
  reconnectHandler = () => {
    console.log("🔄 [SOCKET] Reconnected, re-joining room", roomCode);
    joinRoom();
  };

  socket.on("connect", reconnectHandler);

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

  // Handler: player left
  socket.off("player_left");
  socket.on("player_left", (payload: { userId: number }) => {
    console.log("👋 Player left:", payload.userId);
    playerLeftCallbacks.forEach((cb) => cb(payload.userId));
  });

  socket.off("team_chosen");
  socket.on("team_chosen", (data: { userId: number; team: number }) => {
    console.log("🏳️‍🌈 Team chosen:", data);
    teamChosenCallbacks.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error("Callback error in team_chosen:", err);
      }
    });
  });

  socket.off("ready_changed");
  socket.on("ready_changed", (data: { userId: number; isReady: boolean }) => {
    console.log("✅ Ready changed:", data);
    readyChangedCallbacks.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error("Callback error in ready_changed:", err);
      }
    });
  });

  socket.off("game_started");
  socket.on("game_started", () => {
    console.log("🚀 Room started!");
    if (onGameStartedCallbacks) onGameStartedCallbacks();
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
  reconnectHandler = null;
  console.log("❌ [SOCKET] Room socket disconnected");
};

/**
 * Permette ad altri moduli di registrare callback
 */
// Callbacks per player_joined
export const onPlayerJoined = (callback: (player: Player) => void) => {
  playerJoinedCallbacks.push(callback);
};

export const offPlayerJoined = (callback: (player: Player) => void) => {
  const idx = playerJoinedCallbacks.indexOf(callback);
  if (idx !== -1) playerJoinedCallbacks.splice(idx, 1);
};

// Callbacks per player_left
export const onPlayerLeft = (cb: (userId: number) => void) => {
  playerLeftCallbacks.push(cb);
};

export const offPlayerLeft = (cb: (userId: number) => void) => {
  const idx = playerLeftCallbacks.indexOf(cb);
  if (idx !== -1) playerLeftCallbacks.splice(idx, 1);
};

// Callbacks per team_chosen
export const onTeamChosen = (
  callback: (data: { userId: number; team: number }) => void,
) => {
  teamChosenCallbacks.push(callback);
};

export const offTeamChosen = (
  callback: (data: { userId: number; team: number }) => void,
) => {
  const idx = teamChosenCallbacks.indexOf(callback);
  if (idx !== -1) teamChosenCallbacks.splice(idx, 1);
};

// Callbacks per ready_changed
export const onReadyChanged = (
  callback: (data: { userId: number; isReady: boolean }) => void,
) => {
  readyChangedCallbacks.push(callback);
};

export const offReadyChanged = (
  callback: (data: { userId: number; isReady: boolean }) => void,
) => {
  const idx = readyChangedCallbacks.indexOf(callback);
  if (idx !== -1) readyChangedCallbacks.splice(idx, 1);
};

export const onGameStarted = (cb: () => void) => {
  onGameStartedCallbacks = cb;
};

export const offGameStarted = () => {
  onGameStartedCallbacks = null;
};

// Stato connessione
export const isConnected = () => isSocketConnected();
