// src/controllers/userController.ts

import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { prisma } from "../db";
import { hashPassword, comparePassword } from "../utils/password";
import { generateToken } from "../utils/jwt";
import { logger } from "../logger";
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
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 giorni
};

export const register = async (req: Request, res: Response) => {
  /**
   * Registra un nuovo utente con username e password
   */
  const { username, password, email } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });
  }

  try {
    // Verifica se username esiste già
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      return res.status(409).json({ error: "Username already taken" });
    }

    // Verifica email se fornita
    if (email) {
      const existingEmail = await prisma.user.findUnique({
        where: { email },
      });

      if (existingEmail) {
        return res.status(409).json({ error: "Email already in use" });
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Crea utente
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        email: email || null,
      },
    });

    // Genera JWT token
    const token = generateToken({
      userId: user.id,
      username: user.username,
    });

    // Imposta cookie HTTP-only
    res.cookie("authToken", token, COOKIE_OPTIONS);

    // Ritorna user senza password
    const { password: _, ...userWithoutPassword } = user;
    return res.status(201).json(userWithoutPassword);
  } catch (error) {
    Sentry.captureException(error, { extra: { op: "register_user" } });
    (req.log ?? logger).error({ err: error }, "register_user_failed");
    return res.status(500).json({ error: "Registration failed" });
  }
};

export const login = async (req: Request, res: Response) => {
  /**
   * Login con username e password
   */
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    // Trova utente
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user || !user.password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Verifica password
    const isValidPassword = await comparePassword(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Genera JWT token
    const token = generateToken({
      userId: user.id,
      username: user.username,
    });

    // Imposta cookie HTTP-only
    res.cookie("authToken", token, COOKIE_OPTIONS);

    // Ritorna user senza password
    const { password: _, ...userWithoutPassword } = user;
    return res.status(200).json(userWithoutPassword);
  } catch (error) {
    Sentry.captureException(error, { extra: { op: "login" } });
    (req.log ?? logger).error({ err: error }, "login_failed");
    return res.status(500).json({ error: "Login failed" });
  }
};

export const logout = async (req: Request, res: Response) => {
  /**
   * Logout - rimuove il cookie
   */
  res.clearCookie("authToken", COOKIE_OPTIONS);
  return res.status(200).json({ message: "Logged out successfully" });
};

export const getCurrentUser = async (req: Request, res: Response) => {
  /**
   * Ritorna l'utente corrente autenticato
   */
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json(user);
  } catch (error) {
    Sentry.captureException(error, { extra: { op: "get_me" } });
    (req.log ?? logger).error({ err: error }, "get_me_failed");
    return res.status(500).json({ error: "Failed to fetch user" });
  }
};

export const getUserStats = async (req: Request, res: Response) => {
  /**
   * Ritorna le statistiche dell'utente corrente:
   * - totalGames, wins, winRate, totalPoints
   * - recentGames (last 10 finished games)
   */
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const userId = req.user.userId;

    // Find all Player records for this user in finished games
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
              select: {
                team0Points: true,
                team1Points: true,
                winnerTeam: true,
              },
            },
            players: {
              include: { user: { select: { username: true } } },
            },
          },
        },
      },
    });

    const totalGames = players.length;

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
      const myTeam = player.team;

      // Compute total points for each team across all rounds of this game
      let myTeamTotalPoints = 0;
      let opponentTeamTotalPoints = 0;

      for (const round of room.rounds) {
        if (round.winnerTeam !== null) {
          if (myTeam === 0) {
            myTeamTotalPoints += round.team0Points;
            opponentTeamTotalPoints += round.team1Points;
          } else {
            myTeamTotalPoints += round.team1Points;
            opponentTeamTotalPoints += round.team0Points;
          }
        }
      }

      // Determine if user's team won the game overall
      const didWin = myTeamTotalPoints > opponentTeamTotalPoints;
      if (didWin) wins++;
      totalPoints += myTeamTotalPoints;

      // Build recent game entry
      const teammates = room.players
        .filter((p) => p.team === myTeam && p.userId !== userId)
        .map((p) => p.user.username);
      const opponents = room.players
        .filter((p) => p.team !== myTeam)
        .map((p) => p.user.username);

      recentGames.push({
        id: room.id,
        code: room.code,
        date: room.createdAt.toISOString(),
        result: didWin ? "Vittoria" : "Sconfitta",
        myTeamPoints: myTeamTotalPoints,
        opponentTeamPoints: opponentTeamTotalPoints,
        teammates,
        opponents,
      });
    }

    // Sort by date descending, take last 10
    recentGames.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const recent = recentGames.slice(0, 10);

    const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

    return res.status(200).json({
      totalGames,
      wins,
      winRate,
      totalPoints,
      recentGames: recent,
    });
  } catch (error) {
    Sentry.captureException(error, { extra: { op: "get_user_stats" } });
    (req.log ?? logger).error({ err: error }, "get_user_stats_failed");
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
};

export const updateCurrentUser = async (req: Request, res: Response) => {
  /**
   * Aggiorna il profilo dell'utente corrente (username)
   */
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { username } = req.body;

    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Username is required" });
    }

    const trimmed = username.trim();
    if (trimmed.length < 3) {
      return res
        .status(400)
        .json({ error: "Username must be at least 3 characters" });
    }

    // Check uniqueness (unless it's the same user keeping the same name)
    const existing = await prisma.user.findUnique({
      where: { username: trimmed },
    });

    if (existing && existing.id !== req.user.userId) {
      return res.status(409).json({ error: "Username already taken" });
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: { username: trimmed },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Regenerate JWT with new username
    const token = generateToken({
      userId: updatedUser.id,
      username: updatedUser.username,
    });
    res.cookie("authToken", token, COOKIE_OPTIONS);

    return res.status(200).json(updatedUser);
  } catch (error) {
    Sentry.captureException(error, { extra: { op: "update_user" } });
    (req.log ?? logger).error({ err: error }, "update_user_failed");
    return res.status(500).json({ error: "Failed to update user" });
  }
};

export const deleteCurrentUser = async (req: Request, res: Response) => {
  /**
   * Elimina l'account dell'utente corrente.
   * Rifiuta se l'utente è in una partita attiva (non finita).
   */
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const userId = req.user.userId;

    // Check if user is in any active (non-finished) game
    const activeGames = await prisma.player.findMany({
      where: {
        userId,
        gameRoom: { finished: false, started: true },
      },
    });

    if (activeGames.length > 0) {
      return res.status(400).json({
        error:
          "Cannot delete account while in an active game. Finish or leave your games first.",
      });
    }

    // Delete player records in non-started rooms (leave rooms)
    await prisma.player.deleteMany({
      where: {
        userId,
        gameRoom: { started: false },
      },
    });

    // Delete the user (cascading will handle finished-game player records)
    // Note: we keep Player records in finished games for data integrity
    // But we need to delete the user itself
    await prisma.user.delete({
      where: { id: userId },
    });

    // Clear auth cookie
    res.clearCookie("authToken", COOKIE_OPTIONS);

    return res.status(200).json({ message: "Account deleted successfully" });
  } catch (error) {
    Sentry.captureException(error, { extra: { op: "delete_user" } });
    (req.log ?? logger).error({ err: error }, "delete_user_failed");
    return res.status(500).json({ error: "Failed to delete account" });
  }
};

// Simple in-memory cache for leaderboard (avoids hammering the DB on every request)
const leaderboardCacheStore: { data: any; expiry: number } = { data: null, expiry: 0 };
const LEADERBOARD_CACHE_TTL_MS = 60_000; // 60 seconds

export const getLeaderboard = async (req: Request, res: Response) => {
  /**
   * Returns global leaderboard: top players ranked by wins, win rate, and total points.
   * Only includes players who have completed at least 1 game.
   * No authentication required (public endpoint).
   * Cached for 60 seconds to reduce DB load.
   */
  try {
    // Return cached response if still valid (skip cache in test environment)
    if (process.env.NODE_ENV !== "test" && leaderboardCacheStore.data && Date.now() < leaderboardCacheStore.expiry) {
      return res.status(200).json(leaderboardCacheStore.data);
    }
    // Get all users who have played in finished games. Bots are excluded
    // explicitly as well as by RANKED_FINISHED_GAME: today they only ever sit in
    // practice rooms, but the ranking must not depend on that staying true.
    const users = await prisma.user.findMany({
      where: {
        isBot: false,
        players: {
          some: {
            gameRoom: RANKED_FINISHED_GAME,
          },
        },
      },
      include: {
        players: {
          where: {
            gameRoom: RANKED_FINISHED_GAME,
          },
          include: {
            gameRoom: {
              include: {
                rounds: {
                  where: { winnerTeam: { not: null } },
                  select: {
                    team0Points: true,
                    team1Points: true,
                    winnerTeam: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const leaderboard = users.map((user) => {
      let totalGames = 0;
      let wins = 0;
      let totalPoints = 0;

      for (const player of user.players) {
        totalGames++;
        const myTeam = player.team;

        let myTeamTotalPoints = 0;
        let opponentTeamTotalPoints = 0;

        for (const round of player.gameRoom.rounds) {
          if (myTeam === 0) {
            myTeamTotalPoints += round.team0Points;
            opponentTeamTotalPoints += round.team1Points;
          } else {
            myTeamTotalPoints += round.team1Points;
            opponentTeamTotalPoints += round.team0Points;
          }
        }

        if (myTeamTotalPoints > opponentTeamTotalPoints) {
          wins++;
        }
        totalPoints += myTeamTotalPoints;
      }

      const winRate =
        totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

      return {
        username: user.username,
        totalGames,
        wins,
        winRate,
        totalPoints,
      };
    });

    // Sort by wins desc, then winRate desc, then totalPoints desc
    leaderboard.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.totalPoints - a.totalPoints;
    });

    // Build response and cache it
    const responseData = { leaderboard: leaderboard.slice(0, 50) };
    leaderboardCacheStore.data = responseData;
    leaderboardCacheStore.expiry = Date.now() + LEADERBOARD_CACHE_TTL_MS;

    return res.status(200).json(responseData);
  } catch (error) {
    Sentry.captureException(error, { extra: { op: "leaderboard" } });
    (req.log ?? logger).error({ err: error }, "leaderboard_failed");
    return res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
};

