import request from "supertest";
import { prisma } from "../../src/db";

import { clearDatabase, setupGame, chooseBriscola, getServer } from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

describe("Game Error Cases", () => {
  describe("Choose Briscola", () => {
    it("rejects choosing briscola when already set", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      // Get room info
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      // Try choosing briscola again
      const res = await request(getServer())
        .post("/api/games/choose-briscola")
        .send({
          gameRoomId: room!.id,
          playerId: room!.players[0].id,
          suit: "coppe",
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/already/i);
    });

    it("rejects a player not in the game room", async () => {
      const { roomCode, round } = await setupGame();

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
      });

      const res = await request(getServer())
        .post("/api/games/choose-briscola")
        .send({
          gameRoomId: room!.id,
          playerId: 99999, // non-existent player
          suit: "spade",
        });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("Play Card - Turn Enforcement", () => {
    it("rejects playing out of turn", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      // Get the room with players
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      // Find the current hand to know who starts
      const currentHand = await prisma.hand.findFirst({
        where: { roundId: round.id },
        orderBy: { number: "desc" },
      });

      // Find who should play (starter)
      const starter = room!.players.find((p) => p.id === currentHand!.starterId);
      // Find a player who is NOT the starter
      const wrongPlayer = room!.players.find((p) => p.id !== currentHand!.starterId);

      // Get a card that wrongPlayer has
      const wrongPlayerCard = await prisma.playerCard.findFirst({
        where: { playerId: wrongPlayer!.id, roundId: round.id },
      });

      // Try to play with the wrong player
      const res = await request(getServer())
        .post("/api/games/play-card")
        .send({
          roomCode,
          userId: wrongPlayer!.userId,
          suit: wrongPlayerCard!.suit,
          value: wrongPlayerCard!.value,
        });

      expect(res.statusCode).toBe(500);
      expect(res.body.error).toMatch(/turn/i);
    });

    it("rejects playing a card the player doesn't have", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      // Find who should play first
      const currentHand = await prisma.hand.findFirst({
        where: { roundId: round.id },
        orderBy: { number: "desc" },
      });

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      const starter = room!.players.find((p) => p.id === currentHand!.starterId);

      // Get all cards the starter has
      const starterCards = await prisma.playerCard.findMany({
        where: { playerId: starter!.id, roundId: round.id },
      });

      // Find a card from another player that the starter definitely does NOT have.
      // We iterate until we find one that doesn't collide (guaranteed since each
      // card exists only once in the deck).
      const otherPlayers = room!.players.filter((p) => p.id !== starter!.id);
      let otherCard: { suit: string; value: string } | null = null;

      for (const otherPlayer of otherPlayers) {
        const otherCards = await prisma.playerCard.findMany({
          where: { playerId: otherPlayer.id, roundId: round.id },
        });
        for (const candidate of otherCards) {
          const starterHasIt = starterCards.some(
            (c) => c.suit === candidate.suit && c.value === candidate.value
          );
          if (!starterHasIt) {
            otherCard = { suit: candidate.suit, value: candidate.value };
            break;
          }
        }
        if (otherCard) break;
      }

      // With 40 unique cards split among 4 players (10 each), there is always
      // a card that belongs to another player and not the starter.
      expect(otherCard).not.toBeNull();

      const res = await request(getServer())
        .post("/api/games/play-card")
        .send({
          roomCode,
          userId: starter!.userId,
          suit: otherCard!.suit,
          value: otherCard!.value,
        });

      expect(res.statusCode).toBe(500);
      expect(res.body.error).toMatch(/does not have/i);
    });
  });

  describe("Play Card - Game State Validation", () => {
    it("rejects playing in a non-existent room", async () => {
      const res = await request(getServer())
        .post("/api/games/play-card")
        .send({
          roomCode: "XXXXXX",
          userId: 1,
          suit: "coppe",
          value: "asso",
        });

      expect(res.statusCode).toBe(500);
      expect(res.body.error).toMatch(/not found|not started/i);
    });
  });

  describe("Game State Endpoint", () => {
    it("returns correct game state after setup", async () => {
      const { roomCode, round, cards } = await setupGame();

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      const player = room!.players[0];

      const res = await request(getServer())
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: player.userId });

      expect(res.statusCode).toBe(200);
      expect(res.body.round).toBeDefined();
      expect(res.body.round.number).toBe(1);
      expect(res.body.round.briscola).toBeNull(); // Not yet chosen
      expect(res.body.myCards).toBeDefined();
      expect(res.body.myCards.length).toBe(10);
      expect(res.body.callerUserId).toBeDefined();
    });

    it("returns briscola after it's chosen", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      const player = room!.players[0];

      const res = await request(getServer())
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: player.userId });

      expect(res.statusCode).toBe(200);
      expect(res.body.round.briscola).not.toBeNull();
      expect(["denara", "coppe", "spade", "bastoni"]).toContain(
        res.body.round.briscola
      );
    });

    it("rejects state request for non-player", async () => {
      const { roomCode } = await setupGame();

      // Create an outsider user
      const outsider = await request(getServer())
        .post("/api/users/register")
        .send({ username: "outsider", password: "test123" });

      const res = await request(getServer())
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: outsider.body.id });

      expect(res.statusCode).toBe(403);
    });

    it("returns current turn user correctly", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      const player = room!.players[0];

      const res = await request(getServer())
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: player.userId });

      expect(res.statusCode).toBe(200);
      expect(res.body.currentTurnUserId).toBeDefined();
      expect(typeof res.body.currentTurnUserId).toBe("number");

      // The current turn user should be one of the players in the room
      const playerUserIds = room!.players.map((p) => p.userId);
      expect(playerUserIds).toContain(res.body.currentTurnUserId);
    });

    it("updates played cards after a valid play", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      // Get current state to find whose turn it is
      const stateRes = await request(getServer())
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: room!.players[0].userId });

      const currentTurnUserId = stateRes.body.currentTurnUserId;
      const turnPlayer = room!.players.find((p) => p.userId === currentTurnUserId);

      // Get playable cards
      const playableRes = await request(getServer())
        .get(`/api/games/playable-cards/${roomCode}`)
        .query({ userId: currentTurnUserId });

      expect(playableRes.statusCode).toBe(200);
      const playableCards = playableRes.body.playableCards;
      expect(playableCards.length).toBeGreaterThan(0);

      // Play the first playable card
      const cardToPlay = playableCards[0];
      const playRes = await request(getServer())
        .post("/api/games/play-card")
        .send({
          roomCode,
          userId: currentTurnUserId,
          suit: cardToPlay.suit,
          value: cardToPlay.value,
        });

      expect(playRes.statusCode).toBe(200);

      // Verify state updated
      const newState = await request(getServer())
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: room!.players[0].userId });

      expect(newState.body.playedCards.length).toBe(1);
      expect(newState.body.playedCards[0].suit).toBe(cardToPlay.suit);
      expect(newState.body.playedCards[0].value).toBe(cardToPlay.value);

      // The turn should have moved to the next player
      expect(newState.body.currentTurnUserId).not.toBe(currentTurnUserId);
    });
  });

  describe("Playable Cards (Follow-Suit Rules)", () => {
    it("returns all cards when player is first to play", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      // Get whose turn it is
      const stateRes = await request(getServer())
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: room!.players[0].userId });

      const currentTurnUserId = stateRes.body.currentTurnUserId;

      const res = await request(getServer())
        .get(`/api/games/playable-cards/${roomCode}`)
        .query({ userId: currentTurnUserId });

      expect(res.statusCode).toBe(200);
      // First player of the hand can play any card → all 10 cards
      expect(res.body.playableCards.length).toBe(10);
    });

    it("restricts cards to matching suit when not first player", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      // Get whose turn + play the first card
      const stateRes = await request(getServer())
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: room!.players[0].userId });

      const firstTurnUserId = stateRes.body.currentTurnUserId;

      const playableRes = await request(getServer())
        .get(`/api/games/playable-cards/${roomCode}`)
        .query({ userId: firstTurnUserId });

      const firstCard = playableRes.body.playableCards[0];
      await request(getServer()).post("/api/games/play-card").send({
        roomCode,
        userId: firstTurnUserId,
        suit: firstCard.suit,
        value: firstCard.value,
      });

      // Now get the second player's playable cards
      const newState = await request(getServer())
        .get(`/api/games/${roomCode}/state`)
        .query({ userId: room!.players[0].userId });

      const secondTurnUserId = newState.body.currentTurnUserId;

      const secondPlayable = await request(getServer())
        .get(`/api/games/playable-cards/${roomCode}`)
        .query({ userId: secondTurnUserId });

      expect(secondPlayable.statusCode).toBe(200);
      const secondCards = secondPlayable.body.playableCards;
      expect(secondCards.length).toBeGreaterThan(0);

      // If the second player has cards of the lead suit, they must play one
      const secondPlayerAllCards = await prisma.playerCard.findMany({
        where: {
          roundId: round.id,
          player: { userId: secondTurnUserId },
        },
      });

      const hasLeadSuit = secondPlayerAllCards.some(
        (c) => c.suit === firstCard.suit
      );

      if (hasLeadSuit) {
        // All playable cards should be of the lead suit
        for (const card of secondCards) {
          expect(card.suit).toBe(firstCard.suit);
        }
      } else {
        // Can play anything — all remaining cards are playable
        expect(secondCards.length).toBe(secondPlayerAllCards.length);
      }
    });
  });
});
