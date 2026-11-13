"""Export a selected training checkpoint as a small serving artifact."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from serving.artifact import export_inference_artifact

DEFAULT_OUTPUT = Path("serving/models/run_d2_champion.pt")
DEFAULT_SELECTION_PROTOCOL = "runD2-winner-vs-runC-20260825"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Selected full training checkpoint")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--selection-protocol", default=DEFAULT_SELECTION_PROTOCOL)
    args = parser.parse_args(argv)

    digest = export_inference_artifact(
        args.source,
        args.output,
        selection_protocol=args.selection_protocol,
    )
    print(f"wrote {args.output} ({digest})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
