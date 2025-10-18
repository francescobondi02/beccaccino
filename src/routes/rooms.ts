import { Router } from "express";
import {
  createRoom,
  getAvailableRooms,
  joinRoom,
  setPlayerReady,
  getRoomByCode,
} from "../controllers/roomController";
import { chooseTeam } from "../controllers/chooseTeam";
import { authenticateToken } from "../middleware/auth";

const router = Router();

router.post("/", authenticateToken, createRoom);
router.get("/available", authenticateToken, getAvailableRooms);
router.get("/:roomCode", authenticateToken, getRoomByCode);
router.post("/:roomCode/choose-team", authenticateToken, chooseTeam);
router.post("/join", authenticateToken, joinRoom);
router.post("/:roomCode/ready", authenticateToken, setPlayerReady);

export default router;
