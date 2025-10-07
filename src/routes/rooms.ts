import { Router } from "express";
import { createRoom, getAvailableRooms } from "../controllers/roomController";
import { chooseTeam } from "../controllers/chooseTeam";

const router = Router();

router.post("/", createRoom);
router.get("/available", getAvailableRooms);
router.post("/:roomCode/choose-team", chooseTeam);

export default router;
