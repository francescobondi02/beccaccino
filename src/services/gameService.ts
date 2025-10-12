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
  /**
   * Genera un mazzo di 40 carte italiane (romagnole, sono le migliori).
   *
   * @return Array di carte ({ suit: Suit, value: Value }[])
   */
  const deck: Card[] = [];

  for (const suit of Object.values(Suit)) {
    for (const value of Object.values(Value)) {
      deck.push({ suit, value });
    }
  }
  return deck;
}

function shuffleDeck<T>(deck: T[]): T[] {
  /**
   * Mescola un array di elementi (carte).
   *
   * @param deck Array di elementi da mescolare
   * @return Array mescolato
   *
   * @note Questo è un metodo di mescolamento semplice e non perfetto.
   *       Per un'applicazione reale, considera l'uso di un algoritmo di Fisher-Yates.
   */
  return [...deck].sort(() => Math.random() - 0.5);
}

export async function setupRound(gameRoomId: number, roundNumber: number) {
  /**
   * Funzione che fa il setup di un round di gioco.
   *
   * @note Se è il primo round, chi ha il 4 di Denara in mano sceglie la briscola e inizia lui la prima mano.
   * Se non è il primo round, lo starter è il giocatore alla sinistra di chi ha iniziato prima.
   *
   * @param gameRoomId ID della room di gioco
   * @param roundNumber Numero del round (1, 2, 3, ...)
   * @return void
   *
   */

  //^ Prendi i player nella room (usando gameRoomId)
  const players = await prisma.player.findMany({
    where: { gameRoomId },
    orderBy: { seat: "asc" },
  });

  if (players.length !== 4) {
    throw new Error("There must be exactly 4 players to start the game");
  }

  //^ Assegna i posti a sedere utilizzando i team scelti
  //^ (team 0: seat 0 e 2, team 1: seat 1 e 3)
  //^ Questo garantisce che i membri del team siano seduti uno di fronte all'altro
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

  //^ Prendi il round precedente (se esiste) per determinare lo starter se non è il primo round
  const previousRound = await prisma.round.findFirst({
    where: { gameRoomId, number: roundNumber - 1 },
    include: { hands: { orderBy: { number: "asc" } } },
  });

  const newRoundNumber = previousRound ? previousRound.number + 1 : 1;

  let starterId: number;

  //^ 1. Crea il round utilizzando il nuovo Round Number
  const round = await prisma.round.create({
    data: {
      number: newRoundNumber,
      briscola: null,
      gameRoomId: gameRoomId,
    },
  });

  //^ 2. Genera e mescola il mazzo
  const deck = shuffleDeck(generateDeck());

  //^ 3. Distribuisci le carte (10 a testa, random), crea tutte le playerCard
  const cardsPerPlayer = 10;
  let playerWithQuattroDenara: number | null = null;
  for (let i = 0; i < players.length; i++) {
    const playerId = players[i].id;
    const handCards = deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer);

    //^ Trova il player con il 4 di Denara
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

  /*

  if (newRoundNumber === 1) {
    //^ Primo round, chi ha il 4 di Denara in mano inizia
    starterId = playerWithQuattroDenara!;
  } else {
    //^ Nei round successivi, cambia chiamante. Prendo l'ultimo starter
    let lastStarterId = previousRound!.hands[0].starterId;

    //^ Ora computa il nuovo starterId, facendo rotazione antiorario fra i player
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
    starterId = newStarter.id;
  }

  //^ Creo la prima mano
  await prisma.hand.create({
    data: {
      roundId: round.id,
      number: 1,
      starterId: starterId, // Nuovo starter computato
    },
  });
  */

  //* Qui dovresti notificare tramite websocket il player che deve scegliere briscola (starterId)
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
  /**
   * Funzione che gestisce la logica di gioco quando un giocatore gioca una carta.
   *
   * @param roomCode Codice della room di gioco
   * @param userId ID dell'utente che gioca la carta
   * @param suit Seme della carta giocata
   * @param value Valore della carta giocata
   * @return void
   *
   * @note Questa funzione controlla anche la validità della mossa
   */

  //^ 1. Trova la room in cui si sta giocando
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

  //^ 2. Controlla che la mano corrente non sia già completa (4 carte giocate)
  if (playedCards.length >= 4) {
    throw new Error("Hand is already full");
  }

  //^ 3. Determina l'ordine di gioco a partire da starterId
  const seatOrder = Array.from(
    { length: 4 },
    (_, i) =>
      (room.players.find((p) => p.id === currentHand.starterId)!.seat! + i) % 4
  );
  const currentTurnPlayer = room.players.find(
    (p) => p.seat === seatOrder[playedCards.length]
  );
  if (!currentTurnPlayer || currentTurnPlayer.userId !== userId)
    throw new Error("It's not this player's turn");

  //^ 4. Controlla che il giocatore abbia effettivamente la carta specificata in mano
  const player = room.players.find((p) => p.userId === userId);
  if (!player) throw new Error("Player not found in this room");

  const playerCard = await prisma.playerCard.findFirst({
    where: {
      playerId: player.id,
      suit,
      value,
      roundId: currentRound.id,
    },
  });

  if (!playerCard) throw new Error("Player does not have this card");

  //^ 5. Rimuovi la carta dalla mano del giocatore e aggiungila alle carte giocate
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

  //^ Ora dobbiamo controllare se la mano è completa e gestire il turno successivo
  //^ Lo facciamo ma aspettando qualche secondo (5 secondi === 5000 ms) => SARA' FATTO LATO CLIENT, IL SERVER NON PUO' ASPETTARE
  if (playedCards.length + 1 === 4) {
    //^ Il player in questione era l'ultimo della mano corrente
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

    //^ Se la mano non era l'ultima del round, crea una nuova mano
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
      //^ Era l'ultima mano del round, bisogna creare un nuovo round
      await setupRound(room.id, currentRound.number + 1);

      //* NOTIFICA TRAMITE WEBSOCKET CHE IL ROUND E' FINITO E SI DEVE PARTIRE CON IL PROSSIMO (DI PIù DI COSì)
    }
  }
}
