import { Router } from "express";
import {
  chooseBriscola,
  handlePlayCard,
  getGameState,
} from "../controllers/gameController";
import { authenticateToken } from "../middleware/auth";
import { gameRateLimiter } from "../middleware/rateLimiter";
import {
  validateChooseBriscola,
  validatePlayCard,
} from "../middleware/validate";

const router = Router();

router.get("/:roomCode/state", authenticateToken, gameRateLimiter, getGameState);
router.post("/:roomCode/briscola", authenticateToken, gameRateLimiter, validateChooseBriscola, chooseBriscola);
router.post("/:roomCode/cards", authenticateToken, gameRateLimiter, validatePlayCard, handlePlayCard);

export default router;
