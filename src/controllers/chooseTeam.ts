// src/controllers/chooseTeam.ts

import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { getSocketInstance } from "../socketInstance";
import { logger } from "../logger";
import { chooseTeamCommand } from "../services/roomCommands";
import { GameError } from "../utils/gameError";

export const chooseTeam = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;
  const { team } = req.body;

  try {
    const result = await chooseTeamCommand({ roomCode, userId, team });
    if (result.changed) {
      getSocketInstance().to(roomCode).emit("team_chosen", {
        userId,
        playerId: result.player.id,
        team,
      });
    }

    return res.status(200).json({ success: true, player: result.player });
  } catch (error) {
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
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
