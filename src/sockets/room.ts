// src/sockets/room.ts
/**
 * Gestisce gli eventi socket relativi alla room (lobby) prima dell'inizio della partita.
 * Include: join room, leave room, choose team, ready state
 */

import { Server, Socket } from "socket.io";
import { prisma } from "../db";

// Interfacce per gli eventi
interface JoinRoomData {
  roomCode: string;
  userId: number;
  username: string;
}

interface ChooseTeamData {
  roomCode: string;
  userId: number;
  team: number;
}

interface ReadyData {
  roomCode: string;
  userId: number;
  isReady: boolean;
}

export function registerRoomSocket(socket: Socket, io: Server) {
  console.log("🔌 Socket client connected:", socket.id);

  /**
   * JOIN_LOBBY - Un utente loggato entra nella pagina principale
   * Si unisce alla "lobby globale" per ricevere aggiornamenti su nuove stanze
   */
  socket.on("join_lobby", (data: { userId: number }) => {
    const { userId } = data;
    console.log(`🏠 User ${userId} joined global lobby`);

    // Unisce l'utente alla lobby globale
    socket.join("lobby");
  });

  /**
   * LEAVE_LOBBY - Un utente lascia la pagina principale
   */
  socket.on("leave_lobby", () => {
    console.log(`🏠 User left global lobby`);
    socket.leave("lobby");
  });

  /**
   * JOIN_ROOM - Un giocatore entra nella room
   * Quando un utente entra in una room, si unisce alla "stanza" socket
   * e notifica tutti gli altri utenti nella stanza
   */
  socket.on("join_room", async (data: JoinRoomData) => {
    const { roomCode, userId, username } = data;

    console.log(`👤 ${username} (${userId}) joining room ${roomCode}`);

    try {
      // Verifica che la room esista e l'utente sia un player
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: {
          players: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      const player = room.players.find((p) => p.userId === userId);
      if (!player) {
        socket.emit("error", { message: "You are not in this room" });
        return;
      }

      // Unisce l'utente alla room socket e salva il riferimento per il disconnect handler
      socket.join(roomCode);
      socket.data.roomCode = roomCode;
      socket.data.user = { id: userId, username };

      // Notifica tutti gli altri nella room che un nuovo player si è unito
      socket.to(roomCode).emit("player_joined", {
        player: {
          id: player.id,
          userId: player.userId,
          username: player.user.username,
          seat: player.seat,
          team: player.team,
          isReady: player.isReady,
        },
      });

      console.log(`✅ ${username} joined room ${roomCode}`);
    } catch (error) {
      console.error("Error joining room:", error);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  /**
   * CHOOSE_TEAM - Un giocatore sceglie una squadra
   * Notifica tutti gli altri nella room della scelta
   */
  socket.on("choose_team", async (data: ChooseTeamData) => {
    const { roomCode, userId, team } = data;

    console.log(`🎯 User ${userId} choosing team ${team} in room ${roomCode}`);

    try {
      // Verifica che il team sia valido (0 o 1)
      if (![0, 1].includes(team)) {
        socket.emit("error", { message: "Invalid team" });
        return;
      }

      // Trova la room e il player
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      const player = room.players.find((p) => p.userId === userId);
      if (!player) {
        socket.emit("error", { message: "Player not found" });
        return;
      }

      // Verifica che il team non sia pieno
      const teamCount = room.players.filter((p) => p.team === team).length;
      if (teamCount >= 2) {
        socket.emit("error", { message: "Team is full" });
        return;
      }

      // Aggiorna il team nel database
      await prisma.player.update({
        where: { id: player.id },
        data: { team },
      });

      // Notifica tutti nella room (incluso chi ha fatto l'azione)
      io.to(roomCode).emit("team_chosen", {
        userId,
        playerId: player.id,
        team,
      });

      console.log(`✅ User ${userId} joined team ${team}`);
    } catch (error) {
      console.error("Error choosing team:", error);
      socket.emit("error", { message: "Failed to choose team" });
    }
  });

  /**
   * SET_READY - Un giocatore si mette pronto/non pronto
   * Notifica tutti nella room e controlla se tutti sono pronti per iniziare
   */
  socket.on("set_ready", async (data: ReadyData) => {
    const { roomCode, userId, isReady } = data;

    console.log(
      `⏳ User ${userId} setting ready to ${isReady} in room ${roomCode}`
    );

    try {
      // Trova la room e il player
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      const player = room.players.find((p) => p.userId === userId);
      if (!player) {
        socket.emit("error", { message: "Player not found" });
        return;
      }

      // Controlla che abbia scelto un team
      if (player.team === null) {
        socket.emit("error", { message: "Choose a team first" });
        return;
      }

      // Aggiorna lo stato ready nel database
      await prisma.player.update({
        where: { id: player.id },
        data: { isReady },
      });

      // Notifica tutti nella room
      io.to(roomCode).emit("ready_changed", {
        userId,
        playerId: player.id,
        isReady,
      });

      // Game-start logic is handled by the REST endpoint (POST /:roomCode/ready)
      // to avoid race conditions with dual paths.

      console.log(`✅ User ${userId} ready state: ${isReady}`);
    } catch (error) {
      console.error("Error setting ready:", error);
      socket.emit("error", { message: "Failed to set ready" });
    }
  });

  // Chat rate limiting: max 5 messages per 3 seconds per socket
  const chatRateLimit = { count: 0, resetTime: Date.now() };
  const CHAT_RATE_MAX = 5;
  const CHAT_RATE_WINDOW_MS = 3000;

  /**
   * SEND_CHAT_MESSAGE - Un giocatore invia un messaggio nella chat della room
   * Broadcast a tutti nella room (incluso il mittente per conferma).
   * Uses socket.data.roomCode (set on join_room) to prevent cross-room spoofing.
   * Rate-limited to prevent spam.
   */
  socket.on(
    "send_chat_message",
    (data: { roomCode?: string; message: string }) => {
      const { message } = data;
      const userId = socket.data.user?.id;
      const username = socket.data.user?.username;
      const roomCode = socket.data.roomCode; // Use trusted server-side value

      if (!userId || !username || !roomCode) {
        socket.emit("error", { message: "Not authenticated in room" });
        return;
      }

      // Rate limiting check
      const now = Date.now();
      if (now - chatRateLimit.resetTime > CHAT_RATE_WINDOW_MS) {
        chatRateLimit.count = 0;
        chatRateLimit.resetTime = now;
      }
      chatRateLimit.count++;
      if (chatRateLimit.count > CHAT_RATE_MAX) {
        socket.emit("error", { message: "Too many messages. Slow down!" });
        return;
      }

      // Validate input exists
      if (!message || typeof message !== "string") return;

      // Sanitize: trim, limit length, strip control characters
      const sanitized = message
        .trim()
        .slice(0, 200)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
      if (!sanitized) return;

      // Broadcast to all in room
      io.to(roomCode).emit("chat_message", {
        userId,
        username,
        message: sanitized,
        timestamp: new Date().toISOString(),
      });

      console.log(`💬 [${roomCode}] ${username}: ${sanitized}`);
    },
  );

  /**
   * LEAVE_ROOM - Un giocatore lascia la stanza socket
   * Rimuove il socket dalla room così non riceve più eventi
   */
  socket.on("leave_room", (data: { roomCode: string }) => {
    const { roomCode } = data;
    socket.leave(roomCode);
    console.log(`🚪 Socket ${socket.id} left room ${roomCode}`);
  });

  /**
   * DISCONNECT - Quando un client si disconnette
   * Notifica gli altri nella room e pulisce lo stato
   */
  socket.on("disconnect", () => {
    const userId = socket.data.user?.id;
    const username = socket.data.user?.username;
    console.log("🔌 Socket client disconnected:", socket.id, "user:", username);

    // Se abbiamo l'informazione dell'utente e della room, notifica gli altri
    if (userId && socket.data.roomCode) {
      socket.to(socket.data.roomCode).emit("player_disconnected", {
        userId,
        username: username ?? "Unknown",
      });
    }
  });
}
