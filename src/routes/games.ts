import { Router } from "express";
import {
  chooseBriscola,
  handlePlayCard,
  getPlayableCards,
  getGameState,
} from "../controllers/gameController";
import { authenticateToken } from "../middleware/auth";

const router = Router();

router.post("/choose-briscola", authenticateToken, chooseBriscola);
router.post("/play-card", authenticateToken, handlePlayCard);
router.get("/playable-cards/:roomCode", authenticateToken, getPlayableCards);
router.get("/:roomCode/state", authenticateToken, getGameState);

export default router;
