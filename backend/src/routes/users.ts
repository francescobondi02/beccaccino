// src/routes/users.ts
import { Router } from "express";
import {
  register,
  login,
  nativeLogin,
  logout,
} from "../controllers/authController";
import {
  getCurrentUser,
  updateCurrentUser,
  deleteCurrentUser,
} from "../controllers/accountController";
import {
  getUserStats,
  getLeaderboard,
} from "../controllers/statisticsController";
import { authenticateToken } from "../middleware/auth";
import {
  generalRateLimiter,
  loginRateLimiter,
  registerRateLimiter,
} from "../middleware/rateLimiter";

const router = Router();

router.post("/register", registerRateLimiter, register);
router.post("/login", loginRateLimiter, login);
router.post("/native/login", loginRateLimiter, nativeLogin);
router.post("/logout", logout); // Always clears the cookie, even for a dead session
router.get("/me", authenticateToken, getCurrentUser);
router.get("/me/stats", authenticateToken, getUserStats);
router.patch("/me", authenticateToken, updateCurrentUser);
router.delete("/me", authenticateToken, deleteCurrentUser);
router.get("/leaderboard", generalRateLimiter, getLeaderboard); // Public — no auth required

export default router;
