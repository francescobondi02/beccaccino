// src/controllers/userController.ts

import { Request, Response } from "express";
import { prisma } from "../db";

export const createUser = async (req: Request, res: Response) => {
  /**
   * Crea un nuovo utente con uno username.
   *
   * @param username Username dell'utente (dal body della richiesta)
   * @return L'utente creato
   *
   */

  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    const newUser = await prisma.user.create({
      data: { username },
    });
    return res.status(201).json(newUser);
  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(500).json({ error: "User creation failed" });
  }
};
