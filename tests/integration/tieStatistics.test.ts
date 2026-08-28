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
    data: { code: "TIE001", started: true, finished: true },
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
      number: 1,
      briscola: "coppe",
      team0Points: 5,
      team1Points: 5,
      winnerTeam: 0,
    },
  });
  await prisma.hand.create({
    data: {
      roundId: round.id,
      number: 1,
      starterId: players[1].id,
      winnerId: players[0].id,
    },
  });

  return { users };
}

describe("Caller-tie statistics", () => {
  it("restores the final caller's team as winner for every player", async () => {
    const { users } = await createCallerTieGame();

    for (const user of users) {
      const response = await apiAs(user.id, user.username).get(
        "/api/games/TIE001/state",
      );

      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({
        status: "finished",
        currentTurnUserId: null,
        turnTimer: null,
        finishedGame: {
          winnerTeam: 1,
          totalRounds: 1,
          finalScores: { team0: 5, team1: 5 },
          roundsWon: { team0: 1, team1: 0 },
        },
      });
    }
  });

  it("reports the final caller's team as the profile winner", async () => {
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

  it("awards exactly two leaderboard wins to the caller's team", async () => {
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
