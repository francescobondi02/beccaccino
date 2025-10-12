// src/services/cardService.ts

import { prisma } from "../db";
import { determineHandWinner } from "../utils/determineHandWinner";

enum Suit {
  denara = "denara",
  spade = "spade",
  coppe = "coppe",
  bastoni = "bastoni",
}
enum Value {
  asso = "asso",
  due = "due",
  tre = "tre",
  quattro = "quattro",
  cinque = "cinque",
  sei = "sei",
  sette = "sette",
  fante = "fante",
  cavallo = "cavallo",
  re = "re",
}

type Card = {
  suit: Suit;
  value: Value;
};

export async function playableCards({
  roomCode,
  userId,
}: {
  roomCode: string;
  userId: number;
}) {
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
            include: { cards: true },
          },
        },
      },
    },
  });

  if (!room || room.started === false) {
    throw new Error("Game room not found or not started");
  }

  const currentRound = room.rounds[0];
  const currentHand = currentRound?.hands[0];
  const player = room.players.find((p) => p.userId === userId);
  if (!player) {
    throw new Error("Player not in this game room");
  }
  const cardsInHand = await prisma.playerCard.findMany({
    where: {
      playerId: player.id,
      roundId: currentRound.id,
    },
  });
  const alreadyPlayed = currentHand.cards;

  if (alreadyPlayed.length === 0) {
    return cardsInHand; //^ Posso giocare qualsiasi carta, sono il primo giocatore
  }

  const seedToFollow = alreadyPlayed[0].suit;
  const matchingCards = cardsInHand.filter(
    (card) => card.suit === seedToFollow
  );

  return matchingCards.length > 0 ? matchingCards : cardsInHand; //^ Se ho carte del seme da seguire, le gioco, altrimenti posso giocare qualsiasi carta
}
