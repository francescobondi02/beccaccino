// src/services/gameService.ts
// This file can be used to implement game-related business logic
// that can be reused across different controllers or parts of the application.

import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { determineHandWinner } from "../utils/determineHandWinner";
import { computePoints } from "../utils/computePoints";
import { cumulativeScore, decideGameWinner } from "../utils/score";
import { detectCricca } from "../utils/detectCricca";
import { getSocketInstance } from "../socketInstance";
import { getRng } from "../utils/random";
import { startTurnTimer, clearTurnTimer, clearRoomTimerData } from "./turnTimer";
import { withRoomLock } from "../utils/roomLock";
import { logger } from "../logger";

/**
 * Points required to win the game.
 * Defaults to 41 (standard Beccaccino rules).
 * Can be overridden via GAME_WIN_POINTS env var (e.g., 5 for fast testing).
 */
export const GAME_WIN_POINTS = (() => {
  const parsed = parseInt(process.env.GAME_WIN_POINTS || "41", 10);
  if (isNaN(parsed) || parsed < 1) {
    logger.warn(
      { value: process.env.GAME_WIN_POINTS },
      "invalid_game_win_points_defaulting_to_41",
    );
    return 41;
  }
  return parsed;
})();

/** Seat `offset` positions clockwise from `seat`, wrapping around the 4-seat table. */
export function seatAfter(seat: number, offset = 1): number {
  return (seat + offset) % 4;
}

/**
 * The briscola caller leads the round's first hand, so the previous round's
 * first-hand starter identifies the previous caller; the next caller sits one
 * seat clockwise. Null when the rotation cannot be resolved.
 */
function callerAfter(
  players: { id: number; seat: number | null }[],
  previousCallerId: number,
): number | null {
  const previous = players.find((p) => p.id === previousCallerId);
  if (!previous || previous.seat === null) return null;
  const nextSeat = seatAfter(previous.seat);
  return players.find((p) => p.seat === nextSeat)?.id ?? null;
}

/**
 * Which player calls briscola for `round`: round 1 goes to the holder of the
 * quattro di denara, later rounds rotate one seat clockwise from the previous
 * caller.
 */
export async function resolveCaller(
  round: { id: number; number: number; gameRoomId: number },
  players: { id: number; seat: number | null }[],
): Promise<number | null> {
  if (round.number === 1) {
    const quattroDenara = await prisma.playerCard.findFirst({
      where: { roundId: round.id, suit: "denara", value: "quattro" },
    });
    return quattroDenara?.playerId ?? null;
  }

  const previousRound = await prisma.round.findFirst({
    where: { gameRoomId: round.gameRoomId, number: round.number - 1 },
    include: { hands: { orderBy: { number: "asc" }, take: 1 } },
  });
  const previousCallerId = previousRound?.hands[0]?.starterId;
  return previousCallerId === undefined
    ? null
    : callerAfter(players, previousCallerId);
}

/**
 * Whose turn the game state should report, mirroring how playCard advances
 * play: the caller until briscola is chosen, then the next seat within an
 * open hand, then the completed hand's winner.
 */
export async function resolveCurrentTurnUserId(
  round: { id: number; briscola: string | null },
  players: { id: number; userId: number; seat: number | null }[],
  callerUserId: number | null,
): Promise<number | null> {
  if (round.briscola === null) return callerUserId;

  const lastHand = await prisma.hand.findFirst({
    where: { roundId: round.id },
    orderBy: { number: "desc" },
    include: { cards: { orderBy: { position: "asc" } } },
  });
  if (!lastHand) return callerUserId;

  if (lastHand.cards.length < 4) {
    const starter = players.find((p) => p.id === lastHand.starterId);
    if (!starter || starter.seat === null) return null;
    const nextSeat = seatAfter(starter.seat, lastHand.cards.length);
    return players.find((p) => p.seat === nextSeat)?.userId ?? null;
  }

  if (lastHand.winnerId) {
    return players.find((p) => p.id === lastHand.winnerId)?.userId ?? null;
  }
  return null;
}

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
   * Mescola un array di elementi (carte) usando l'algoritmo Fisher-Yates.
   * Usa il generatore di numeri casuali centralizzato (getRng()) così i test
   * possono iniettare un seed deterministico.
   */
  const rng = getRng();
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function setupRound(
  gameRoomId: number,
  roundNumber: number,
  tx?: Prisma.TransactionClient,
) {
  /**
   * Funzione che fa il setup di un round di gioco.
   *
   * @note Se è il primo round, chi ha il 4 di Denara in mano sceglie la briscola e inizia lui la prima mano.
   * Se non è il primo round, lo starter è il giocatore alla sinistra di chi ha iniziato prima.
   *
   * @param gameRoomId ID della room di gioco
   * @param roundNumber Numero del round (1, 2, 3, ...)
   * @param tx Client di transazione opzionale: se fornito le scritture vi
   *   partecipano; altrimenti la funzione apre una propria transazione.
   * @return void
   *
   */
  return tx
    ? setupRoundTx(tx, gameRoomId, roundNumber)
    : prisma.$transaction((client) =>
        setupRoundTx(client, gameRoomId, roundNumber),
      );
}

async function setupRoundTx(
  tx: Prisma.TransactionClient,
  gameRoomId: number,
  roundNumber: number,
) {
  //^ Prendi i player nella room (usando gameRoomId)
  const players = await tx.player.findMany({
    where: { gameRoomId },
    orderBy: { seat: "asc" },
  });

  if (players.length !== 4) {
    throw new Error("There must be exactly 4 players to start the game");
  }

  //^ Assegna i posti a sedere solo al primo round
  //^ (team 0: seat 0 e 2, team 1: seat 1 e 3)
  //^ Questo garantisce che i membri del team siano seduti uno di fronte all'altro
  if (roundNumber === 1) {
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
      await tx.player.update({
        where: { id: seatAssignments[seat].id },
        data: { seat },
      });
    }
  }

  //^ Prendi il round precedente (se esiste) per determinare lo starter se non è il primo round
  const previousRound = await tx.round.findFirst({
    where: { gameRoomId, number: roundNumber - 1 },
    include: { hands: { orderBy: { number: "asc" } } },
  });

  const newRoundNumber = previousRound ? previousRound.number + 1 : 1;

  let starterId: number;

  //^ 1. Crea il round utilizzando il nuovo Round Number
  const round = await tx.round.create({
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
        (card) => card.suit === Suit.denara && card.value === Value.quattro,
      )
    ) {
      playerWithQuattroDenara = playerId;
    }

    await tx.playerCard.createMany({
      data: handCards.map((card) => ({
        playerId: playerId,
        suit: card.suit,
        value: card.value,
        roundId: round.id,
      })),
    });
  }

  // Determine the briscola caller for this round
  if (newRoundNumber === 1) {
    starterId = playerWithQuattroDenara!;
  } else {
    const nextCaller = callerAfter(players, previousRound!.hands[0].starterId);
    if (nextCaller === null) {
      throw new Error("Could not rotate briscola caller from previous round");
    }
    starterId = nextCaller;
  }

  logger.info(
    {
      gameRoomId,
      roundNumber: newRoundNumber,
      roundId: round.id,
      callerPlayerId: starterId,
    },
    "round_setup",
  );

  return { callerPlayerId: starterId, roundId: round.id };
}

/**
 * Announce the game and set up round 1, arming the caller's briscola timer.
 *
 * Shared by the lobby ready-up gate and practice-game creation so a game
 * against bots starts on exactly the same path as a game between humans.
 * The caller owns flipping `started` (the lobby needs a conditional flip to
 * settle a race; a fresh practice room does not).
 */
export async function startFirstRound(
  gameRoomId: number,
  roomCode: string,
): Promise<void> {
  getSocketInstance().to(roomCode).emit("game_started", {});

  const { callerPlayerId } = await setupRound(gameRoomId, 1);
  const caller = await prisma.player.findUnique({
    where: { id: callerPlayerId },
    select: { userId: true },
  });
  if (caller) {
    startTurnTimer(roomCode, caller.userId, "choose_briscola");
  }
}

/**
 * Set briscola for the current round and create the first hand.
 * Extracted as a service so it can be called from both the REST controller and auto-play.
 *
 * Wraps the implementation in a per-room mutex so two simultaneous calls
 * (e.g. caller hitting the button + auto-play timer firing in the same tick)
 * cannot both pass the "briscola === null" check.
 */
export async function setBriscola(args: {
  gameRoomId: number;
  playerId: number;
  suit: Suit;
}) {
  // We need the roomCode to key the lock. Look it up once; the inner function
  // will re-fetch the full room with players for correctness.
  const room = await prisma.gameRoom.findUnique({
    where: { id: args.gameRoomId },
    select: { code: true },
  });
  if (!room) throw new GameError("Game room not found", 404);
  return withRoomLock(room.code, () => setBriscolaUnlocked(args));
}

async function setBriscolaUnlocked({
  gameRoomId,
  playerId,
  suit,
}: {
  gameRoomId: number;
  playerId: number;
  suit: Suit;
}) {
  const gameRoom = await prisma.gameRoom.findUnique({
    where: { id: gameRoomId },
    include: { players: true },
  });
  if (!gameRoom) throw new GameError("Game room not found", 404);

  // Clear timer before processing (prevents race with auto-play)
  clearTurnTimer(gameRoom.code);

  const player = gameRoom.players.find((p) => p.id === playerId);
  if (!player) throw new GameError("Player not in this game room", 403);

  const currentRound = await prisma.round.findFirst({
    where: { gameRoomId },
    orderBy: { number: "desc" },
  });
  if (!currentRound) throw new GameError("No active round found", 500);
  if (currentRound.briscola !== null)
    throw new GameError("Briscola already set for this round", 400);

  // Verify it's the correct player's turn to choose
  const callerPlayerId = await resolveCaller(currentRound, gameRoom.players);

  if (playerId !== callerPlayerId) {
    throw new GameError("It's not your turn to choose briscola", 403);
  }

  // Check for Cricca: caller has Tre + Due + Asso of the chosen briscola suit
  const callerCards = await prisma.playerCard.findMany({
    where: { playerId, roundId: currentRound.id },
  });
  const hasCricca = detectCricca(callerCards, suit);

  const updatedRound = await prisma.round.update({
    where: { id: currentRound.id },
    data: { briscola: suit, cricca: hasCricca },
  });

  const firstHand = await prisma.hand.create({
    data: {
      roundId: currentRound.id,
      number: 1,
      starterId: playerId,
    },
  });

  const io = getSocketInstance();
  io.to(gameRoom.code).emit("briscola_chosen", {
    briscola: suit,
    roundNumber: currentRound.number,
    starterId: playerId,
    cricca: hasCricca,
  });

  // Start timer for the first card play (caller plays first)
  const callerPlayer = gameRoom.players.find((p) => p.id === playerId);
  if (callerPlayer) {
    startTurnTimer(gameRoom.code, callerPlayer.userId, "play_card");
  }

  logger.info(
    {
      roomCode: gameRoom.code,
      gameRoomId,
      roundNumber: currentRound.number,
      callerPlayerId: playerId,
      briscola: suit,
      cricca: hasCricca,
    },
    "briscola_set",
  );

  return { round: updatedRound, hand: firstHand, roomCode: gameRoom.code };
}

/**
 * Play a card in the current hand.
 *
 * Wraps the implementation in a per-room mutex so two simultaneous plays
 * (network retry, double-click, manual-play colliding with auto-play timer)
 * cannot both pass the turn / hand-not-full / has-card checks.
 */
export async function playCard(args: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
  signal?: "striscio" | "busso" | "volo" | null;
}) {
  return withRoomLock(args.roomCode, () => playCardUnlocked(args));
}

async function playCardUnlocked({
  roomCode,
  userId,
  suit,
  value,
  signal,
}: {
  roomCode: string;
  userId: number;
  suit: Suit;
  value: Value;
  signal?: "striscio" | "busso" | "volo" | null;
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

  // Clear timer before processing (prevents race with auto-play)
  clearTurnTimer(roomCode);

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
    throw new GameError("Room not found or game not started", 404);

  if (room.finished) throw new GameError("Game is already finished", 400);

  const currentRound = room.rounds[0];
  const currentHand = currentRound?.hands[0];
  if (!currentRound || !currentHand)
    throw new GameError("No active round or hand found", 400);

  const playedCards = currentHand.cards;

  //^ 2. Controlla che la mano corrente non sia già completa (4 carte giocate)
  if (playedCards.length >= 4) {
    throw new GameError("Hand is already full", 400);
  }

  //^ 3. Determina l'ordine di gioco a partire da starterId
  const seatOrder = Array.from({ length: 4 }, (_, i) =>
    seatAfter(
      room.players.find((p) => p.id === currentHand.starterId)!.seat!,
      i,
    ),
  );
  const currentTurnPlayer = room.players.find(
    (p) => p.seat === seatOrder[playedCards.length],
  );
  if (!currentTurnPlayer || currentTurnPlayer.userId !== userId)
    throw new GameError("It's not this player's turn", 403);

  //^ 4. Controlla che il giocatore abbia effettivamente la carta specificata in mano
  const player = room.players.find((p) => p.userId === userId);
  if (!player) throw new GameError("Player not found in this room", 404);

  const playerCard = await prisma.playerCard.findFirst({
    where: {
      playerId: player.id,
      suit,
      value,
      roundId: currentRound.id,
    },
  });

  if (!playerCard) throw new GameError("Player does not have this card", 400);

  // Only the trick leader (position 0) can declare a signal
  const validSignal =
    playedCards.length === 0 && signal ? signal : null;

  //^ 5. Rimuovi la carta dalla mano del giocatore e aggiungila alle carte giocate
  const played = await prisma.$transaction(async (tx) => {
    await tx.playerCard.delete({
      where: {
        id: playerCard.id,
      },
    });

    return tx.playedCard.create({
      data: {
        handId: currentHand.id,
        playerId: player.id,
        suit,
        value,
        position: playedCards.length,
        signal: validSignal,
      },
    });
  });

  // Notifica tramite websocket la carta giocata
  const io = getSocketInstance();
  io.to(roomCode).emit("card_played", {
    playerId: player.id,
    userId: player.userId,
    suit,
    value,
    position: playedCards.length,
    handNumber: currentHand.number,
    signal: validSignal,
  });

  logger.info(
    {
      roomCode,
      userId,
      playerId: player.id,
      suit,
      value,
      position: playedCards.length,
      handNumber: currentHand.number,
      roundNumber: currentRound.number,
      signal: validSignal,
    },
    "card_played",
  );

  //^ Ora dobbiamo controllare se la mano è completa e gestire il turno successivo
  if (playedCards.length + 1 < 4) {
    // Hand not complete — start timer for next player
    const seatOrder = Array.from({ length: 4 }, (_, i) =>
      seatAfter(
        room.players.find((p) => p.id === currentHand.starterId)!.seat!,
        i,
      ),
    );
    const nextSeat = seatOrder[playedCards.length + 1];
    const nextPlayer = room.players.find((p) => p.seat === nextSeat);
    if (nextPlayer) {
      startTurnTimer(roomCode, nextPlayer.userId, "play_card");
    }
  }

  if (playedCards.length + 1 === 4) {
    //^ Il player in questione era l'ultimo della mano corrente
    const winnerPlayerId = determineHandWinner(
      [...playedCards, played],
      currentRound.briscola,
    );

    //^ Se la mano non era l'ultima del round, crea una nuova mano
    if (currentHand.number < 10) {
      await prisma.$transaction(async (tx) => {
        await tx.hand.update({
          where: { id: currentHand.id },
          data: { winnerId: winnerPlayerId },
        });
        await tx.hand.create({
          data: {
            roundId: currentRound.id,
            number: currentHand.number + 1,
            starterId: winnerPlayerId, // La nuova mano parte da chi ha preso quella prima
          },
        });
      });

      // Start timer for the trick winner (who starts the new hand)
      const winnerPlayer = room.players.find((p) => p.id === winnerPlayerId);
      if (winnerPlayer) {
        startTurnTimer(roomCode, winnerPlayer.userId, "play_card");
      }
    } else {
      //^ Era l'ultima mano del round, calcola i punti e crea un nuovo round

      // Recupera tutte le mani del round con le carte giocate
      const allHands = await prisma.hand.findMany({
        where: { roundId: currentRound.id },
        orderBy: { number: "asc" },
        include: {
          cards: {
            orderBy: { position: "asc" },
            include: { player: true },
          },
        },
      });

      // Crea la mappa teamPlayers: playerId -> team
      const teamPlayers: Record<number, number> = {};
      for (const player of room.players) {
        if (player.team !== null) {
          teamPlayers[player.id] = player.team;
        }
      }

      // Calcola i punti
      const scores = computePoints(
        allHands.map((h) => ({
          winnerId: h.winnerId,
          cards: h.cards.map((c) => ({
            value: c.value,
            suit: c.suit,
            playerId: c.playerId,
          })),
        })),
        teamPlayers,
        currentRound.briscola!,
      );

      // Apply Cricca bonus: +3 points to the caller's team
      if (currentRound.cricca) {
        const callerId = allHands[0].starterId;
        const callerTeam = teamPlayers[callerId];
        if (callerTeam === 0) {
          scores.team0.points += 3;
        } else if (callerTeam === 1) {
          scores.team1.points += 3;
        }
      }

      // Determina il team vincitore (chi ha più punti)
      let winnerTeam: number;
      if (scores.team0.points > scores.team1.points) {
        winnerTeam = 0;
      } else if (scores.team1.points > scores.team0.points) {
        winnerTeam = 1;
      } else {
        // Parità di punti, vince chi ha più figure
        if (scores.team0.figures > scores.team1.figures) {
          winnerTeam = 0;
        } else if (scores.team1.figures > scores.team0.figures) {
          winnerTeam = 1;
        } else {
          // Parità anche nelle figure, di default vince team 0
          winnerTeam = 0;
        }
      }

      // Calcola i punteggi totali di tutti i round completati. Il round corrente
      // non è ancora scritto (l'update avviene nella transazione sotto), quindi
      // lo aggiungiamo in memoria con i punteggi appena calcolati.
      const previousCompletedRounds = await prisma.round.findMany({
        where: {
          gameRoomId: room.id,
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
      const totalTeam0Points = total.team0.points;
      const totalTeam1Points = total.team1.points;

      // Il caller (chi ha scelto briscola) ha guidato la prima mano del round.
      const callerTeam = teamPlayers[allHands[0].starterId];

      // Controlla se una squadra ha raggiunto la soglia di punti per vincere
      const finalWinnerTeam = decideGameWinner(
        total,
        GAME_WIN_POINTS,
        callerTeam,
      );

      let newCallerPlayerId: number | null = null;
      await prisma.$transaction(async (tx) => {
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
        } else {
          newCallerPlayerId = (
            await setupRound(room.id, currentRound.number + 1, tx)
          ).callerPlayerId;
        }
      });

      // Notifica via socket il termine del round con i punteggi
      io.to(roomCode).emit("round_ended", {
        roundNumber: currentRound.number,
        team0: {
          points: scores.team0.points,
          figures: scores.team0.figures,
        },
        team1: {
          points: scores.team1.points,
          figures: scores.team1.figures,
        },
        winnerTeam,
        cricca: currentRound.cricca,
      });

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
        // Calcola statistiche aggiuntive
        const totalRounds = allCompletedRounds.length;
        const team0Wins = allCompletedRounds.filter(
          (r) => r.winnerTeam === 0,
        ).length;
        const team1Wins = totalRounds - team0Wins;

        // Notifica la fine della partita con tutte le statistiche
        io.to(roomCode).emit("game_finished", {
          winnerTeam: finalWinnerTeam,
          totalRounds,
          finalScores: {
            team0: totalTeam0Points,
            team1: totalTeam1Points,
          },
          roundsWon: {
            team0: team0Wins,
            team1: team1Wins,
          },
        });

        logger.info(
          {
            roomCode,
            winnerTeam: finalWinnerTeam,
            totalRounds,
            totalTeam0Points,
            totalTeam1Points,
          },
          "game_finished",
        );

        clearRoomTimerData(roomCode);
      } else {
        // Notifica il nuovo round
        io.to(roomCode).emit("new_round_started", {
          roundNumber: currentRound.number + 1,
        });

        // Start briscola timer for the new caller
        const newCaller = room.players.find((p) => p.id === newCallerPlayerId);
        if (newCaller) {
          startTurnTimer(roomCode, newCaller.userId, "choose_briscola");
        }
      }
    }
  }
}
