import { prisma } from "../db";
import { summarizePlayerGame } from "../utils/playerGameStats";
import { RANKED_FINISHED_GAME } from "../utils/statsFilters";

export async function getUserStatistics(userId: number) {
  const players = await prisma.player.findMany({
    where: {
      userId,
      gameRoom: RANKED_FINISHED_GAME,
    },
    include: {
      gameRoom: {
        include: {
          rounds: {
            orderBy: { number: "asc" },
            where: { winnerTeam: { not: null } },
            select: {
              team0Points: true,
              team1Points: true,
              team0Figures: true,
              team1Figures: true,
              hands: {
                orderBy: { number: "asc" },
                take: 1,
                select: { starterId: true },
              },
            },
          },
          players: {
            include: { user: { select: { username: true } } },
          },
        },
      },
    },
  });

  let wins = 0;
  let totalPoints = 0;
  const recentGames: {
    id: number;
    code: string;
    date: string;
    result: "Vittoria" | "Sconfitta";
    myTeamPoints: number;
    opponentTeamPoints: number;
    teammates: string[];
    opponents: string[];
  }[] = [];

  for (const player of players) {
    const room = player.gameRoom;
    const summary = summarizePlayerGame(
      player.team,
      room.rounds,
      room.players,
    );
    if (summary.didWin) wins++;
    totalPoints += summary.myTeamPoints;
    recentGames.push({
      id: room.id,
      code: room.code,
      date: room.createdAt.toISOString(),
      result: summary.didWin ? "Vittoria" : "Sconfitta",
      myTeamPoints: summary.myTeamPoints,
      opponentTeamPoints: summary.opponentTeamPoints,
      teammates: room.players
        .filter(
          (candidate) =>
            candidate.team === player.team && candidate.userId !== userId,
        )
        .map((candidate) => candidate.user.username),
      opponents: room.players
        .filter((candidate) => candidate.team !== player.team)
        .map((candidate) => candidate.user.username),
    });
  }

  recentGames.sort(
    (left, right) =>
      new Date(right.date).getTime() - new Date(left.date).getTime(),
  );
  const totalGames = players.length;
  return {
    totalGames,
    wins,
    winRate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
    totalPoints,
    recentGames: recentGames.slice(0, 10),
  };
}

type LeaderboardEntry = {
  username: string;
  totalGames: number;
  wins: number;
  winRate: number;
  totalPoints: number;
};

const leaderboardCacheStore: {
  data: { leaderboard: LeaderboardEntry[] } | null;
  expiry: number;
} = { data: null, expiry: 0 };
const LEADERBOARD_CACHE_TTL_MS = 60_000;

export async function getLeaderboardStatistics() {
  if (
    process.env.NODE_ENV !== "test" &&
    leaderboardCacheStore.data &&
    Date.now() < leaderboardCacheStore.expiry
  ) {
    return leaderboardCacheStore.data;
  }

  const users = await prisma.user.findMany({
    where: {
      isBot: false,
      deletedAt: null,
      players: { some: { gameRoom: RANKED_FINISHED_GAME } },
    },
    include: {
      players: {
        where: { gameRoom: RANKED_FINISHED_GAME },
        include: {
          gameRoom: {
            include: {
              rounds: {
                where: { winnerTeam: { not: null } },
                orderBy: { number: "asc" },
                select: {
                  team0Points: true,
                  team1Points: true,
                  team0Figures: true,
                  team1Figures: true,
                  hands: {
                    orderBy: { number: "asc" },
                    take: 1,
                    select: { starterId: true },
                  },
                },
              },
              players: { select: { id: true, team: true } },
            },
          },
        },
      },
    },
  });

  const leaderboard: LeaderboardEntry[] = users.map((user) => {
    let wins = 0;
    let totalPoints = 0;
    for (const player of user.players) {
      const summary = summarizePlayerGame(
        player.team,
        player.gameRoom.rounds,
        player.gameRoom.players,
      );
      if (summary.didWin) wins++;
      totalPoints += summary.myTeamPoints;
    }
    const totalGames = user.players.length;
    return {
      username: user.username,
      totalGames,
      wins,
      winRate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
      totalPoints,
    };
  });
  leaderboard.sort((left, right) => {
    if (right.wins !== left.wins) return right.wins - left.wins;
    if (right.winRate !== left.winRate) return right.winRate - left.winRate;
    return right.totalPoints - left.totalPoints;
  });

  const response = { leaderboard: leaderboard.slice(0, 50) };
  leaderboardCacheStore.data = response;
  leaderboardCacheStore.expiry = Date.now() + LEADERBOARD_CACHE_TTL_MS;
  return response;
}
