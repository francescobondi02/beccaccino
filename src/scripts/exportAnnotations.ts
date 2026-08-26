import { createHmac } from "crypto";
import { ExpertAnnotation, PrismaClient } from "@prisma/client";
import {
  isAnnotationDifficulty,
  isAnnotationImportance,
  isAnnotationTag,
} from "../annotations/constants";
import { isCardSignal } from "../domain/cards";
import {
  AnnotationAction,
  parseAnnotationScenarioState,
} from "../annotations/scenario";

type ExportableAnnotation = Pick<
  ExpertAnnotation,
  | "userId"
  | "scenarioId"
  | "scenarioHash"
  | "selectedSuit"
  | "selectedValue"
  | "selectedSignal"
  | "skipped"
  | "comment"
  | "perceivedDifficulty"
  | "responseTimeMs"
  | "createdAt"
  | "updatedAt"
> & {
  scenario: {
    code: string;
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
): AnnotationAction | null {
  const { selectedSuit, selectedValue, selectedSignal } = annotation;
  if (annotation.skipped) {
    if (selectedSuit || selectedValue || selectedSignal) {
      throw new Error("skipped annotation selects an action");
    }
    return null;
  }
  if (!selectedSuit || !selectedValue) {
    throw new Error("non-skipped annotation is missing its selected card");
  }
  if (selectedSignal !== null && !isCardSignal(selectedSignal)) {
    throw new Error("annotation contains an invalid selected signal");
  }
  return {
    suit: selectedSuit,
    value: selectedValue,
    signal: selectedSignal as AnnotationAction["signal"],
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
  const state = parseAnnotationScenarioState(
    annotation.scenario.state,
    annotation.scenario.stateHash,
  );
  const selectedAction = selectedActionFor(annotation);
  if (
    selectedAction &&
    !state.legalActions.some(
      (legal) =>
        legal.suit === selectedAction.suit &&
        legal.value === selectedAction.value &&
        legal.signal === selectedAction.signal,
    )
  ) {
    throw new Error("annotation contains an illegal selected action");
  }

  const {
    userId,
    selectedSuit: _selectedSuit,
    selectedValue: _selectedValue,
    selectedSignal: _selectedSignal,
    scenario,
    ...response
  } = annotation;
  return {
    annotatorPseudonym: pseudonymFor(userId, salt),
    ...response,
    scenario: {
      id: annotation.scenarioId,
      code: scenario.code,
      stateHash: scenario.stateHash,
      predictedDifficulty: scenario.predictedDifficulty,
      importance: scenario.importance,
      tags: scenario.tags,
      sourceBatch: scenario.sourceBatch,
      ...state,
    },
    selectedAction,
  };
}

async function main() {
  const salt = process.env.ANNOTATION_EXPORT_SALT;
  if (!salt) {
    throw new Error("ANNOTATION_EXPORT_SALT must contain at least 16 characters");
  }
  const prisma = new PrismaClient({ log: [] });
  try {
    const annotations = await prisma.expertAnnotation.findMany({
      orderBy: [{ userId: "asc" }, { scenarioId: "asc" }],
      include: {
        scenario: {
          select: {
            code: true,
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
    const records = annotations.map((annotation) =>
      annotationExportRecord(annotation, salt),
    );
    for (const record of records) {
      process.stdout.write(`${JSON.stringify(record)}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Annotation export failed: ${message}\n`);
    process.exitCode = 1;
  });
}
