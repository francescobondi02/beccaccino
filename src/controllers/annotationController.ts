import { createHash, timingSafeEqual } from "crypto";
import { Request, Response } from "express";
import { prisma } from "../db";
import {
  AnnotationSelectedAction,
  isAnnotationActionLegal,
  parseAnnotationScenario,
  parseAnnotationSelectedAction,
} from "../annotations/scenario";
import { isAnnotationDifficulty } from "../annotations/constants";
import { selectNextAnnotationScenario } from "../annotations/selection";

const COMMENT_MAX_LENGTH = 500;
const RESPONSE_TIME_MAX_MS = 24 * 60 * 60 * 1000;

function requireUserId(req: Request, res: Response): number | null {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return req.user.userId;
}

function accessCodeMatches(value: unknown): boolean {
  const expected = process.env.ANNOTATION_ACCESS_CODE;
  if (!expected || typeof value !== "string") return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256").update(value).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

async function contributionCount(userId: number): Promise<number> {
  return prisma.expertAnnotation.count({ where: { userId } });
}

export const getAnnotationStatus = async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (userId === null) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletedAt: true, expertAccessGrantedAt: true },
  });
  if (!user || user.deletedAt) {
    return res.status(401).json({ error: "Authentication required" });
  }
  return res.status(200).json({
    accessGranted: user.expertAccessGrantedAt !== null,
    contributionCount: await contributionCount(userId),
  });
};

export const grantAnnotationAccess = async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (userId === null) return;
  if (!process.env.ANNOTATION_ACCESS_CODE) {
    return res.status(503).json({ error: "Annotation access is not configured" });
  }
  if (!accessCodeMatches(req.body?.code)) {
    return res.status(400).json({ error: "Invalid annotation access code" });
  }

  const result = await prisma.user.updateMany({
    where: {
      id: userId,
      deletedAt: null,
      expertAccessGrantedAt: null,
    },
    data: { expertAccessGrantedAt: new Date() },
  });
  if (result.count === 0) {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true, expertAccessGrantedAt: true },
    });
    if (!existing || existing.deletedAt) {
      return res.status(401).json({ error: "Authentication required" });
    }
  }
  return res.status(200).json({
    accessGranted: true,
    contributionCount: await contributionCount(userId),
  });
};

function validatedComment(value: unknown):
  | { ok: true; comment: string | null }
  | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, comment: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "Comment must be a string or null" };
  }
  const comment = value.trim();
  if (comment.length === 0) {
    return { ok: true, comment: null };
  }
  if (Array.from(comment).length > COMMENT_MAX_LENGTH) {
    return {
      ok: false,
      error: `Comment must be at most ${COMMENT_MAX_LENGTH} characters`,
    };
  }
  return { ok: true, comment };
}

export const getNextAnnotation = async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (userId === null) return;
  const selected = await selectNextAnnotationScenario(userId);
  const count = await contributionCount(userId);
  if (!selected) {
    return res.status(200).json({ scenario: null, contributionCount: count });
  }
  const scenario = parseAnnotationScenario(
    selected.decisionType,
    selected.state,
    selected.stateHash,
  );
  return res.status(200).json({
    scenario: {
      id: selected.id,
      code: selected.code,
      stateHash: selected.stateHash,
      decisionType: scenario.decisionType,
      ...scenario.state,
    },
    contributionCount: count,
  });
};

export const upsertAnnotationResponse = async (
  req: Request,
  res: Response,
) => {
  const userId = requireUserId(req, res);
  if (userId === null) return;
  const {
    scenarioId,
    scenarioHash,
    selectedAction,
    skipped,
    comment,
    perceivedDifficulty,
    responseTimeMs,
  } = req.body ?? {};
  if (
    !Number.isInteger(scenarioId) ||
    scenarioId < 1 ||
    typeof scenarioHash !== "string"
  ) {
    return res.status(400).json({ error: "Invalid scenario identity" });
  }
  if (
    typeof skipped !== "boolean" ||
    !isAnnotationDifficulty(perceivedDifficulty) ||
    !Number.isInteger(responseTimeMs) ||
    responseTimeMs < 0 ||
    responseTimeMs > RESPONSE_TIME_MAX_MS
  ) {
    return res.status(400).json({ error: "Invalid response metadata" });
  }
  const commentResult = validatedComment(comment);
  if (!commentResult.ok) {
    return res.status(400).json({ error: commentResult.error });
  }
  if (!skipped && commentResult.comment !== null) {
    return res
      .status(400)
      .json({ error: "Only a skipped response may include a comment" });
  }

  const scenario = await prisma.annotationScenario.findUnique({
    where: { id: scenarioId },
    select: {
      id: true,
      decisionType: true,
      state: true,
      stateHash: true,
    },
  });
  if (!scenario || scenario.stateHash !== scenarioHash) {
    return res.status(409).json({ error: "Scenario identity is stale" });
  }
  const parsedScenario = parseAnnotationScenario(
    scenario.decisionType,
    scenario.state,
    scenario.stateHash,
  );

  let action: AnnotationSelectedAction | null = null;
  if (skipped) {
    if (selectedAction !== null) {
      return res
        .status(400)
        .json({ error: "A skipped response cannot select an action" });
    }
  } else {
    try {
      action = parseAnnotationSelectedAction(selectedAction);
    } catch {
      return res.status(400).json({ error: "A selected action is required" });
    }
    if (!isAnnotationActionLegal(parsedScenario, action)) {
      return res
        .status(400)
        .json({ error: "Selected action is not legal for this scenario" });
    }
  }

  const data = {
    scenarioHash: scenario.stateHash,
    selectedSuit: action?.decisionType === "play_card" ? action.suit : null,
    selectedValue: action?.decisionType === "play_card" ? action.value : null,
    selectedSignal:
      action?.decisionType === "play_card" ? action.signal : null,
    selectedBriscola:
      action?.decisionType === "choose_briscola" ? action.suit : null,
    skipped,
    comment: commentResult.comment,
    perceivedDifficulty,
    responseTimeMs,
  };
  await prisma.expertAnnotation.upsert({
    where: { userId_scenarioId: { userId, scenarioId: scenario.id } },
    create: { userId, scenarioId: scenario.id, ...data },
    update: data,
  });
  return res.status(200).json({
    contributionCount: await contributionCount(userId),
  });
};
