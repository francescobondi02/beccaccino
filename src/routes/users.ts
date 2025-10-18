// src/routes/users.ts
import { Router } from "express";
import {
  register,
  login,
  logout,
  getCurrentUser,
  createUser,
} from "../controllers/userController";
import { authenticateToken } from "../middleware/auth";

const router = Router();

// Nuove rotte sicure
router.post("/register", register);
router.post("/login", login);
router.post("/logout", authenticateToken, logout);
router.get("/me", authenticateToken, getCurrentUser);

// Vecchia rotta per compatibilità (deprecata)
router.post("/", createUser);

export default router;
