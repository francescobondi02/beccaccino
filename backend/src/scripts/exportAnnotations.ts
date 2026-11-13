import { createHmac } from "crypto";
import { ExpertAnnotation, PrismaClient } from "@prisma/client";
import {
  isAnnotationDifficulty,
  isAnnotationImportance,
  isAnnotationTag,
} from "../annotations/constants";
import { isAnnotationActionLegal } from "../annotations/action";
import { parseAnnotationScenario } from "../annotations/state";
import { annotationColumnsToAction } from "../annotations/responseCodec";

type ExportableAnnotation = Pick<
  ExpertAnnotation,
  | "userId"
  | "scenarioId"
  | "scenarioHash"
  | "selectedSuit"
  | "selectedValue"
  | "selectedSignal"
  | "selectedBriscola"
  | "skipped"
  | "comment"
  | "perceivedDifficulty"
  | "responseTimeMs"
  | "createdAt"
  | "updatedAt"
> & {
  scenario: {
    code: string;
    decisionType: string;
    predictedDifficulty: string;
    importance: number;
    tags: string[];
    state: unknown;
    stateHash: string;
    sourceBatch: string;
  };
};

function pseudonymFor(userId: number, salt: string): string {
  if (salt.length < 16) {
    throw new Error(
      "ANNOTATION_EXPORT_SALT must contain at least 16 characters",
    );
  }
  return createHmac("sha256", salt)
    .update(`expert-user:${userId}`)
    .digest("hex");
}

export function annotationExportRecord(
  annotation: ExportableAnnotation,
  salt: string,
) {
  if (
    annotation.scenarioHash !== annotation.scenario.stateHash ||
    !isAnnotationDifficulty(annotation.scenario.predictedDifficulty) ||
    !isAnnotationDifficulty(annotation.perceivedDifficulty) ||
    !isAnnotationImportance(annotation.scenario.importance) ||
    annotation.scenario.tags.length === 0 ||
    !annotation.scenario.tags.every(isAnnotationTag)
  ) {
    throw new Error(
      `annotation references invalid scenario ${annotation.scenarioId}`,
    );
  }
  const parsedScenario = parseAnnotationScenario(
    annotation.scenario.decisionType,
    annotation.scenario.state,
    annotation.scenario.stateHash,
  );
  const selectedAction = annotationColumnsToAction({
    decisionType: parsedScenario.decisionType,
    skipped: annotation.skipped,
    columns: {
      selectedSuit: annotation.selectedSuit,
      selectedValue: annotation.selectedValue,
      selectedSignal: annotation.selectedSignal,
      selectedBriscola: annotation.selectedBriscola,
    },
  });
  if (
    selectedAction &&
    !isAnnotationActionLegal(parsedScenario, selectedAction)
  ) {
    throw new Error("annotation contains an illegal selected action");
  }

  const {
    userId,
    selectedSuit: _selectedSuit,
    selectedValue: _selectedValue,
    selectedSignal: _selectedSignal,
    selectedBriscola: _selectedBriscola,
    scenario,
    ...response
  } = annotation;
  return {
    annotatorPseudonym: pseudonymFor(userId, salt),
    ...response,
    scenario: {
      id: annotation.scenarioId,
      code: scenario.code,
      decisionType: parsedScenario.decisionType,
      stateHash: scenario.stateHash,
      predictedDifficulty: scenario.predictedDifficulty,
      importance: scenario.importance,
      tags: scenario.tags,
      sourceBatch: scenario.sourceBatch,
      ...parsedScenario.state,
    },
    selectedAction,
  };
}

export async function annotationExportRecords(
  prisma: PrismaClient,
  salt: string,
) {
  const annotations = await prisma.expertAnnotation.findMany({
    orderBy: [{ userId: "asc" }, { scenarioId: "asc" }],
    include: {
      scenario: {
        select: {
          code: true,
          decisionType: true,
          predictedDifficulty: true,
          importance: true,
          tags: true,
          state: true,
          stateHash: true,
          sourceBatch: true,
        },
      },
    },
  });

  // Validate the complete dataset before writing the first line.
  return annotations.map((annotation) =>
    annotationExportRecord(annotation, salt),
  );
}
