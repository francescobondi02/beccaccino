// src/controllers/gameController.ts

import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { prisma } from "../db";
import { Suit } from "@prisma/client";
import {
  playCard,
  setBriscola,
  resolveCaller,
  resolveCurrentTurnUserId,
} from "../services/gameService";
import { cumulativeScore } from "../utils/score";
import { GameError } from "../utils/gameError";
import { playableCards } from "../services/cardService";
import {
  getTurnTimerState,
  resetTimeoutCount,
  restoreBotSeats,
  startTurnTimer,
} from "../services/turnTimer";
import { logger } from "../logger";

export const chooseBriscola = async (req: Request, res: Response) => {
  const { gameRoomId, suit } = req.body;
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  // Derive playerId server-side from the authenticated userId so a user cannot
  // pass an arbitrary playerId in the request body and impersonate another player.
  const player = await prisma.player.findFirst({
    where: { gameRoomId, userId },
    select: { id: true },
  });

  if (!player) {
    return res.status(403).json({ error: "Player not in this game room" });
  }

  try {
    const result = await setBriscola({ gameRoomId, playerId: player.id, suit });
    // A real human action: this turn was not abandoned.
    resetTimeoutCount(result.roomCode, userId);
    return res.status(200).json({
      message: "Briscola set successfully",
      round: result.round,
      hand: result.hand,
    });
  } catch (error) {
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: (error as Error).message });
  }
};

export const handlePlayCard = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { roomCode, suit, value, signal } = req.body;
    await playCard({ roomCode, userId, suit, value, signal });
    // A real human action: this turn was not abandoned.
    resetTimeoutCount(roomCode, userId);
    return res.status(200).json({ message: "Card played successfully" });
  } catch (error) {
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(400).json({ error: (error as Error).message });
  }
};

export const getPlayableCards = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;

  try {
    const cards = await playableCards({ roomCode, userId });
    return res.status(200).json({ playableCards: cards });
  } catch (error) {
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error({ err: error, roomCode, userId }, "get_playable_cards_failed");
    return res.status(500).json({ error: "Failed to fetch playable cards" });
  }
};

/** Each seat's remaining cards, keyed by userId. Practice games only. */
async function revealAllHands(
  players: { userId: number; id: number; botModel: string | null }[],
  roundId: number,
) {
  const cards = await prisma.playerCard.findMany({
    where: { roundId },
    orderBy: [{ suit: "asc" }, { value: "asc" }],
  });

  return players.map((player) => ({
    userId: player.userId,
    botModel: player.botModel,
    cards: cards
      .filter((card) => card.playerId === player.id)
      .map(({ suit, value }) => ({ suit, value })),
  }));
}

export const getGameState = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;

  try {
    const gameRoom = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: {
        players: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!gameRoom) {
      return res.status(404).json({ error: "Room not found" });
    }

    const isPlayerInRoom = gameRoom.players.some((p) => p.userId === userId);
    if (!isPlayerInRoom) {
      return res.status(403).json({ error: "You are not in this room" });
    }

    if (!gameRoom.started) {
      return res.status(400).json({ error: "Game has not started yet" });
    }

    // Trova il round corrente (l'ultimo creato)
    const currentRound = await prisma.round.findFirst({
      where: { gameRoomId: gameRoom.id },
      orderBy: { number: "desc" },
    });

    if (!currentRound) {
      return res.status(404).json({ error: "No active round found" });
    }

    // Determina chi deve chiamare la briscola
    const callerPlayerId = await resolveCaller(currentRound, gameRoom.players);

    // Converti callerPlayerId in callerUserId per il frontend
    const callerPlayer = gameRoom.players.find((p) => p.id === callerPlayerId);
    const callerUserId = callerPlayer?.userId ?? null;

    // Carte del giocatore corrente per questo round
    const myPlayerRecord = gameRoom.players.find((p) => p.userId === userId);
    const myCards = myPlayerRecord
      ? await prisma.playerCard.findMany({
          where: {
            playerId: myPlayerRecord.id,
            roundId: currentRound.id,
          },
          orderBy: [{ suit: "asc" }, { value: "asc" }],
        })
      : [];

    // Determina di chi è il turno attuale
    const currentTurnUserId = await resolveCurrentTurnUserId(
      currentRound,
      gameRoom.players,
      callerUserId,
    );

    // Recupera le carte attualmente giocate (sul tavolo)
    const currentHandInProgress = await prisma.hand.findFirst({
      where: { roundId: currentRound.id, winnerId: null },
      orderBy: { number: "desc" },
      include: {
        cards: {
          orderBy: { position: "asc" },
          include: { player: { include: { user: true } } },
        },
      },
    });

    const playedCards =
      currentHandInProgress?.cards.map((card) => ({
        playerId: card.playerId,
        userId: card.player.userId,
        suit: card.suit,
        value: card.value,
        position: card.position,
      })) ?? [];

    // Recupera le carte dell'ultima mano completata (per "Ultima mano")
    const lastCompletedHand = await prisma.hand.findFirst({
      where: { roundId: currentRound.id, winnerId: { not: null } },
      orderBy: { number: "desc" },
      include: {
        cards: {
          orderBy: { position: "asc" },
          include: { player: { include: { user: true } } },
        },
      },
    });

    const lastHandCards =
      lastCompletedHand?.cards.map((card) => ({
        playerId: card.playerId,
        userId: card.player.userId,
        suit: card.suit,
        value: card.value,
        position: card.position,
      })) ?? [];

    // Calcola i punti totali sommando tutti i round completati
    const completedRounds = await prisma.round.findMany({
      where: {
        gameRoomId: gameRoom.id,
        winnerTeam: { not: null }, // Solo round completati
      },
      select: {
        team0Points: true,
        team1Points: true,
        team0Figures: true,
        team1Figures: true,
      },
    });

    const cumulative = cumulativeScore(completedRounds);
    const totalPoints = {
      team0Points: cumulative.team0.points,
      team1Points: cumulative.team1.points,
      team0Figures: cumulative.team0.figures,
      team1Figures: cumulative.team1.figures,
    };

    // Lazy timer recovery: if the server restarted mid-game, in-memory turn
    // timers are gone. The first state fetch after restart restarts a timer
    // for whoever's turn it is, so auto-play / kick-after-3-timeouts continue
    // to work without manual intervention.
    let timerState = getTurnTimerState(roomCode);
    if (!timerState && !gameRoom.finished && currentTurnUserId !== null) {
      const phase: "play_card" | "choose_briscola" =
        currentRound.briscola === null ? "choose_briscola" : "play_card";
      logger.info(
        { roomCode, currentTurnUserId, phase },
        "turn_timer_recovered_after_restart",
      );
      // The bot registry is in-memory too, so restore it from the persisted
      // botModel columns before re-arming — otherwise a recovered practice game
      // would treat its bot seats as humans and stall until they time out.
      restoreBotSeats(roomCode, gameRoom.players);
      startTurnTimer(roomCode, currentTurnUserId, phase);
      timerState = getTurnTimerState(roomCode);
    }

    // Practice-only: every seat's remaining cards, so a human can check whether a
    // bot's "volo" was honest (genuinely void) or its "striscio" backed by real
    // strength. Gated on isPractice SERVER-side — a client-only toggle would leak
    // opponents' hands into real multiplayer.
    const allHands = gameRoom.isPractice
      ? await revealAllHands(gameRoom.players, currentRound.id)
      : null;

    return res.status(200).json({
      round: {
        id: currentRound.id,
        number: currentRound.number,
        briscola: currentRound.briscola,
        cricca: currentRound.cricca,
      },
      currentHandNumber: currentHandInProgress?.number ?? null,
      callerUserId,
      myCards,
      currentTurnUserId,
      playedCards,
      lastHandCards,
      totalPoints,
      turnTimer: timerState,
      isPractice: gameRoom.isPractice,
      allHands,
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: { op: "get_game_state", roomCode, userId },
    });
    logger.error({ err: error, roomCode, userId }, "get_game_state_failed");
    return res.status(500).json({ error: "Failed to fetch game state" });
  }
};
