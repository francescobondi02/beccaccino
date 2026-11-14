import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import { apiAs } from "../helpers/serverHarness";

beforeEach(async () => {
  await clearDatabase();
});

async function createCallerTieGame() {
  const users = [];
  for (const username of ["tieA", "tieB", "tieC", "tieD"]) {
    users.push(
      await prisma.user.create({
        data: { username, password: "test-password" },
      }),
    );
  }

  const room = await prisma.gameRoom.create({
    data: { code: "TIE001", started: true, finished: true, winnerTeam: 1 },
  });
  const players = [];
  for (let index = 0; index < users.length; index++) {
    players.push(
      await prisma.player.create({
        data: {
          gameRoomId: room.id,
          userId: users[index].id,
          seat: index,
          team: index % 2,
        },
      }),
    );
  }

  const round = await prisma.round.create({
    data: {
      gameRoomId: room.id,
      callerId: players[1].id,
      number: 1,
      briscola: "coppe",
      team0Raw: 15,
      team1Raw: 15,
      winnerTeam: 0,
    },
  });
  const trick = await prisma.trick.create({
    data: {
      roundId: round.id,
      number: 1,
      starterId: players[1].id,
      winnerId: players[0].id,
    },
  });

  return { users, players, round, trick };
}

describe("Caller-tie statistics", () => {
  it("derives signals, tricks and enemy aces from persisted cards on refresh", async () => {
    const { users, players, trick } = await createCallerTieGame();
    await prisma.playedCard.createMany({
      data: players.map((player, position) => ({
        trickId: trick.id,
        playerId: player.id,
        position,
        suit: (["denara", "coppe", "spade", "bastoni"] as const)[position],
        value: "asso",
        signal: position === 0 ? "busso" : null,
      })),
    });
    const first = await apiAs(users[0].id, users[0].username).get("/api/games/TIE001/state");
    const refreshed = await apiAs(users[1].id, users[1].username).get("/api/games/TIE001/state");
    expect(first.statusCode).toBe(200);
    expect(refreshed.body.result).toEqual(first.body.result);
    expect(first.body.result.statistics.players).toEqual([
      { username: "tieA", team: 0, tricksWon: 1, busso: 1, acesCaptured: 2, acesLost: 0 },
      { username: "tieB", team: 1, tricksWon: 0, busso: 0, acesCaptured: 0, acesLost: 1 },
      { username: "tieC", team: 0, tricksWon: 0, busso: 0, acesCaptured: 0, acesLost: 0 },
      { username: "tieD", team: 1, tricksWon: 0, busso: 0, acesCaptured: 0, acesLost: 1 },
    ]);
    expect(first.body.result.statistics.rounds).toEqual([
      { number: 1, winnerTeam: 0, score: { team0: { points: 5, figures: 0 }, team1: { points: 5, figures: 0 } } },
    ]);
  });

  it("returns the stored winner to every player", async () => {
    const { users } = await createCallerTieGame();

    for (const user of users) {
      const response = await apiAs(user.id, user.username).get(
        "/api/games/TIE001/state",
      );

      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({
        status: "finished",
        turn: null,
        result: {
          winnerTeam: 1,
          totalRounds: 1,
          finalScores: { team0: 5, team1: 5 },
          roundsWon: { team0: 1, team1: 0 },
        },
      });
    }
  });

  it("reports the stored winner in profile stats", async () => {
    const { users } = await createCallerTieGame();

    const winner = await apiAs(users[1].id, users[1].username).get(
      "/api/users/me/stats",
    );
    const loser = await apiAs(users[0].id, users[0].username).get(
      "/api/users/me/stats",
    );

    expect(winner.statusCode).toBe(200);
    expect(winner.body).toMatchObject({ totalGames: 1, wins: 1, winRate: 100 });
    expect(winner.body.recentGames[0].result).toBe("Vittoria");
    expect(loser.statusCode).toBe(200);
    expect(loser.body).toMatchObject({ totalGames: 1, wins: 0, winRate: 0 });
    expect(loser.body.recentGames[0].result).toBe("Sconfitta");
  });

  it("awards exactly two leaderboard wins to the stored winner team", async () => {
    const { users } = await createCallerTieGame();

    const response = await apiAs(users[0].id, users[0].username).get(
      "/api/users/leaderboard",
    );

    expect(response.statusCode).toBe(200);
    const winners = response.body.leaderboard
      .filter((entry: { wins: number }) => entry.wins === 1)
      .map((entry: { username: string }) => entry.username)
      .sort();
    expect(winners).toEqual(["tieB", "tieD"]);
  });
});
