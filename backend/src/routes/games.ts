import { Router } from "express";
import {
  chooseBriscola,
  handlePlayCard,
  getPlayableCards,
  getGameState,
} from "../controllers/gameController";
import { authenticateToken } from "../middleware/auth";
import { gameRateLimiter } from "../middleware/rateLimiter";
import {
  validateChooseBriscola,
  validatePlayCard,
  validateGetPlayableCards,
} from "../middleware/validate";

const router = Router();

router.post("/choose-briscola", authenticateToken, gameRateLimiter, validateChooseBriscola, chooseBriscola);
router.post("/play-card", authenticateToken, gameRateLimiter, validatePlayCard, handlePlayCard);
router.get("/playable-cards/:roomCode", authenticateToken, gameRateLimiter, validateGetPlayableCards, getPlayableCards);
router.get("/:roomCode/state", authenticateToken, gameRateLimiter, getGameState);

export default router;
