import { prisma } from "../../src/db";

import { clearDatabase, setupGame, chooseBriscola, api, apiAs } from "../helpers/gameHelpers";

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
        include: { players: { include: { user: true } } },
      });

      // Try choosing briscola again as an authenticated player in the room
      const someplayer = room!.players[0];
      const res = await apiAs(someplayer.userId, someplayer.user.username)
        .post("/api/games/choose-briscola")
        .send({
          gameRoomId: room!.id,
          suit: "coppe",
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/already/i);
    });

    it("rejects a player not in the game room", async () => {
      const { roomCode } = await setupGame();

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
      });

      // Create a fresh user that is NOT in this game room
      const outsider = await prisma.user.create({
        data: { username: "outsider", password: "x" },
      });

      const res = await apiAs(outsider.id, outsider.username)
        .post("/api/games/choose-briscola")
        .send({
          gameRoomId: room!.id,
          suit: "spade",
        });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("Play Card - Turn Enforcement", () => {
    it("rejects playing out of turn", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: { include: { user: true } } },
      });

      const currentHand = await prisma.hand.findFirst({
        where: { roundId: round.id },
        orderBy: { number: "desc" },
      });

      const wrongPlayer = room!.players.find((p) => p.id !== currentHand!.starterId)!;

      const wrongPlayerCard = await prisma.playerCard.findFirst({
        where: { playerId: wrongPlayer.id, roundId: round.id },
      });

      const res = await apiAs(wrongPlayer.userId, wrongPlayer.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: wrongPlayerCard!.suit,
          value: wrongPlayerCard!.value,
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/turn/i);
    });

    it("rejects playing a card the player doesn't have", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const currentHand = await prisma.hand.findFirst({
        where: { roundId: round.id },
        orderBy: { number: "desc" },
      });

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: { include: { user: true } } },
      });

      const starter = room!.players.find((p) => p.id === currentHand!.starterId)!;

      const starterCards = await prisma.playerCard.findMany({
        where: { playerId: starter.id, roundId: round.id },
      });

      // Find a card from another player that the starter does NOT have.
      const otherPlayers = room!.players.filter((p) => p.id !== starter.id);
      let otherCard: { suit: string; value: string } | null = null;

      for (const otherPlayer of otherPlayers) {
        const otherCards = await prisma.playerCard.findMany({
          where: { playerId: otherPlayer.id, roundId: round.id },
        });
        for (const candidate of otherCards) {
          const starterHasIt = starterCards.some(
            (c) => c.suit === candidate.suit && c.value === candidate.value,
          );
          if (!starterHasIt) {
            otherCard = { suit: candidate.suit, value: candidate.value };
            break;
          }
        }
        if (otherCard) break;
      }

      expect(otherCard).not.toBeNull();

      const res = await apiAs(starter.userId, starter.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: otherCard!.suit,
          value: otherCard!.value,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/does not have/i);
    });
  });

  describe("Play Card - Game State Validation", () => {
    it("rejects playing in a non-existent room", async () => {
      // Need any authenticated user to reach the controller
      const user = await prisma.user.create({
        data: { username: "ghost", password: "x" },
      });
      const res = await apiAs(user.id, user.username)
        .post("/api/games/play-card")
        .send({
          roomCode: "XXXXXX",
          suit: "coppe",
          value: "asso",
        });

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/not found|not started/i);
    });
  });

  describe("Game State Endpoint", () => {
    it("returns correct game state after setup", async () => {
      const { roomCode } = await setupGame();

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: { include: { user: true } } },
      });

      const player = room!.players[0];

      const res = await apiAs(player.userId, player.user.username)
        .get(`/api/games/${roomCode}/state`);

      expect(res.statusCode).toBe(200);
      expect(res.body.round).toBeDefined();
      expect(res.body.round.number).toBe(1);
      expect(res.body.round.briscola).toBeNull();
      expect(res.body.myCards).toBeDefined();
      expect(res.body.myCards.length).toBe(10);
      expect(res.body.callerUserId).toBeDefined();
    });

    it("returns briscola after it's chosen", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: { include: { user: true } } },
      });

      const player = room!.players[0];

      const res = await apiAs(player.userId, player.user.username)
        .get(`/api/games/${roomCode}/state`);

      expect(res.statusCode).toBe(200);
      expect(res.body.round.briscola).not.toBeNull();
      expect(["denara", "coppe", "spade", "bastoni"]).toContain(
        res.body.round.briscola,
      );
    });

    it("rejects state request for non-player", async () => {
      const { roomCode } = await setupGame();

      const outsiderRes = await api()
        .post("/api/users/register")
        .send({ username: "outsider", password: "test123" });

      const res = await apiAs(outsiderRes.body.id, "outsider")
        .get(`/api/games/${roomCode}/state`);

      expect(res.statusCode).toBe(403);
    });

    it("returns current turn user correctly", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: { include: { user: true } } },
      });

      const player = room!.players[0];

      const res = await apiAs(player.userId, player.user.username)
        .get(`/api/games/${roomCode}/state`);

      expect(res.statusCode).toBe(200);
      expect(res.body.currentTurnUserId).toBeDefined();
      expect(typeof res.body.currentTurnUserId).toBe("number");

      const playerUserIds = room!.players.map((p) => p.userId);
      expect(playerUserIds).toContain(res.body.currentTurnUserId);
    });

    it("updates played cards after a valid play", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: { include: { user: true } } },
      });

      const p0 = room!.players[0];

      const stateRes = await apiAs(p0.userId, p0.user.username)
        .get(`/api/games/${roomCode}/state`);

      const currentTurnUserId = stateRes.body.currentTurnUserId;
      const turnPlayer = room!.players.find((p) => p.userId === currentTurnUserId)!;

      const playableRes = await apiAs(turnPlayer.userId, turnPlayer.user.username)
        .get(`/api/games/playable-cards/${roomCode}`);

      expect(playableRes.statusCode).toBe(200);
      const playableCards = playableRes.body.playableCards;
      expect(playableCards.length).toBeGreaterThan(0);

      const cardToPlay = playableCards[0];
      const playRes = await apiAs(turnPlayer.userId, turnPlayer.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: cardToPlay.suit,
          value: cardToPlay.value,
        });

      expect(playRes.statusCode).toBe(200);

      const newState = await apiAs(p0.userId, p0.user.username)
        .get(`/api/games/${roomCode}/state`);

      expect(newState.body.playedCards.length).toBe(1);
      expect(newState.body.playedCards[0].suit).toBe(cardToPlay.suit);
      expect(newState.body.playedCards[0].value).toBe(cardToPlay.value);

      expect(newState.body.currentTurnUserId).not.toBe(currentTurnUserId);
    });
  });

  describe("Choose Briscola - Caller Validation", () => {
    it("rejects a player who is not the correct briscola caller", async () => {
      const { roomCode, cards } = await setupGame();

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: { include: { user: true } } },
      });

      let correctCallerPlayerId: number | null = null;
      for (const card of cards) {
        if (card.value === "quattro" && card.suit === "denara") {
          correctCallerPlayerId = card.playerId;
          break;
        }
      }
      expect(correctCallerPlayerId).not.toBeNull();

      const wrongPlayer = room!.players.find(
        (p) => p.id !== correctCallerPlayerId,
      )!;

      const res = await apiAs(wrongPlayer.userId, wrongPlayer.user.username)
        .post("/api/games/choose-briscola")
        .send({
          gameRoomId: room!.id,
          suit: "coppe",
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/not your turn to choose briscola/i);
    });

    it("allows the correct caller to choose briscola", async () => {
      const { roomCode, cards } = await setupGame();

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: { include: { user: true } } },
      });

      let correctCallerPlayerId: number | null = null;
      for (const card of cards) {
        if (card.value === "quattro" && card.suit === "denara") {
          correctCallerPlayerId = card.playerId;
          break;
        }
      }
      expect(correctCallerPlayerId).not.toBeNull();

      const correctCaller = room!.players.find(
        (p) => p.id === correctCallerPlayerId,
      )!;

      const res = await apiAs(correctCaller.userId, correctCaller.user.username)
        .post("/api/games/choose-briscola")
        .send({
          gameRoomId: room!.id,
          suit: "coppe",
        });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("Playable Cards (Follow-Suit Rules)", () => {
    it("returns all cards when player is first to play", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: { include: { user: true } } },
      });

      const p0 = room!.players[0];

      const stateRes = await apiAs(p0.userId, p0.user.username)
        .get(`/api/games/${roomCode}/state`);

      const currentTurnUserId = stateRes.body.currentTurnUserId;
      const turnPlayer = room!.players.find((p) => p.userId === currentTurnUserId)!;

      const res = await apiAs(turnPlayer.userId, turnPlayer.user.username)
        .get(`/api/games/playable-cards/${roomCode}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.playableCards.length).toBe(10);
    });

    it("restricts cards to matching suit when not first player", async () => {
      const { roomCode, round, cards } = await setupGame();
      await chooseBriscola(roomCode, round, cards);

      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: { include: { user: true } } },
      });

      const p0 = room!.players[0];

      const stateRes = await apiAs(p0.userId, p0.user.username)
        .get(`/api/games/${roomCode}/state`);

      const firstTurnUserId = stateRes.body.currentTurnUserId;
      const firstTurnPlayer = room!.players.find((p) => p.userId === firstTurnUserId)!;

      const playableRes = await apiAs(firstTurnPlayer.userId, firstTurnPlayer.user.username)
        .get(`/api/games/playable-cards/${roomCode}`);

      const firstCard = playableRes.body.playableCards[0];
      await apiAs(firstTurnPlayer.userId, firstTurnPlayer.user.username)
        .post("/api/games/play-card")
        .send({
          roomCode,
          suit: firstCard.suit,
          value: firstCard.value,
        });

      const newState = await apiAs(p0.userId, p0.user.username)
        .get(`/api/games/${roomCode}/state`);

      const secondTurnUserId = newState.body.currentTurnUserId;
      const secondTurnPlayer = room!.players.find((p) => p.userId === secondTurnUserId)!;

      const secondPlayable = await apiAs(secondTurnPlayer.userId, secondTurnPlayer.user.username)
        .get(`/api/games/playable-cards/${roomCode}`);

      expect(secondPlayable.statusCode).toBe(200);
      const secondCards = secondPlayable.body.playableCards;
      expect(secondCards.length).toBeGreaterThan(0);

      const secondPlayerAllCards = await prisma.playerCard.findMany({
        where: {
          roundId: round.id,
          player: { userId: secondTurnUserId },
        },
      });

      const hasLeadSuit = secondPlayerAllCards.some(
        (c) => c.suit === firstCard.suit,
      );

      if (hasLeadSuit) {
        for (const card of secondCards) {
          expect(card.suit).toBe(firstCard.suit);
        }
      } else {
        expect(secondCards.length).toBe(secondPlayerAllCards.length);
      }
    });
  });
});
