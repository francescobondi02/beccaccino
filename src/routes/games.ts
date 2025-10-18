import { Router } from "express";
import {
  chooseBriscola,
  handlePlayCard,
  getPlayableCards,
} from "../controllers/gameController";
import { authenticateToken } from "../middleware/auth";

const router = Router();

router.post("/choose-briscola", authenticateToken, chooseBriscola);
router.post("/play-card", authenticateToken, handlePlayCard);
router.get("/playable-cards/:roomCode", authenticateToken, getPlayableCards);

export default router;
