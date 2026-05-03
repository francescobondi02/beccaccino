// src/routes/users.ts
import { Router } from "express";
import {
  register,
  login,
  logout,
  getCurrentUser,
  getUserStats,
  updateCurrentUser,
  deleteCurrentUser,
  getLeaderboard,
} from "../controllers/userController";
import { authenticateToken } from "../middleware/auth";
import { authRateLimiter, generalRateLimiter } from "../middleware/rateLimiter";

const router = Router();

router.post("/register", authRateLimiter, register);
router.post("/login", authRateLimiter, login);
router.post("/logout", authenticateToken, logout);
router.get("/me", authenticateToken, getCurrentUser);
router.get("/me/stats", authenticateToken, getUserStats);
router.patch("/me", authenticateToken, updateCurrentUser);
router.delete("/me", authenticateToken, deleteCurrentUser);
router.get("/leaderboard", generalRateLimiter, getLeaderboard); // Public — no auth required

export default router;
