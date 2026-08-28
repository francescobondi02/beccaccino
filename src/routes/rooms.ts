import { Router } from "express";
import {
  createRoom,
  createPracticeRoom,
  getAvailableRooms,
  joinRoom,
  setPlayerReady,
  getRoomByCode,
  leaveRoom,
  getExitedRooms,
  pausePracticeRoom,
  resumePracticeRoom,
} from "../controllers/roomController";
import { chooseTeam } from "../controllers/chooseTeam";
import { authenticateToken } from "../middleware/auth";
import { generalRateLimiter } from "../middleware/rateLimiter";

const router = Router();

router.post("/", authenticateToken, generalRateLimiter, createRoom);
router.post("/practice", authenticateToken, generalRateLimiter, createPracticeRoom);
router.get("/available", authenticateToken, generalRateLimiter, getAvailableRooms);
router.get("/getExitedRooms", authenticateToken, generalRateLimiter, getExitedRooms);
router.get("/:roomCode", authenticateToken, generalRateLimiter, getRoomByCode);
router.post("/:roomCode/choose-team", authenticateToken, generalRateLimiter, chooseTeam);
router.post("/join", authenticateToken, generalRateLimiter, joinRoom);
router.post("/:roomCode/ready", authenticateToken, generalRateLimiter, setPlayerReady);
router.post("/:roomCode/pause", authenticateToken, generalRateLimiter, pausePracticeRoom);
router.post("/:roomCode/resume", authenticateToken, generalRateLimiter, resumePracticeRoom);
router.post("/:roomCode/leave", authenticateToken, generalRateLimiter, leaveRoom);

export default router;
