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
} from "../controllers/userController";
import { authenticateToken } from "../middleware/auth";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", authenticateToken, logout);
router.get("/me", authenticateToken, getCurrentUser);
router.get("/me/stats", authenticateToken, getUserStats);
router.patch("/me", authenticateToken, updateCurrentUser);
router.delete("/me", authenticateToken, deleteCurrentUser);

export default router;
