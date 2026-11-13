"""Validate a persisted NearPerfect-v1 evidence manifest."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from evaluation.near_perfect import evaluate_near_perfect, load_evidence


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", help="Path to the predeclared evidence JSON")
    args = parser.parse_args(argv)

    result = evaluate_near_perfect(load_evidence(args.evidence))
    print(json.dumps(asdict(result), indent=2))
    return 0 if result.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
