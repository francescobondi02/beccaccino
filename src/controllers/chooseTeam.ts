// src/controllers/chooseTeam.ts

import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { prisma } from "../db";
import { getSocketInstance } from "../socketInstance";
import { logger } from "../logger";
import { withRoomLock } from "../utils/roomLock";

export const chooseTeam = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;
  const { team } = req.body;

  //^ Controlla che il team sia valido (0 o 1)
  if (![0, 1].includes(team)) {
    return res.status(400).json({ error: "Invalid team selection" });
  }

  try {
    const result = await withRoomLock(roomCode, async () => {
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      if (!room) {
        return { status: 404, body: { error: "Room not found" } };
      }

      const player = room.players.find(
        (candidate) => candidate.userId === userId,
      );
      if (!player) {
        return {
          status: 403,
          body: { error: "User is not a player in this room" },
        };
      }

      if (player.team === team) {
        return {
          status: 200,
          body: { success: true, player },
        };
      }

      if (room.started) {
        return {
          status: 409,
          body: { error: "Cannot change team after the game has started" },
        };
      }

      if (player.isReady) {
        return {
          status: 400,
          body: {
            error: "Non puoi cambiare team dopo esserti messo pronto",
          },
        };
      }

      const teamCount = room.players.filter(
        (candidate) => candidate.team === team,
      ).length;
      if (teamCount >= 2) {
        return { status: 400, body: { error: "Team is already full" } };
      }

      const updatedPlayer = await prisma.player.update({
        where: { id: player.id },
        data: { team },
      });

      getSocketInstance().to(roomCode).emit("team_chosen", {
        userId,
        team,
      });

      return {
        status: 200,
        body: { success: true, player: updatedPlayer },
      };
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    Sentry.captureException(error, {
      extra: { op: "choose_team", roomCode, userId, team },
    });
    (req.log ?? logger).error(
      { err: error, roomCode, userId, team },
      "choose_team_failed",
    );
    return res.status(500).json({ error: "Failed to choose team" });
  }
};
