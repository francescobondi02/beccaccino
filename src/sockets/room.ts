// src/sockets/room.ts
/** Socket presence and chat handlers. Room mutations use the REST API. */

import { Server, Socket } from "socket.io";
import { prisma } from "../db";
import { logger } from "../logger";
import { PUBLIC_PLAYER_SELECT } from "../domain/publicPlayer";
import { sanitizeChatMessage } from "../utils/sanitizeChatMessage";

interface JoinRoomData {
  roomCode: string;
  userId: number;
  username: string;
}

interface JoinRoomResult {
  ok: boolean;
  error?: string;
}

export function registerRoomSocket(socket: Socket, io: Server) {
  /**
   * JOIN_LOBBY - Un utente loggato entra nella pagina principale
   * Si unisce alla "lobby globale" per ricevere aggiornamenti su nuove stanze
   */
  socket.on("join_lobby", () => {
    socket.join("lobby");
  });

  /**
   * LEAVE_LOBBY - Un utente lascia la pagina principale
   */
  socket.on("leave_lobby", () => {
    socket.leave("lobby");
  });

  /**
   * JOIN_ROOM - Un giocatore entra nella room
   * Quando un utente entra in una room, si unisce alla "stanza" socket
   * e notifica tutti gli altri utenti nella stanza
   */
  socket.on(
    "join_room",
    async (
      data: JoinRoomData,
      acknowledge?: (result: JoinRoomResult) => void,
    ) => {
      const { roomCode } = data;

      // Use verified identity from JWT handshake when available (production).
      // Fall back to client-sent data only in test mode where JWT handshake is skipped.
      const userId = socket.data.user?.userId ?? data.userId;
      const username = socket.data.user?.username ?? data.username;

      if (!userId || !username) {
        socket.emit("error", { message: "Not authenticated" });
        acknowledge?.({ ok: false, error: "Not authenticated" });
        return;
      }

      try {
        // Verifica che la room esista e l'utente sia un player
        const room = await prisma.gameRoom.findUnique({
          where: { code: roomCode },
          include: {
            players: {
              select: PUBLIC_PLAYER_SELECT,
            },
          },
        });

        if (!room) {
          socket.emit("error", { message: "Room not found" });
          acknowledge?.({ ok: false, error: "Room not found" });
          return;
        }

        const player = room.players.find((p) => p.userId === userId);
        if (!player) {
          socket.emit("error", { message: "You are not in this room" });
          acknowledge?.({ ok: false, error: "You are not in this room" });
          return;
        }

        const existingSocketIds = io.sockets.adapter.rooms.get(roomCode);
        const alreadyPresent = [...(existingSocketIds ?? [])].some(
          (socketId) =>
            io.sockets.sockets.get(socketId)?.data.user?.userId === userId,
        );

        const previousRoomCode = socket.data.roomCode;
        if (previousRoomCode && previousRoomCode !== roomCode) {
          socket.leave(previousRoomCode);
        }

        // Unisce l'utente alla room socket e salva il riferimento per il disconnect handler
        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        // Store user info for use by other handlers (chat, disconnect, etc.)
        // In production this comes from JWT; in test from client data.
        socket.data.user = { userId, username, id: userId };

        // Notifica tutti gli altri nella room che un nuovo player si è unito
        if (!alreadyPresent) {
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
        }
        acknowledge?.({ ok: true });
      } catch (error) {
        logger.error({ err: error, roomCode, userId }, "join_room_failed");
        socket.emit("error", { message: "Failed to join room" });
        acknowledge?.({ ok: false, error: "Failed to join room" });
      }
    },
  );

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

      const sanitized = sanitizeChatMessage(message);
      if (!sanitized) return;

      // Broadcast to all in room
      io.to(roomCode).emit("chat_message", {
        userId,
        username,
        message: sanitized,
        timestamp: new Date().toISOString(),
      });
    },
  );

  /**
   * LEAVE_ROOM - Un giocatore lascia la stanza socket
   * Rimuove il socket dalla room così non riceve più eventi
   */
  socket.on("leave_room", (data: { roomCode: string }) => {
    const { roomCode } = data;
    socket.leave(roomCode);
    if (socket.data.roomCode === roomCode) {
      delete socket.data.roomCode;
    }
  });

  /**
   * DISCONNECT - Quando un client si disconnette
   * Notifica gli altri nella room e pulisce lo stato
   */
  socket.on("disconnecting", () => {
    const userId = socket.data.user?.id;
    const username = socket.data.user?.username;

    if (userId && socket.data.roomCode) {
      const roomCode = socket.data.roomCode;
      const roomSocketIds = io.sockets.adapter.rooms.get(roomCode);
      const hasAnotherSocket = [...(roomSocketIds ?? [])].some(
        (socketId) =>
          socketId !== socket.id &&
          io.sockets.sockets.get(socketId)?.data.user?.userId === userId,
      );
      if (hasAnotherSocket) return;

      socket.to(roomCode).emit("player_disconnected", {
        userId,
        username: username ?? "Unknown",
      });
    }
  });
}
