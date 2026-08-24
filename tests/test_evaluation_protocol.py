from __future__ import annotations

import json

import pytest

from evaluation.arena import GameRecord, MirroredDealRecord, iter_mirrored_deals
from evaluation.protocol import MIN_CHAMPION_DEALS, summarize_champion, write_score_jsonl


class FirstLegalAgent:
    def select_action(self, game, seat):
        return game.legal_actions()[0]


def _leg(
    seed: int,
    candidate_team: int,
    winner_team: int,
    *,
    caller: int = 0,
    briscola: str = "denara",
) -> GameRecord:
    return GameRecord(
        seed=seed,
        candidate_team=candidate_team,
        winner_team=winner_team,
        initial_caller=caller,
        initial_briscola=briscola,
        rounds=2,
        actions=81,
        candidate_signals=1,
        opponent_signals=2,
        final_scores=(123, 117),
    )


def _deal(seed: int, candidate_wins: bool = True) -> MirroredDealRecord:
    return MirroredDealRecord(
        seed=seed,
        candidate_team0=_leg(seed, 0, 0 if candidate_wins else 1, caller=0),
        candidate_team1=_leg(seed, 1, 1 if candidate_wins else 0, caller=1),
    )


def test_iter_mirrored_deals_reuses_seed_and_swaps_candidate_side():
    records = list(
        iter_mirrored_deals(
            lambda _: FirstLegalAgent(),
            lambda _: FirstLegalAgent(),
            num_deals=2,
            seed=700,
            win_points=5,
        )
    )

    assert [record.seed for record in records] == [700, 701]
    assert records[0].candidate_team0.candidate_team == 0
    assert records[0].candidate_team1.candidate_team == 1
    assert records[0].candidate_team0.seed == records[0].candidate_team1.seed == 700
    assert records[0].candidate_team0.initial_briscola
    assert records[0].candidate_team0.actions > 0


def test_champion_summary_requires_predeclared_minimum_for_promotion():
    short = summarize_champion([_deal(seed) for seed in range(10)])
    assert short.decision.startswith("insufficient")

    complete = summarize_champion([_deal(seed) for seed in range(MIN_CHAMPION_DEALS)])
    assert complete.decision == "promote"
    assert complete.paired_interval == (1.0, 1.0)


def test_champion_summary_rejects_duplicate_seeds():
    with pytest.raises(ValueError, match="duplicate deal seeds"):
        summarize_champion([_deal(1), _deal(1)])


def test_score_jsonl_is_per_deal_hashed_and_non_overwritable(tmp_path):
    candidate = tmp_path / "candidate.pt"
    incumbent = tmp_path / "incumbent.pt"
    candidate.write_bytes(b"candidate")
    incumbent.write_bytes(b"incumbent")
    output = tmp_path / "score.jsonl"
    records = [_deal(900), _deal(901, candidate_wins=False)]

    summary = write_score_jsonl(
        output,
        protocol_id="champion-2026-08-24",
        candidate_path=candidate,
        incumbent_path=incumbent,
        seed_base=900,
        win_points=41,
        records=records,
    )
    rows = [json.loads(line) for line in output.read_text().splitlines()]
    assert [row["type"] for row in rows] == ["manifest", "deal", "deal", "summary"]
    assert rows[0]["candidate_sha256"] != rows[0]["incumbent_sha256"]
    assert rows[1]["seed"] == 900
    assert len(rows[1]["legs"]) == 2
    assert rows[-1]["slices"].keys() >= {
        "candidate_team",
        "initial_caller_seat",
        "caller_role",
        "briscola",
        "signals",
        "game_length",
    }
    assert summary.decision.startswith("insufficient")

    with pytest.raises(FileExistsError):
        write_score_jsonl(
            output,
            protocol_id="reused",
            candidate_path=candidate,
            incumbent_path=incumbent,
            seed_base=900,
            win_points=41,
            records=records,
        )


def test_score_jsonl_rejects_seed_manifest_mismatch(tmp_path):
    candidate = tmp_path / "candidate.pt"
    incumbent = tmp_path / "incumbent.pt"
    candidate.write_bytes(b"candidate")
    incumbent.write_bytes(b"incumbent")

    with pytest.raises(ValueError, match="declared contiguous seed block"):
        write_score_jsonl(
            tmp_path / "score.jsonl",
            protocol_id="mismatch",
            candidate_path=candidate,
            incumbent_path=incumbent,
            seed_base=100,
            win_points=41,
            records=[_deal(101)],
        )
