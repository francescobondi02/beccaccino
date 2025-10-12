// Utility functions for tests

import request from "supertest";
import { prisma } from "../../src/db";
import app from "../../src/app";

export async function setupGame() {
  /**
   * This function sets up a game with 4 users, creates a room, joins all users,
   * assigns teams, sets all players to ready, and starts the game.
   * It returns the room code, the created round, and the distributed cards.
   *
   * @note It's a utility function for tests
   */

  // 1. Create 4 users
  const users = await Promise.all(
    ["A", "B", "C", "D"].map((name) =>
      request(app).post("/api/users").send({ username: name })
    )
  );
  const userIds = users.map((res) => res.body.id);

  // 2. Create a room with user A
  const createRoomRes = await request(app)
    .post("/api/rooms")
    .send({ userId: userIds[0] });
  expect(createRoomRes.statusCode).toBe(201);

  const roomCode = createRoomRes.body.code;
  expect(typeof roomCode).toBe("string");
  expect(roomCode.length).toBeGreaterThanOrEqual(6);

  // 3. Join the room with users B, C, D
  for (let i = 1; i < 4; i++) {
    const joinRes = await request(app)
      .post("/api/rooms/join")
      .send({ roomCode, userId: userIds[i] });
    expect(joinRes.statusCode).toBe(200);
  }

  // 4. Assign teams (A & C = team 0, B & D = team 1)
  await Promise.all([
    request(app)
      .post(`/api/rooms/${roomCode}/choose-team`)
      .send({ userId: userIds[0], team: 0 }),
    request(app)
      .post(`/api/rooms/${roomCode}/choose-team`)
      .send({ userId: userIds[1], team: 1 }),
    request(app)
      .post(`/api/rooms/${roomCode}/choose-team`)
      .send({ userId: userIds[2], team: 0 }),
    request(app)
      .post(`/api/rooms/${roomCode}/choose-team`)
      .send({ userId: userIds[3], team: 1 }),
  ]);

  // 5. Set all players to ready
  for (let i = 0; i < 4; i++) {
    const res = await request(app)
      .post(`/api/rooms/${roomCode}/ready`)
      .send({ userId: userIds[i], isReady: true });
    expect(res.statusCode).toBe(200);
  }

  // 6. Check that the gameRoom is started and that a round was created
  const finalRoom = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: { rounds: true },
  });

  expect(finalRoom?.started).toBe(true);
  expect(finalRoom?.rounds.length).toBe(1);

  const round = finalRoom!.rounds[0];

  // 7. Verify that 40 cards were distributed
  const cards = await prisma.playerCard.findMany({
    where: { roundId: round.id },
  });
  expect(cards.length).toBe(40);

  // 8. Make sure each player got 10 cards
  const cardsByPlayer: Record<number, number> = {};
  for (const card of cards) {
    cardsByPlayer[card.playerId] = (cardsByPlayer[card.playerId] || 0) + 1;
  }
  for (const count of Object.values(cardsByPlayer)) {
    expect(count).toBe(10);
  }

  return { roomCode, round, cards };
}

export async function chooseBriscola(
  roomCode: string,
  round: any,
  cards: any[]
) {
  /**
   * This function chooses the briscola for the given round based on who has the 4 of Denara
   * (if first round) or the next player after the caller of the previous round (in subsequent rounds).
   * It uses the provided room code, round, and distributed cards.
   *
   * @note It's a utility function for tests
   */

  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: { players: true },
  });
  expect(room).not.toBeNull();

  let callerPlayerId: number | null = null;

  if (round.number == 1) {
    //^ Caso primo round: chi ha il 4 di Denara chiama
    for (const card of cards) {
      if (card.value === "quattro" && card.suit === "denara") {
        callerPlayerId = card.playerId;
        break;
      }
    }
  } else {
    //^ Caso round successivo: il player successivo al caller del round precedente (in senso antiorario)
    const previousRound = await prisma.round.findFirst({
      where: { gameRoomId: room!.id, number: round.number - 1 },
      include: {
        hands: {
          orderBy: {
            number: "asc",
          },
          take: 1,
        },
      },
    });

    expect(previousRound).not.toBeNull();
    const firstHand = previousRound!.hands[0];
    expect(firstHand).not.toBeNull();

    const prevCaller = room!.players.find((p) => p.id === firstHand!.starterId);
    const nextSeat = (prevCaller!.seat! + 1) % 4;
    const nextPlayer = room!.players.find((p) => p.seat === nextSeat);
    callerPlayerId = nextPlayer!.id;
    expect(nextPlayer).not.toBeNull();
  }

  expect(callerPlayerId).not.toBeNull();

  //^ Prendi le carte del chiamante e trova il seme più frequente
  const callerCards = cards.filter((c) => c.playerId === callerPlayerId);
  const cardsBySuit: Record<string, number> = {};
  for (const card of callerCards) {
    cardsBySuit[card.suit] = (cardsBySuit[card.suit] || 0) + 1;
  }

  const mostCommonSuit = Object.entries(cardsBySuit).sort(
    (a, b) => b[1] - a[1]
  )[0][0];

  const chooseBriscolaRes = await request(app)
    .post("/api/games/choose-briscola")
    .send({
      gameRoomId: room!.id,
      playerId: callerPlayerId,
      suit: mostCommonSuit,
    });

  //console.log("Choose brisocla response: ", chooseBriscolaRes.body);
  //console.log("Status: ", chooseBriscolaRes.statusCode);
  expect(chooseBriscolaRes.statusCode).toBe(200);
  expect(chooseBriscolaRes.body.round.briscola).toBe(mostCommonSuit);

  // 10. Verify that now the first hand was created
  const handsAfterBriscola = await prisma.hand.findMany({
    where: { roundId: round.id },
  });
  expect(handsAfterBriscola.length).toBe(1); // ✅ The first hand exists only after briscola
}

export async function oneHand(
  roomCode: string,
  round: any,
  handNumber: number
) {
  /**
   * This function simulates one hand of the game by having each player play one card
   * in the correct order based on the starter of the hand.
   * It uses the provided room code and round.
   *
   * @note It's a utility function for tests
   */
  // 11. Each player plays one card
  const updatedRoom = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: { players: true },
  });
  expect(updatedRoom).not.toBeNull();

  const starterHand = await prisma.hand.findFirst({
    where: { roundId: round.id, number: handNumber },
  });
  expect(starterHand).not.toBeNull();

  const playerOrder = Array.from(
    { length: 4 },
    (_, i) =>
      (updatedRoom!.players.find((p) => p.id === starterHand!.starterId)!
        .seat! +
        i) %
      4
  ).map((seat) => updatedRoom!.players.find((p) => p.seat === seat)!);

  for (const player of playerOrder) {
    // Fetch playable cards for this player before playing
    const playableRes = await request(app)
      .get(`/api/games/playable-cards/${roomCode}`)
      .query({ userId: player.userId });

    expect(playableRes.statusCode).toBe(200);
    const playableCards = playableRes.body.playableCards;
    //console.log("Playable cards for player", player.userId, playableCards);
    expect(Array.isArray(playableCards)).toBe(true);
    expect(playableCards.length).toBeGreaterThan(0);

    // Choose the first playable card
    const card = playableCards[0];

    expect(card).not.toBeNull();

    const playRes = await request(app).post("/api/games/play-card").send({
      roomCode,
      userId: player.userId,
      suit: card!.suit,
      value: card!.value,
    });

    if (playRes.statusCode !== 200) {
      console.log("Play card response error: ", playRes.body);
      console.log("Tried to play card: ", card);
    }
    expect(playRes.statusCode).toBe(200);
  }

  // ✅ Verify that 4 cards were played in this hand
  const playedCards = await prisma.playedCard.findMany({
    where: { handId: starterHand!.id },
  });
  expect(playedCards.length).toBe(4);
}

export async function oneRound(roomCode: string, round: any) {
  for (let i = 0; i < 10; i++) {
    const hands = await prisma.hand.findMany({
      where: { roundId: round.id },
      orderBy: { number: "asc" },
    });

    const currentHand = hands[i];
    expect(currentHand).not.toBeNull();

    //^ Gioca 4 carte
    await oneHand(roomCode, round, i + 1);

    //^ Verifica che sia stato creato il nuovo starter
    if (i < 9) {
      const nextHand = await prisma.hand.findFirst({
        where: {
          roundId: round.id,
          number: i + 2, // Mano successiva
        },
      });

      expect(nextHand).not.toBeNull();

      //^ Verifica che lo starter della mano successiva sia corretto
      const previousHand = await prisma.hand.findFirst({
        where: {
          roundId: round.id,
          number: i + 1, // Mano corrente
        },
      });

      expect(previousHand?.winnerId).toBe(nextHand?.starterId);
    }
  }

  //^ Alla fine del round ci saranno esattamente 10 mani e 40 carte giocate
  const finalHands = await prisma.hand.findMany({
    where: {
      roundId: round.id,
    },
  });
  expect(finalHands.length).toBe(10);

  const allPlayedCards = await prisma.playedCard.findMany({
    where: { handId: { in: finalHands.map((h) => h.id) } },
  });
  expect(allPlayedCards.length).toBe(40);
}
