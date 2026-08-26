"""Stable vocabulary and method versions for annotation scenario batches."""

ANNOTATION_DIFFICULTIES = ("easy", "medium", "hard")

ANNOTATION_TAGS = (
    "lead",
    "must_follow",
    "void",
    "partner_winning",
    "high_value_trick",
    "late_round",
    "score_pressure",
    "signal_decision",
)

IMPORTANCE_STANDARD = 1
IMPORTANCE_USEFUL_UNCOMMON = 2
IMPORTANCE_CURATED_CORNER_CASE = 3
ANNOTATION_IMPORTANCE_VALUES = (
    IMPORTANCE_STANDARD,
    IMPORTANCE_USEFUL_UNCOMMON,
    IMPORTANCE_CURATED_CORNER_CASE,
)

TARGET_DIFFICULTY_MIX = {
    "easy": 0.2,
    "medium": 0.4,
    "hard": 0.4,
}

MIN_CURATED_CORNER_SHARE = 0.05

RULES_VERSION = "becca-annotation-rules-v1"
METHOD_VERSION = "offline-hmac-priority-structural-margin-v1"
