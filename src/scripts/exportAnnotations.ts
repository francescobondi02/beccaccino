import { createHmac } from "crypto";
import { ExpertAnnotation, PrismaClient } from "@prisma/client";
import {
  isAnnotationDifficulty,
  isAnnotationImportance,
  isAnnotationTag,
} from "../annotations/constants";
import { isCardSignal } from "../domain/cards";
import {
  AnnotationPlayCardAction,
  AnnotationSelectedAction,
  isAnnotationActionLegal,
  parseAnnotationScenario,
} from "../annotations/scenario";

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

function selectedActionFor(
  annotation: ExportableAnnotation,
  decisionType: string,
): AnnotationSelectedAction | null {
  const {
    selectedSuit,
    selectedValue,
    selectedSignal,
    selectedBriscola,
  } = annotation;
  if (annotation.skipped) {
    if (
      selectedSuit !== null ||
      selectedValue !== null ||
      selectedSignal !== null ||
      selectedBriscola !== null
    ) {
      throw new Error("skipped annotation selects an action");
    }
    return null;
  }
  if (decisionType === "choose_briscola") {
    if (
      selectedBriscola === null ||
      selectedSuit !== null ||
      selectedValue !== null ||
      selectedSignal !== null
    ) {
      throw new Error(
        "briscola annotation contains mismatched selected action columns",
      );
    }
    return {
      decisionType: "choose_briscola",
      suit: selectedBriscola,
    };
  }
  if (
    decisionType !== "play_card" ||
    selectedSuit === null ||
    selectedValue === null ||
    selectedBriscola !== null
  ) {
    throw new Error("card annotation contains mismatched selected action columns");
  }
  if (selectedSignal !== null && !isCardSignal(selectedSignal)) {
    throw new Error("annotation contains an invalid selected signal");
  }
  return {
    decisionType: "play_card",
    suit: selectedSuit,
    value: selectedValue,
    signal: selectedSignal as AnnotationPlayCardAction["signal"],
  };
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
  const selectedAction = selectedActionFor(
    annotation,
    parsedScenario.decisionType,
  );
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
