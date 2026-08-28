import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { prisma } from "../db";
import { conflict, notFound, unauthorized } from "../http/errors";
import {
  parseLoginInput,
  parseRegistrationInput,
  parseUsernameUpdate,
} from "../http/input/users";
import { requireUser } from "../http/request";
import { comparePassword, hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";
import { summarizePlayerGame } from "../utils/playerGameStats";
import { RANKED_FINISHED_GAME } from "../utils/statsFilters";

const isProduction = process.env.NODE_ENV === "production";
const isCrossOrigin =
  isProduction &&
  process.env.FRONTEND_URL &&
  !process.env.FRONTEND_URL.includes(process.env.RENDER_EXTERNAL_HOSTNAME || "");

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isCrossOrigin ? "none" : "strict") as "none" | "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const register = async (req: Request, res: Response) => {
  const input = parseRegistrationInput(req.body);
  const existingUser = await prisma.user.findUnique({
    where: { username: input.username },
  });
  if (existingUser) throw conflict("Username already taken");

  if (input.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existingEmail) throw conflict("Email already in use");
  }

  const user = await prisma.user.create({
    data: {
      username: input.username,
      password: await hashPassword(input.password),
      email: input.email,
    },
  });
  res.cookie(
    "authToken",
    generateToken({ userId: user.id, username: user.username }),
    COOKIE_OPTIONS,
  );
  const { password: _, ...userWithoutPassword } = user;
  return res.status(201).json(userWithoutPassword);
};

export const login = async (req: Request, res: Response) => {
  const input = parseLoginInput(req.body);
  const user = await prisma.user.findUnique({
    where: { username: input.username },
  });
  if (
    !user ||
    user.deletedAt ||
    !user.password ||
    !(await comparePassword(input.password, user.password))
  ) {
    throw unauthorized("Invalid credentials");
  }

  res.cookie(
    "authToken",
    generateToken({ userId: user.id, username: user.username }),
    COOKIE_OPTIONS,
  );
  const { password: _, ...userWithoutPassword } = user;
  return res.status(200).json(userWithoutPassword);
};

export const logout = async (_req: Request, res: Response) => {
  res.clearCookie("authToken", COOKIE_OPTIONS);
  return res.status(200).json({ message: "Logged out successfully" });
};

export const getCurrentUser = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) throw notFound("User not found");
  return res.status(200).json(user);
};

export const getUserStats = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
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
  return res.status(200).json({
    totalGames,
    wins,
    winRate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
    totalPoints,
    recentGames: recentGames.slice(0, 10),
  });
};

export const updateCurrentUser = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const username = parseUsernameUpdate(req.body);
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing && existing.id !== userId) {
    throw conflict("Username already taken");
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { username },
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  res.cookie(
    "authToken",
    generateToken({
      userId: updatedUser.id,
      username: updatedUser.username,
    }),
    COOKIE_OPTIONS,
  );
  return res.status(200).json(updatedUser);
};

export const deleteCurrentUser = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const activeGames = await prisma.player.findMany({
    where: {
      userId,
      gameRoom: { finished: false, started: true },
    },
  });
  if (activeGames.length > 0) {
    throw conflict(
      "Cannot delete account while in an active game. Finish multiplayer games or abandon practice games first.",
    );
  }

  await prisma.player.deleteMany({
    where: {
      userId,
      gameRoom: { started: false },
    },
  });
  const anonToken = randomUUID();
  await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      username: `deleted_user_${userId}_${anonToken}`,
      email: `deleted_user_${userId}_${anonToken}@deleted.invalid`,
      password: null,
      expertAccessGrantedAt: null,
    },
  });
  res.clearCookie("authToken", COOKIE_OPTIONS);
  return res.status(200).json({ message: "Account deleted successfully" });
};

const leaderboardCacheStore: {
  data: { leaderboard: LeaderboardEntry[] } | null;
  expiry: number;
} = { data: null, expiry: 0 };
const LEADERBOARD_CACHE_TTL_MS = 60_000;

type LeaderboardEntry = {
  username: string;
  totalGames: number;
  wins: number;
  winRate: number;
  totalPoints: number;
};

export const getLeaderboard = async (_req: Request, res: Response) => {
  if (
    process.env.NODE_ENV !== "test" &&
    leaderboardCacheStore.data &&
    Date.now() < leaderboardCacheStore.expiry
  ) {
    return res.status(200).json(leaderboardCacheStore.data);
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

  const responseData = { leaderboard: leaderboard.slice(0, 50) };
  leaderboardCacheStore.data = responseData;
  leaderboardCacheStore.expiry = Date.now() + LEADERBOARD_CACHE_TTL_MS;
  return res.status(200).json(responseData);
};
