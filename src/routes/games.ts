import { Router } from "express";
import {
  chooseBriscola,
  handlePlayCard,
  getPlayableCards,
} from "../controllers/gameController";

const router = Router();

router.post("/choose-briscola", chooseBriscola);
router.post("/play-card", handlePlayCard);
router.get("/playable-cards/:roomCode", getPlayableCards);

export default router;
