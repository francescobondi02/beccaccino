import { Router } from "express";
import {
  chooseBriscola,
  handlePlayCard,
  getGameState,
} from "../controllers/gameController";
import { authenticateToken } from "../middleware/auth";
import { gameRateLimiter } from "../middleware/rateLimiter";

const router = Router();

router.get("/:roomCode/state", authenticateToken, gameRateLimiter, getGameState);
router.post("/:roomCode/briscola", authenticateToken, gameRateLimiter, chooseBriscola);
router.post("/:roomCode/cards", authenticateToken, gameRateLimiter, handlePlayCard);

export default router;
