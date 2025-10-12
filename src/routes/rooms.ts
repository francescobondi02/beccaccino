import { Router } from "express";
import {
  createRoom,
  getAvailableRooms,
  joinRoom,
  setPlayerReady,
} from "../controllers/roomController";
import { chooseTeam } from "../controllers/chooseTeam";

const router = Router();

router.post("/", createRoom);
router.get("/available", getAvailableRooms);
router.post("/:roomCode/choose-team", chooseTeam);
router.post("/join", joinRoom);
router.post("/:roomCode/ready", setPlayerReady);

export default router;
