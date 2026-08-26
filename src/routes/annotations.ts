import { Router } from "express";
import {
  getAnnotationStatus,
  getNextAnnotation,
  grantAnnotationAccess,
  upsertAnnotationResponse,
} from "../controllers/annotationController";
import { requireAnnotationAccess } from "../middleware/annotationAccess";
import { authenticateToken } from "../middleware/auth";
import { authRateLimiter, generalRateLimiter } from "../middleware/rateLimiter";

const router = Router();

router.use(authenticateToken);
router.get("/status", generalRateLimiter, getAnnotationStatus);
router.post("/access", authRateLimiter, grantAnnotationAccess);
router.use(requireAnnotationAccess);
router.get("/next", generalRateLimiter, getNextAnnotation);
router.post("/responses", generalRateLimiter, upsertAnnotationResponse);

export default router;
