import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { computeRoundScore } from "../../domain/game/roundScore";
import { determineTrickWinner } from "../../domain/game/trickWinner";
import { isLegalCard } from "../../domain/game/legalCards";
import { sumRoundScores, decideGameWinner } from "../../domain/game/gameScore";
import { resolveTurnSeat } from "../../domain/game/turnOrder";
import { CardSignal, Suit, Value } from "../../domain/game/cards";
import { GAME_WIN_POINTS, TRICK_DISPLAY_MS, roundDealPresentation } from "../../gameConfig";
import { logger } from "../../logger";
import { GameEvent, publishEvents } from "../../runtime/eventPublisher";
import {
  clearRuntimeRoom,
  startRuntimeTurn,
} from "../../runtime/turnRuntime";
import { GameError } from "../../utils/gameError";
import { withRoomLock } from "../../utils/roomLock";
import {
  claimPracticeTransition,
  logRoundSetup,
  PracticeTurnCancelledError,
  RuntimeTurnCancelledError,
  setupRound,
} from "./round";
import {
  isSameTurn,
  TurnIdentity,
} from "../turn";

type PlayedCardInput = {
  handId: number;
  playerId: number;
  suit: Suit;
  value: Value;
  position: number;
  signal: CardSignal | null;
  autoPlayed: boolean;
};

async function persistPlayedCard(
  tx: Prisma.TransactionClient,
  playerCardId: number,
  data: PlayedCardInput,
) {
  await tx.playerCard.delete({ where: { id: playerCardId } });
  return tx.playedCard.create({ data });
}

export async function playCard(args: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
  signal?: CardSignal | null;
  autoPlayed?: boolean;
  expectedPauseEpoch?: number;
  expectedTurn?: TurnIdentity;
}) {
  return withRoomLock(args.roomCode, () => playCardUnlocked(args));
}

async function playCardUnlocked({
  roomCode,
  userId,
  suit,
  value,
  signal,
  autoPlayed = false,
  expectedPauseEpoch,
  expectedTurn,
}: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
  signal?: CardSignal | null;
  autoPlayed?: boolean;
  expectedPauseEpoch?: number;
  expectedTurn?: TurnIdentity;
}): Promise<void> {
  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: true,
      rounds: {
        orderBy: { number: "desc" },
        take: 1,
        include: {
          hands: {
            orderBy: { number: "desc" },
            take: 1,
            include: { cards: { orderBy: { position: "asc" } } },
          },
        },
      },
    },
  });

  if (!room || !room.started) {
    throw new GameError("Room not found or game not started", 404);
  }
  if (room.finished) throw new GameError("Game is already finished", 400);

  const player = room.players.find((candidate) => candidate.userId === userId);
  if (!player) throw new GameError("It's not this player's turn", 403);
  if (room.pausedAt) throw new PracticeTurnCancelledError();

  const currentRound = room.rounds[0];
  const currentHand = currentRound?.hands[0];
  if (!currentRound || !currentHand) {
    throw new GameError("No active round or hand found", 400);
  }

  const playedCards = currentHand.cards;
  if (playedCards.length >= 4) {
    throw new GameError("Hand is already full", 400);
  }
  if (
    expectedTurn &&
    !isSameTurn(expectedTurn, {
      roundId: currentRound.id,
      handId: currentHand.id,
      playedCardCount: playedCards.length,
    })
  ) {
    throw new RuntimeTurnCancelledError();
  }

  const starterSeat =
    room.players.find((candidate) => candidate.id === currentHand.starterId)
      ?.seat ?? null;
  const currentTurnSeat =
    starterSeat === null
      ? null
      : resolveTurnSeat({
          briscolaChosen: true,
          callerSeat: null,
          hand: {
            starterSeat,
            playedCardCount: playedCards.length,
            winnerSeat: null,
          },
        });
  const currentTurnPlayer = room.players.find(
    (candidate) => candidate.seat === currentTurnSeat,
  );
  if (!currentTurnPlayer || currentTurnPlayer.userId !== userId) {
    throw new GameError("It's not this player's turn", 403);
  }

  const cardsInHand = await prisma.playerCard.findMany({
    where: {
      playerId: player.id,
      roundId: currentRound.id,
    },
  });
  const playerCard = cardsInHand.find(
    (card) => card.suit === suit && card.value === value,
  );
  if (!playerCard) throw new GameError("Player does not have this card", 400);

  const leadCard = playedCards.find((card) => card.position === 0);
  if (!isLegalCard(cardsInHand, playerCard, leadCard?.suit ?? null)) {
    throw new GameError("Player must follow suit", 400);
  }

  const validSignal =
    playedCards.length === 0 && signal ? signal : null;
  const position = playedCards.length;
  const playedCardData: PlayedCardInput = {
    handId: currentHand.id,
    playerId: player.id,
    suit,
    value,
    position,
    signal: validSignal,
    autoPlayed,
  };
  const cardEvent: GameEvent = {
    target: roomCode,
    event: "card_played",
    payload: {
      userId,
      playerId: player.id,
      suit,
      value,
      position,
      handNumber: currentHand.number,
      signal: validSignal,
    },
  };

  if (position < 3) {
    await prisma.$transaction(async (tx) => {
      await claimPracticeTransition(tx, room, expectedPauseEpoch);
      await persistPlayedCard(tx, playerCard.id, playedCardData);
    });
    logger.info({ roomCode, userId, suit, value, position }, "card_played");

    const nextTurnSeat = resolveTurnSeat({
      briscolaChosen: true,
      callerSeat: null,
      hand: {
        starterSeat: starterSeat!,
        playedCardCount: position + 1,
        winnerSeat: null,
      },
    });
    const nextPlayer = room.players.find(
      (candidate) => candidate.seat === nextTurnSeat,
    );
    if (nextPlayer) {
      startRuntimeTurn(
        roomCode,
        nextPlayer.userId,
        "play_card",
        room.pauseEpoch,
        {
          roundId: currentRound.id,
          handId: currentHand.id,
          playedCardCount: position + 1,
        },
      );
    }
    publishEvents([cardEvent]);
    return;
  }

  const trickWinnerPlayerId = determineTrickWinner(
    [...playedCards, playedCardData],
    currentRound.briscola,
  );

  if (currentHand.number < 10) {
    const nextHand = await prisma.$transaction(async (tx) => {
      await claimPracticeTransition(tx, room, expectedPauseEpoch);
      await persistPlayedCard(tx, playerCard.id, playedCardData);
      await tx.hand.update({
        where: { id: currentHand.id },
        data: { winnerId: trickWinnerPlayerId },
      });
      return tx.hand.create({
        data: {
          roundId: currentRound.id,
          number: currentHand.number + 1,
          starterId: trickWinnerPlayerId,
        },
      });
    });
    logger.info({ roomCode, userId, suit, value, position }, "card_played");

    const winnerPlayer = room.players.find(
      (candidate) => candidate.id === trickWinnerPlayerId,
    );
    if (winnerPlayer) {
      startRuntimeTurn(
        roomCode,
        winnerPlayer.userId,
        "play_card",
        room.pauseEpoch,
        {
          roundId: currentRound.id,
          handId: nextHand.id,
          playedCardCount: 0,
        },
        TRICK_DISPLAY_MS,
      );
    }
    publishEvents([cardEvent]);
    return;
  }

  const allHands = await prisma.hand.findMany({
    where: { roundId: currentRound.id },
    orderBy: { number: "asc" },
    include: { cards: { orderBy: { position: "asc" } } },
  });
  const playerTeams: Record<number, number> = {};
  for (const roomPlayer of room.players) {
    if (roomPlayer.team !== null) {
      playerTeams[roomPlayer.id] = roomPlayer.team;
    }
  }

  const roundScore = computeRoundScore(
    allHands.map((hand) => ({
      winnerId:
        hand.id === currentHand.id ? trickWinnerPlayerId : hand.winnerId,
      cards: [
        ...hand.cards.map((card) => ({
          value: card.value,
          suit: card.suit,
          playerId: card.playerId,
        })),
        ...(hand.id === currentHand.id
          ? [{ value, suit, playerId: player.id }]
          : []),
      ],
    })),
    playerTeams,
    currentRound.briscola!,
  );

  if (currentRound.cricca) {
    const callerTeam = playerTeams[allHands[0].starterId];
    if (callerTeam === 0) roundScore.team0.points += 3;
    if (callerTeam === 1) roundScore.team1.points += 3;
  }

  let roundWinnerTeam: number;
  if (roundScore.team0.points !== roundScore.team1.points) {
    roundWinnerTeam = roundScore.team0.points > roundScore.team1.points ? 0 : 1;
  } else if (roundScore.team0.figures !== roundScore.team1.figures) {
    roundWinnerTeam = roundScore.team0.figures > roundScore.team1.figures ? 0 : 1;
  } else {
    roundWinnerTeam = 0;
  }

  const previousCompletedRounds = await prisma.round.findMany({
    where: {
      gameRoomId: room.id,
      id: { not: currentRound.id },
      winnerTeam: { not: null },
    },
    select: {
      team0Points: true,
      team1Points: true,
      team0Figures: true,
      team1Figures: true,
      winnerTeam: true,
    },
  });
  const allCompletedRounds = [
    ...previousCompletedRounds,
    {
      team0Points: roundScore.team0.points,
      team1Points: roundScore.team1.points,
      team0Figures: roundScore.team0.figures,
      team1Figures: roundScore.team1.figures,
      winnerTeam: roundWinnerTeam,
    },
  ];
  const gameScore = sumRoundScores(allCompletedRounds);
  const callerTeam = playerTeams[allHands[0].starterId];
  if (callerTeam !== 0 && callerTeam !== 1) {
    throw new Error("Round caller has no valid team");
  }
  const gameWinnerTeam = decideGameWinner(
    gameScore,
    GAME_WIN_POINTS,
    callerTeam,
  );

  const nextRound = await prisma.$transaction(async (tx) => {
    await claimPracticeTransition(tx, room, expectedPauseEpoch);
    await persistPlayedCard(tx, playerCard.id, playedCardData);
    await tx.hand.update({
      where: { id: currentHand.id },
      data: { winnerId: trickWinnerPlayerId },
    });
    await tx.round.update({
      where: { id: currentRound.id },
      data: {
        team0Points: roundScore.team0.points,
        team1Points: roundScore.team1.points,
        team0Figures: roundScore.team0.figures,
        team1Figures: roundScore.team1.figures,
        winnerTeam: roundWinnerTeam,
      },
    });
    if (gameWinnerTeam !== null) {
      await tx.gameRoom.update({
        where: { id: room.id },
        data: { finished: true },
      });
      return null;
    }
    return setupRound(room.id, currentRound.number + 1, tx);
  });

  if (nextRound) logRoundSetup(nextRound);
  logger.info({ roomCode, userId, suit, value, position }, "card_played");
  const events: GameEvent[] = [
    cardEvent,
    {
      target: roomCode,
      event: "round_ended",
      payload: {
        roundNumber: currentRound.number,
        team0: roundScore.team0,
        team1: roundScore.team1,
        winnerTeam: roundWinnerTeam,
        cricca: currentRound.cricca,
      },
    },
  ];
  logger.info(
    {
      roomCode,
      roundNumber: currentRound.number,
      team0Points: roundScore.team0.points,
      team1Points: roundScore.team1.points,
      team0Figures: roundScore.team0.figures,
      team1Figures: roundScore.team1.figures,
      winnerTeam: roundWinnerTeam,
      cricca: currentRound.cricca,
    },
    "round_ended",
  );

  if (gameWinnerTeam !== null) {
    const totalRounds = allCompletedRounds.length;
    const team0Wins = allCompletedRounds.filter(
      (round) => round.winnerTeam === 0,
    ).length;
    events.push({
      target: roomCode,
      event: "game_finished",
      payload: {
        winnerTeam: gameWinnerTeam,
        totalRounds,
        finalScores: {
          team0: gameScore.team0.points,
          team1: gameScore.team1.points,
        },
        roundsWon: {
          team0: team0Wins,
          team1: totalRounds - team0Wins,
        },
      },
    });
    logger.info(
      {
        roomCode,
        winnerTeam: gameWinnerTeam,
        totalRounds,
        totalTeam0Points: gameScore.team0.points,
        totalTeam1Points: gameScore.team1.points,
      },
      "game_finished",
    );
    clearRuntimeRoom(roomCode);
    publishEvents(events);
    return;
  }

  const newCaller = room.players.find(
    (candidate) => candidate.id === nextRound!.callerPlayerId,
  );
  events.push({
    target: roomCode,
    event: "new_round_started",
    payload: {
      roundId: nextRound!.roundId,
      roundNumber: nextRound!.roundNumber,
      callerUserId: newCaller?.userId ?? null,
    },
  });
  if (newCaller) {
    startRuntimeTurn(
      roomCode,
      newCaller.userId,
      "choose_briscola",
      room.pauseEpoch,
      {
        roundId: nextRound!.roundId,
        handId: null,
        playedCardCount: 0,
      },
      roundDealPresentation({
        number: nextRound!.roundNumber,
        createdAt: nextRound!.createdAt,
      }).remainingMs,
    );
  }
  publishEvents(events);
}
