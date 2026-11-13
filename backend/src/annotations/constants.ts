export const ANNOTATION_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type AnnotationDifficulty = (typeof ANNOTATION_DIFFICULTIES)[number];

export const ANNOTATION_TAGS = [
  "lead",
  "must_follow",
  "void",
  "partner_winning",
  "high_value_trick",
  "late_round",
  "score_pressure",
  "signal_decision",
  "borderline_briscola",
  "risk",
] as const;
export type AnnotationTag = (typeof ANNOTATION_TAGS)[number];

export const ANNOTATION_IMPORTANCE = {
  standard: 1,
  useful: 2,
  cornerCase: 3,
} as const;
export type AnnotationImportance =
  (typeof ANNOTATION_IMPORTANCE)[keyof typeof ANNOTATION_IMPORTANCE];

// Tie order starts at medium so a new expert does not begin at an extreme.
export const ANNOTATION_DIFFICULTY_TARGETS: ReadonlyArray<{
  difficulty: AnnotationDifficulty;
  share: number;
}> = [
  { difficulty: "medium", share: 0.4 },
  { difficulty: "hard", share: 0.4 },
  { difficulty: "easy", share: 0.2 },
];

export function isAnnotationDifficulty(
  value: unknown,
): value is AnnotationDifficulty {
  return ANNOTATION_DIFFICULTIES.some((difficulty) => difficulty === value);
}

export function isAnnotationTag(value: unknown): value is AnnotationTag {
  return ANNOTATION_TAGS.some((tag) => tag === value);
}

export function isAnnotationImportance(
  value: unknown,
): value is AnnotationImportance {
  return (
    Number.isInteger(value) &&
    Object.values(ANNOTATION_IMPORTANCE).some((importance) => importance === value)
  );
}
