// src/controllers/chooseTeam.ts

import { Request, Response } from "express";
import { chooseTeamCommand } from "../services/multiplayerRoomCommands";
import { parseRoomCode, parseTeam } from "../http/input/rooms";
import { requireUser } from "../http/request";
import { publishEvent } from "../runtime/eventPublisher";

export const chooseTeam = async (req: Request, res: Response) => {
  const roomCode = parseRoomCode(req.params.roomCode);
  const { userId } = requireUser(req);
  const team = parseTeam(req.body);

  const result = await chooseTeamCommand({ roomCode, userId, team });
  if (result.changed) {
    publishEvent(
      roomCode,
      "team_chosen",
      {
        userId,
        playerId: result.player.id,
        team,
      },
      { userId },
    );
  }

  return res.status(200).json({ success: true, player: result.player });
};
