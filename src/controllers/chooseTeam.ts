// src/controllers/chooseTeam.ts

import { Request, Response } from "express";
import { prisma } from "../db";
import { getSocketInstance } from "../socketInstance";

export const chooseTeam = async (req: Request, res: Response) => {
  /**
   * Permette a un player di scegliere una squadra (0 o 1) in una stanza di gioco.
   * Ogni squadra deve avere 2 giocatori per iniziare la partita.
   *
   * @param roomCode Codice della stanza di gioco (dal parametro URL)
   * @param userId ID dell'utente che sceglie la squadra (dal body della richiesta)
   * @param team Squadra scelta (0 o 1) (dal body della richiesta)
   * @return void
   *
   * @note Controlla che la squadra non sia già piena (2 giocatori per squadra)
   * @note Controlla che l'utente sia effettivamente un player nella stanza
   */
  const { roomCode } = req.params;
  const { userId, team } = req.body;

  //^ Controlla che il team sia valido (0 o 1)
  if (![0, 1].includes(team)) {
    return res.status(400).json({ error: "Invalid team selection" });
  }

  try {
    //^ Cerca la stanza attuale
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    if (!room) return res.status(404).json({ error: "Room not found" });

    //^ Controlla se l'utente è un player nella stanza attuale
    const player = room.players.find((p) => p.userId === userId);
    if (!player) {
      return res
        .status(403)
        .json({ error: "User is not a player in this room" });
    }

    if (player.isReady) {
      return res
        .status(400)
        .json({ error: "Non puoi cambiare team dopo esserti messo pronto" });
    }

    //^ Controlla che la squadra non sia già piena (2 player)
    const teamCount = room.players.filter((p) => p.team === team).length;
    if (teamCount >= 2) {
      return res.status(400).json({ error: "Team is already full" });
    }

    //^ Aggiorna la squadra del giocatore
    const updatedPlayer = await prisma.player.update({
      where: { id: player.id },
      data: { team },
    });

    //^ Usa il socket per notificare gli altri giocatori nella stanza
    const io = getSocketInstance();
    io.to(roomCode).emit("team_chosen", {
      userId,
      team,
    });

    return res.status(200).json({ success: true, player: updatedPlayer });
  } catch (error) {
    console.error("Error choosing team:", error);
    return res.status(500).json({ error: "Failed to choose team" });
  }
};
