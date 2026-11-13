export const ANNOTATION_DIFFICULTIES = [
  { value: "easy", label: "Facile" },
  { value: "medium", label: "Media" },
  { value: "hard", label: "Difficile" },
] as const;

export type AnnotationDifficulty =
  (typeof ANNOTATION_DIFFICULTIES)[number]["value"];
