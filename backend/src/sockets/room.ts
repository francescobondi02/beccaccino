// src/sockets/room.ts
/** Socket presence and chat handlers. Room mutations use the REST API. */

import { Server, Socket } from "socket.io";
import { prisma } from "../db";
import { logger } from "../logger";
import { PUBLIC_PLAYER_SELECT } from "../domain/publicPlayer";
import { sanitizeChatMessage } from "../utils/sanitizeChatMessage";
import { changePlayerControlUnlocked } from "../services/playerControl";
import { withRoomLock } from "../utils/roomLock";

interface JoinRoomResult {
  ok: boolean;
  error?: string;
}

type Acknowledge = (result: JoinRoomResult) => void;

/** Client payloads are untrusted: read a field only from a plain object. */
function field(data: unknown, key: string): unknown {
  return typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)[key]
    : undefined;
}

export function registerRoomSocket(socket: Socket, io: Server) {
  const fail = (error: string, acknowledge?: Acknowledge) => {
    socket.emit("error", { message: error });
    acknowledge?.({ ok: false, error });
  };

  socket.on("join_lobby", () => {
    socket.join("lobby");
  });

  socket.on("leave_lobby", () => {
    socket.leave("lobby");
  });

  socket.on("join_room", async (data: unknown, ack?: unknown) => {
    const acknowledge = typeof ack === "function" ? (ack as Acknowledge) : undefined;
    const roomCode = field(data, "roomCode");
    if (typeof roomCode !== "string") return fail("Invalid payload", acknowledge);

    const { userId } = socket.data.user;

    try {
      await withRoomLock(roomCode, async () => {
        const room = await prisma.gameRoom.findUnique({
          where: { code: roomCode },
          include: {
            players: {
              select: PUBLIC_PLAYER_SELECT,
            },
          },
        });

        if (!room) return fail("Room not found", acknowledge);

        const player = room.players.find((p) => p.userId === userId);
        if (!player) return fail("You are not in this room", acknowledge);
        if (player.abandonedAt && !room.finished) {
          return fail("Hai abbandonato questa partita", acknowledge);
        }
        if (room.started && !room.finished && player.botModel !== null) {
          await changePlayerControlUnlocked({ roomCode, userId, action: "resume" });
        }

        const existingSocketIds = io.sockets.adapter.rooms.get(roomCode);
        const alreadyPresent = [...(existingSocketIds ?? [])].some(
          (socketId) =>
            io.sockets.sockets.get(socketId)?.data.user.userId === userId,
        );

        const previousRoomCode = socket.data.roomCode;
        if (previousRoomCode && previousRoomCode !== roomCode) {
          socket.leave(previousRoomCode);
        }

        socket.join(roomCode);
        socket.data.roomCode = roomCode;

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
      });
    } catch (error) {
      logger.error({ err: error, roomCode, userId }, "join_room_failed");
      fail("Failed to join room", acknowledge);
    }
  });

  // Chat rate limiting: max 5 messages per 3 seconds per socket
  const chatRateLimit = { count: 0, resetTime: Date.now() };
  const CHAT_RATE_MAX = 5;
  const CHAT_RATE_WINDOW_MS = 3000;

  // Uses socket.data.roomCode (set on join_room) to prevent cross-room spoofing.
  socket.on("send_chat_message", (data: unknown) => {
    const message = field(data, "message");
    const { userId, username } = socket.data.user;
    const roomCode = socket.data.roomCode;

    if (!roomCode) {
      return fail("Not authenticated in room");
    }
    if (typeof message !== "string") return;

    const now = Date.now();
    if (now - chatRateLimit.resetTime > CHAT_RATE_WINDOW_MS) {
      chatRateLimit.count = 0;
      chatRateLimit.resetTime = now;
    }
    chatRateLimit.count++;
    if (chatRateLimit.count > CHAT_RATE_MAX) {
      return fail("Too many messages. Slow down!");
    }

    const sanitized = sanitizeChatMessage(message);
    if (!sanitized) return;

    io.to(roomCode).emit("chat_message", {
      userId,
      username,
      message: sanitized,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("leave_room", (data: unknown) => {
    const roomCode = field(data, "roomCode");
    if (typeof roomCode !== "string") return;
    socket.leave(roomCode);
    if (socket.data.roomCode === roomCode) {
      delete socket.data.roomCode;
    }
  });

  socket.on("disconnecting", () => {
    const { userId, username } = socket.data.user;

    if (socket.data.roomCode) {
      const roomCode = socket.data.roomCode;
      const roomSocketIds = io.sockets.adapter.rooms.get(roomCode);
      const hasAnotherSocket = [...(roomSocketIds ?? [])].some(
        (socketId) =>
          socketId !== socket.id &&
          io.sockets.sockets.get(socketId)?.data.user.userId === userId,
      );
      if (hasAnotherSocket) return;

      socket.to(roomCode).emit("player_disconnected", {
        userId,
        username,
      });
    }
  });
}
