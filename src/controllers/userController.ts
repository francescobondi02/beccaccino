// src/controllers/userController.ts

import { Request, Response } from "express";
import { prisma } from "../db";
import { hashPassword, comparePassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production", // HTTPS in produzione
  sameSite: "strict" as const,
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
    console.error("Error registering user:", error);
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
    console.error("Error logging in:", error);
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
    console.error("Error fetching current user:", error);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
};

