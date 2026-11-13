import { Router } from "express";
import {
  createRoom,
  createPracticeRoom,
  joinRoom,
  setPlayerReady,
  setRoomBots,
  leaveRoom,
  resumePlayerControl,
  pausePracticeRoom,
  resumePracticeRoom,
  chooseTeam,
} from "../controllers/roomMutationController";
import {
  getAvailableRooms,
  getRoomByCode,
} from "../controllers/roomQueryController";
import { authenticateToken } from "../middleware/auth";
import { generalRateLimiter } from "../middleware/rateLimiter";

const router = Router();

router.post("/", authenticateToken, generalRateLimiter, createRoom);
router.post("/practice", authenticateToken, generalRateLimiter, createPracticeRoom);
router.get("/available", authenticateToken, generalRateLimiter, getAvailableRooms);
router.get("/:roomCode", authenticateToken, generalRateLimiter, getRoomByCode);
router.post("/:roomCode/choose-team", authenticateToken, generalRateLimiter, chooseTeam);
router.post("/join", authenticateToken, generalRateLimiter, joinRoom);
router.post("/:roomCode/ready", authenticateToken, generalRateLimiter, setPlayerReady);
router.post("/:roomCode/bots", authenticateToken, generalRateLimiter, setRoomBots);
router.post("/:roomCode/pause", authenticateToken, generalRateLimiter, pausePracticeRoom);
router.post("/:roomCode/resume", authenticateToken, generalRateLimiter, resumePracticeRoom);
router.post("/:roomCode/leave", authenticateToken, generalRateLimiter, leaveRoom);
router.post("/:roomCode/resume-control", authenticateToken, generalRateLimiter, resumePlayerControl);

export default router;
