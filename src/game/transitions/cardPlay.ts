import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { computePoints } from "../../domain/game/computePoints";
import { determineHandWinner } from "../../domain/game/determineHandWinner";
import { isLegalCard } from "../../domain/game/legalCards";
import { cumulativeScore, decideGameWinner } from "../../domain/game/score";
import { resolveTurnSeat } from "../../domain/game/turnOrder";
import { CardSignal, Suit, Value } from "../../domain/game/cards";
import { GAME_WIN_POINTS } from "../../gameConfig";
import { logger } from "../../logger";
import { GameError } from "../../utils/gameError";
import { withRoomLock } from "../../utils/roomLock";
import {
  claimPracticeTransition,
  logRoundSetup,
  PracticeTurnCancelledError,
  setupRound,
} from "./round";
import { GameEvent, TransitionOutcome } from "./types";

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

function playedCardEvent(args: {
  roomCode: string;
  userId: number;
  playerId: number;
  suit: Suit;
  value: Value;
  position: number;
  handNumber: number;
  roundNumber: number;
  signal: PlayedCardInput["signal"];
}): GameEvent {
  return {
    target: args.roomCode,
    event: "card_played",
    payload: {
      playerId: args.playerId,
      userId: args.userId,
      suit: args.suit,
      value: args.value,
      position: args.position,
      handNumber: args.handNumber,
      signal: args.signal,
    },
  };
}

export async function playCard(args: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
  signal?: CardSignal | null;
  autoPlayed?: boolean;
  expectedPauseEpoch?: number;
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
}: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
  signal?: CardSignal | null;
  autoPlayed?: boolean;
  expectedPauseEpoch?: number;
}): Promise<TransitionOutcome<void>> {
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
  const cardEvent = playedCardEvent({
    roomCode,
    userId,
    playerId: player.id,
    suit,
    value,
    position,
    handNumber: currentHand.number,
    roundNumber: currentRound.number,
    signal: validSignal,
  });

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
    return {
      value: undefined,
      runtime: nextPlayer
        ? {
            kind: "schedule",
            roomCode,
            userId: nextPlayer.userId,
            phase: "play_card",
            pauseEpoch: room.pauseEpoch,
          }
        : null,
      events: [cardEvent],
    };
  }

  const winnerPlayerId = determineHandWinner(
    [...playedCards, playedCardData],
    currentRound.briscola,
  );

  if (currentHand.number < 10) {
    await prisma.$transaction(async (tx) => {
      await claimPracticeTransition(tx, room, expectedPauseEpoch);
      await persistPlayedCard(tx, playerCard.id, playedCardData);
      await tx.hand.update({
        where: { id: currentHand.id },
        data: { winnerId: winnerPlayerId },
      });
      await tx.hand.create({
        data: {
          roundId: currentRound.id,
          number: currentHand.number + 1,
          starterId: winnerPlayerId,
        },
      });
    });
    logger.info({ roomCode, userId, suit, value, position }, "card_played");

    const winnerPlayer = room.players.find(
      (candidate) => candidate.id === winnerPlayerId,
    );
    return {
      value: undefined,
      runtime: winnerPlayer
        ? {
            kind: "schedule",
            roomCode,
            userId: winnerPlayer.userId,
            phase: "play_card",
            pauseEpoch: room.pauseEpoch,
          }
        : null,
      events: [cardEvent],
    };
  }

  const allHands = await prisma.hand.findMany({
    where: { roundId: currentRound.id },
    orderBy: { number: "asc" },
    include: { cards: { orderBy: { position: "asc" } } },
  });
  const teamPlayers: Record<number, number> = {};
  for (const roomPlayer of room.players) {
    if (roomPlayer.team !== null) {
      teamPlayers[roomPlayer.id] = roomPlayer.team;
    }
  }

  const scores = computePoints(
    allHands.map((hand) => ({
      winnerId:
        hand.id === currentHand.id ? winnerPlayerId : hand.winnerId,
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
    teamPlayers,
    currentRound.briscola!,
  );

  if (currentRound.cricca) {
    const callerTeam = teamPlayers[allHands[0].starterId];
    if (callerTeam === 0) scores.team0.points += 3;
    if (callerTeam === 1) scores.team1.points += 3;
  }

  let winnerTeam: number;
  if (scores.team0.points !== scores.team1.points) {
    winnerTeam = scores.team0.points > scores.team1.points ? 0 : 1;
  } else if (scores.team0.figures !== scores.team1.figures) {
    winnerTeam = scores.team0.figures > scores.team1.figures ? 0 : 1;
  } else {
    winnerTeam = 0;
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
      team0Points: scores.team0.points,
      team1Points: scores.team1.points,
      team0Figures: scores.team0.figures,
      team1Figures: scores.team1.figures,
      winnerTeam,
    },
  ];
  const total = cumulativeScore(allCompletedRounds);
  const callerTeam = teamPlayers[allHands[0].starterId];
  if (callerTeam !== 0 && callerTeam !== 1) {
    throw new Error("Round caller has no valid team");
  }
  const finalWinnerTeam = decideGameWinner(
    total,
    GAME_WIN_POINTS,
    callerTeam,
  );

  const nextRound = await prisma.$transaction(async (tx) => {
    await claimPracticeTransition(tx, room, expectedPauseEpoch);
    await persistPlayedCard(tx, playerCard.id, playedCardData);
    await tx.hand.update({
      where: { id: currentHand.id },
      data: { winnerId: winnerPlayerId },
    });
    await tx.round.update({
      where: { id: currentRound.id },
      data: {
        team0Points: scores.team0.points,
        team1Points: scores.team1.points,
        team0Figures: scores.team0.figures,
        team1Figures: scores.team1.figures,
        winnerTeam,
      },
    });
    if (finalWinnerTeam !== null) {
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
        team0: scores.team0,
        team1: scores.team1,
        winnerTeam,
        cricca: currentRound.cricca,
      },
    },
  ];
  logger.info(
    {
      roomCode,
      roundNumber: currentRound.number,
      team0Points: scores.team0.points,
      team1Points: scores.team1.points,
      team0Figures: scores.team0.figures,
      team1Figures: scores.team1.figures,
      winnerTeam,
      cricca: currentRound.cricca,
    },
    "round_ended",
  );

  if (finalWinnerTeam !== null) {
    const totalRounds = allCompletedRounds.length;
    const team0Wins = allCompletedRounds.filter(
      (round) => round.winnerTeam === 0,
    ).length;
    events.push({
      target: roomCode,
      event: "game_finished",
      payload: {
        winnerTeam: finalWinnerTeam,
        totalRounds,
        finalScores: {
          team0: total.team0.points,
          team1: total.team1.points,
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
        winnerTeam: finalWinnerTeam,
        totalRounds,
        totalTeam0Points: total.team0.points,
        totalTeam1Points: total.team1.points,
      },
      "game_finished",
    );
    return {
      value: undefined,
      runtime: { kind: "clear", roomCode },
      events,
    };
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
  return {
    value: undefined,
    runtime: newCaller
      ? {
          kind: "schedule",
          roomCode,
          userId: newCaller.userId,
          phase: "choose_briscola",
          pauseEpoch: room.pauseEpoch,
        }
      : null,
    events,
  };
}
