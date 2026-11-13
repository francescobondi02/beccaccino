import type { UserStats } from "@/pages/Profile";

export const profileDemo = {
  user: { id: 0, username: "GiuliaDemo" },
  stats: {
    totalGames: 28,
    wins: 17,
    winRate: 61,
    totalPoints: 892,
    recentGames: [
      {
        id: 1, code: "DEMO01", date: "2026-10-24T12:00:00Z",
        result: "Vittoria", myTeamPoints: 41, opponentTeamPoints: 29,
        teammates: ["Luca"], opponents: ["Marta", "Diego"],
      },
      {
        id: 2, code: "DEMO02", date: "2026-10-23T12:00:00Z",
        result: "Sconfitta", myTeamPoints: 33, opponentTeamPoints: 42,
        teammates: ["Marta"], opponents: ["Francesco", "Luca"],
      },
      {
        id: 3, code: "DEMO03", date: "2026-10-22T12:00:00Z",
        result: "Vittoria", myTeamPoints: 43, opponentTeamPoints: 35,
        teammates: ["Diego"], opponents: ["Marta", "Luca"],
      },
    ],
  } satisfies UserStats,
};
