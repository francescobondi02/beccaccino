from __future__ import annotations

import pytest
import torch

from evaluation.arena import EVAL_SEED_BASE, GameRecord, MirroredDealRecord
from evaluation.stats import wilson_interval
from scripts import score_checkpoints
from scripts.score_checkpoints import CheckpointScore


def test_heldout_seed_base_is_one_million_past_eval_block():
    assert score_checkpoints.HELDOUT_SEED_BASE == EVAL_SEED_BASE + 1_000_000


def test_evaluate_mirrored_reuses_deals_with_swapped_teams(monkeypatch):
    candidate = object()
    baseline = object()
    calls = []

    def leg(seed, candidate_team, winner_team):
        return GameRecord(
            seed=seed,
            candidate_team=candidate_team,
            winner_team=winner_team,
            initial_caller=0,
            initial_briscola="denara",
            rounds=1,
            actions=40,
            candidate_signals=0,
            opponent_signals=0,
            final_scores=(123, 100),
        )

    records = [
        MirroredDealRecord(123, leg(123, 0, 0), leg(123, 1, 0)),
        MirroredDealRecord(124, leg(124, 0, 0), leg(124, 1, 0)),
        MirroredDealRecord(125, leg(125, 0, 0), leg(125, 1, 1)),
        MirroredDealRecord(126, leg(126, 0, 1), leg(126, 1, 1)),
    ]

    def fake_iter(candidate_factory, baseline_factory, *, num_deals, seed, win_points):
        calls.append((candidate_factory(seed), baseline_factory(seed), num_deals, win_points, seed))
        return iter(records)

    monkeypatch.setattr(score_checkpoints, "iter_mirrored_deals", fake_iter)

    wins, games, paired_scores = score_checkpoints.evaluate_mirrored(
        candidate, baseline, games=4, seed=123
    )

    assert (wins, games) == (5, 8)
    assert paired_scores == (0.5, 0.5, 1.0, 0.5)
    assert calls == [(candidate, baseline, 4, 41, 123)]


def test_evaluate_mirrored_rejects_non_positive_games():
    with pytest.raises(ValueError, match="games must be positive"):
        score_checkpoints.evaluate_mirrored(object(), object(), games=0)


def test_score_checkpoints_loads_helpers_and_scores_each_path(monkeypatch):
    loaded = []
    built = []
    evaluated = []

    def fake_load(path, map_location):
        loaded.append((path, map_location))
        return {"path": path}

    def fake_build(checkpoint, device):
        built.append((checkpoint, device))
        return f"net:{checkpoint['path']}"

    class FakeNeuralAgent:
        def __init__(self, net, device, temperature):
            self.net = net
            self.device = device
            self.temperature = temperature

    class FakeHeuristicAgent:
        def __init__(self, seed):
            self.seed = seed

    def fake_evaluate(candidate, baseline, *, games):
        evaluated.append((candidate, baseline, games))
        wins = 7 if candidate.net.endswith("best.pt") else 5
        return wins, 10, tuple([wins / 10] * games)

    monkeypatch.setattr(score_checkpoints, "load_checkpoint", fake_load)
    monkeypatch.setattr(score_checkpoints, "build_net", fake_build)
    monkeypatch.setattr(score_checkpoints, "NeuralAgent", FakeNeuralAgent)
    monkeypatch.setattr(score_checkpoints, "HeuristicAgent", FakeHeuristicAgent)
    monkeypatch.setattr(score_checkpoints, "evaluate_mirrored", fake_evaluate)

    results = score_checkpoints.score_checkpoints(["best.pt", "last.pt"], games=5, device="cpu")

    cpu = torch.device("cpu")
    assert loaded == [("best.pt", cpu), ("last.pt", cpu)]
    assert built == [({"path": "best.pt"}, cpu), ({"path": "last.pt"}, cpu)]
    assert [result.wins for result in results] == [7, 5]
    assert all(result.games == 10 for result in results)
    assert all(call[1].seed == score_checkpoints.HELDOUT_SEED_BASE + 10_000 for call in evaluated)
    assert all(call[2] == 5 for call in evaluated)


def test_checkpoint_score_uses_wilson_95_interval():
    result = CheckpointScore("best.pt", wins=7, games=10)
    assert result.win_rate == 0.7
    assert result.interval == wilson_interval(7, 10)
    assert "Wilson 95% CI" in score_checkpoints.format_score(result)


def test_checkpoint_score_uses_paired_deal_interval_when_available():
    result = CheckpointScore(
        "best.pt",
        wins=5,
        games=8,
        paired_scores=(0.5, 0.5, 1.0, 0.5),
    )
    assert result.win_rate == 0.625
    assert result.interval == score_checkpoints.paired_mean_interval(result.paired_scores)
    assert "paired 95% CI" in score_checkpoints.format_score(result)


def test_verdict_selects_known_stronger_result():
    results = [
        CheckpointScore(
            "weaker.pt",
            wins=0,
            games=8,
            paired_scores=(0.0, 0.0, 0.0, 0.0),
        ),
        CheckpointScore(
            "stronger.pt",
            wins=8,
            games=8,
            paired_scores=(1.0, 1.0, 1.0, 1.0),
        ),
    ]
    assert score_checkpoints.verdict(results) == (
        "VERDICT: ship stronger.pt (100.00%; paired lead is positive at 95%)"
    )


def test_verdict_reports_tied_paths_in_deterministic_order():
    results = [
        CheckpointScore("z.pt", wins=7, games=10),
        CheckpointScore("a.pt", wins=7, games=10),
    ]
    assert score_checkpoints.verdict(results) == "VERDICT: tie at 70.00%: a.pt, z.pt"


def test_verdict_is_inconclusive_when_paired_lead_crosses_zero():
    results = [
        CheckpointScore(
            "leader.pt",
            wins=5,
            games=8,
            paired_scores=(1.0, 0.5, 0.5, 0.5),
        ),
        CheckpointScore(
            "other.pt",
            wins=4,
            games=8,
            paired_scores=(0.0, 1.0, 0.5, 0.5),
        ),
    ]
    assert score_checkpoints.verdict(results).startswith(
        "VERDICT: inconclusive; leader.pt vs other.pt"
    )


def test_main_prints_results_and_verdict(monkeypatch, capsys):
    results = [
        CheckpointScore(
            "best.pt",
            wins=20,
            games=20,
            paired_scores=tuple([1.0] * 10),
        ),
        CheckpointScore(
            "last.pt",
            wins=0,
            games=20,
            paired_scores=tuple([0.0] * 10),
        ),
    ]

    monkeypatch.setattr(score_checkpoints, "score_checkpoints", lambda *args, **kwargs: results)

    score_checkpoints.main(["best.pt", "last.pt", "--games", "10"])

    output = capsys.readouterr().out
    assert (
        f"Held-out seeds {score_checkpoints.HELDOUT_SEED_BASE}"
        f"..{score_checkpoints.HELDOUT_SEED_BASE + 9}; 10 mirrored deals (20 games), wp=41"
        in output
    )
    assert "best.pt: 20/20 wins (100.00%); paired 95% CI" in output
    assert "VERDICT: ship best.pt" in output


def test_main_runs_direct_champion_protocol(monkeypatch, capsys, tmp_path):
    class Summary:
        wins = 1_300
        games = 2_000
        win_rate = 0.65
        paired_interval = (0.61, 0.69)
        decision = "promote"

    calls = []

    def fake_select(candidate, incumbent, **kwargs):
        calls.append((candidate, incumbent, kwargs))
        return Summary()

    monkeypatch.setattr(score_checkpoints, "select_champion", fake_select)
    output = tmp_path / "score.jsonl"
    score_checkpoints.main(
        [
            "--candidate",
            "candidate.pt",
            "--incumbent",
            "champion.pt",
            "--protocol-id",
            "gate-1",
            "--seed-base",
            "88000000",
            "--output",
            str(output),
        ]
    )

    assert calls == [
        (
            "candidate.pt",
            "champion.pt",
            {
                "protocol_id": "gate-1",
                "seed_base": 88_000_000,
                "output": str(output),
                "games": 1_000,
                "device": "cpu",
            },
        )
    ]
    assert "DECISION: promote" in capsys.readouterr().out


def test_main_rejects_partial_champion_protocol():
    with pytest.raises(SystemExit, match="required together"):
        score_checkpoints.main(["--candidate", "candidate.pt"])
