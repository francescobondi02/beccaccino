// src/services/gameService.ts
// This file can be used to implement game-related business logic
// that can be reused across different controllers or parts of the application.

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

function generateDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of Object.values(Suit)) {
    for (const value of Object.values(Value)) {
      deck.push({ suit, value });
    }
  }
  return deck;
}

function shuffleDeck<T>(deck: T[]): T[] {
  return [...deck].sort(() => Math.random() - 0.5);
}

export async function setupRound(gameRoomId: number, roundNumber: number) {
  // Prendi i player nella room
  const players = await prisma.player.findMany({
    where: { gameRoomId },
    orderBy: { seat: "asc" },
  });

  if (players.length !== 4) {
    throw new Error("There must be exactly 4 players to start the game");
  }

  // Gestisci i seats
  const team0 = players.filter((p) => p.team === 0);
  const team1 = players.filter((p) => p.team === 1);
  if (team0.length !== 2 || team1.length !== 2) {
    throw new Error("Teams must be complete with 2 players each");
  }

  const seatAssignments = [
    team0[0], // Seat 0
    team1[0], // Seat 1
    team0[1], // Seat 2
    team1[1], // Seat 3
  ];

  for (let seat = 0; seat < 4; seat++) {
    await prisma.player.update({
      where: { id: seatAssignments[seat].id },
      data: { seat },
    });
  }

  // Pre. Trova il round precedente
  const previousRound = await prisma.round.findFirst({
    where: { gameRoomId, number: roundNumber - 1 },
    include: { hands: { orderBy: { number: "asc" } } },
  });

  const newRoundNumber = previousRound ? previousRound.number + 1 : 1;

  let starterId: number;

  // 1. Crea il round
  const round = await prisma.round.create({
    data: {
      number: newRoundNumber,
      briscola: null,
      gameRoomId: gameRoomId,
    },
  });

  // 2. Genera e mescola il mazzo
  const deck = shuffleDeck(generateDeck());

  // 3. Distribuisci le carte (10 a testa, random)
  const cardsPerPlayer = 10;
  let playerWithQuattroDenara: number | null = null;
  for (let i = 0; i < players.length; i++) {
    const playerId = players[i].id;
    const handCards = deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer);

    // Trova il player con il 4 di Denara
    if (
      handCards.some(
        (card) => card.suit === Suit.denara && card.value === Value.quattro
      )
    ) {
      playerWithQuattroDenara = playerId;
    }

    await prisma.playerCard.createMany({
      data: handCards.map((card) => ({
        playerId: playerId,
        suit: card.suit,
        value: card.value,
        roundId: round.id,
      })),
    });
  }

  if (newRoundNumber === 1) {
    // Primo round, chi ha il 4 di Denara in mano inizia
    starterId = playerWithQuattroDenara!;

    // Creo la prima mano
    await prisma.hand.create({
      data: {
        roundId: round.id,
        number: 1,
        starterId: starterId, // Chi inizia è chi ha il 4 di Denara
      },
    });
  } else {
    // Nei round successivi, cambia chiamante //! DA CAPIRE
    let lastStarterId = previousRound!.hands[0].starterId;
    // Ora computa il nuovo starterId, facendo rotazione antiorario fra i player
    const lastStarterPlayer = players.find((p) => p.id === lastStarterId);
    if (!lastStarterPlayer || lastStarterPlayer.seat === null) {
      throw new Error("Invalid previous starter or seat not assigned");
    }
    const lastSeat = lastStarterPlayer.seat;
    const newStarterSeat = (lastSeat + 1) % 4;

    const newStarter = players.find((p) => p.seat === newStarterSeat);
    if (!newStarter) {
      throw new Error("New starter not found");
    }
    const starterId = newStarter.id;

    await prisma.hand.create({
      data: {
        roundId: round.id,
        number: 1,
        starterId: starterId, // Nuovo starter computato
      },
    });
  }

  //* Qui dovresti notificare tramite websocket il player che deve scegliere briscola
}

export async function playCard({
  roomCode,
  userId,
  suit,
  value,
}: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
}) {
  // 1. Trova la room
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

  if (!room || !room.started)
    throw new Error("Room not found or game not started");

  const currentRound = room.rounds[0];
  const currentHand = currentRound?.hands[0];
  if (!currentRound || !currentHand)
    throw new Error("No active round or hand found");

  const playedCards = currentHand.cards;

  // 2. Controlla che la mano non sia piena
  if (playedCards.length >= 4) {
    throw new Error("Hand is already full");
  }

  // 3. Determina l'ordine di gioco a partire da starterId
  const order = [1, 2, 3, 4]; //! DA SISTEMARE
  const currentTurnPlayerId = order[playedCards.length];
  if (currentTurnPlayerId !== userId)
    throw new Error("It's not this player's turn");

  // 4. Controlla che il giocatore abbia la carta
  const player = room.players.find((p) => p.userId === userId);
  if (!player) throw new Error("Player not found in this room");

  const playerCard = await prisma.playerCard.findFirst({
    where: {
      playerId: player.id,
      suit,
      value,
    },
  });

  if (!playerCard) throw new Error("Player does not have this card");

  // 5. Rimuovi la carta dalla mano del giocatore e aggiungila alle carte giocate
  await prisma.playerCard.delete({
    where: {
      id: playerCard.id,
    },
  });

  const played = await prisma.playedCard.create({
    data: {
      handId: currentHand.id,
      playerId: player.id,
      suit,
      value,
      position: playedCards.length,
    },
  });

  //* NOTIFICA TRAMITE WEBSOCKET LA CARTA GIOCATA CON SUCCESSO

  // Ora dobbiamo controllare se la mano è completa e gestire il turno successivo
  // Lo facciamo ma aspettando qualche secondo
  if (playedCards.length + 1 === 4) {
    // Era l'ultimo della mano
    setTimeout(async () => {
      const winnerPlayerId = determineHandWinner(
        [...playedCards, played],
        currentRound.briscola
      );

      await prisma.hand.update({
        where: { id: currentHand.id },
        data: {
          winnerId: winnerPlayerId,
        },
      });

      if (currentHand.number < 10) {
        const newHand = await prisma.hand.create({
          data: {
            roundId: currentRound.id,
            number: currentHand.number + 1,
            starterId: winnerPlayerId, // La nuova mano parte da chi ha preso quella prima
          },
        });

        //* NOTIFICA TRAMITE WEBSOCKET I GIOCATORI CHE INIZIA LA NUOVA MANO E CHI PARTE
      } else {
        // Era l'ultima mano del round

        // Bisogna creare un nuovo round
        const newRound = await prisma.round.create({
          data: {
            number: currentRound.number + 1,
            briscola: null,
            gameRoomId: room.id,
          },
        });
        //* NOTIFICA TRAMITE WEBSOCKET CHE IL ROUND E' FINITO E SI DEVE PARTIRE CON IL PROSSIMO (DI PIù DI COSì)
      }
    }, 5000);
  }
}
