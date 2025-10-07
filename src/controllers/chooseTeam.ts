// src/controllers/chooseTeam.ts

import { Request, Response } from "express";
import { prisma } from "../db";

export const chooseTeam = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const { userId, team } = req.body;

  if (![0, 1].includes(team)) {
    return res.status(400).json({ error: "Invalid team selection" });
  }

  try {
    // Find the room
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    if (!room) return res.status(404).json({ error: "Room not found" });

    // Check if user is a player in the room
    const player = room.players.find((p) => p.userId === userId);
    if (!player) {
      return res
        .status(403)
        .json({ error: "User is not a player in this room" });
    }

    // Controlla che la squadra non sia già piena (2 player)
    const teamCount = room.players.filter((p) => p.team === team).length;
    if (teamCount >= 2) {
      return res.status(400).json({ error: "Team is already full" });
    }

    // Update the player's team
    const updatedPlayer = await prisma.player.update({
      where: { id: player.id },
      data: { team },
    });

    return res.status(200).json({ success: true, player: updatedPlayer });
  } catch (error) {
    console.error("Error choosing team:", error);
    return res.status(500).json({ error: "Failed to choose team" });
  }
};
