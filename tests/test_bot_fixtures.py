"""Keep the committed cross-language fixtures trustworthy.

The backend asserts its serializer against `serving/fixtures/bot_states.json`. If
the encoder or the wire format changes and the file is not regenerated, that
backend test starts checking a contract we no longer honour — so verify here that
the committed file still matches what the current code produces.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from becca_env.observation import OBS_SIZE, encode_observation
from scripts.gen_bot_fixtures import FIXTURE_PATH, build_cases
from serving.state_adapter import state_dict_to_game

pytestmark = pytest.mark.skipif(
    not FIXTURE_PATH.exists(), reason="fixtures not generated; run scripts.gen_bot_fixtures"
)


@pytest.fixture(scope="module")
def committed_cases() -> list[dict]:
    return json.loads(FIXTURE_PATH.read_text())["cases"]


def test_committed_fixtures_are_up_to_date(committed_cases):
    """Regenerating must be a no-op. If this fails, run scripts.gen_bot_fixtures."""
    assert committed_cases == build_cases()


def test_every_fixture_state_encodes_to_its_expected_obs(committed_cases):
    for case in committed_cases:
        game = state_dict_to_game(case["state"])
        actual = encode_observation(game, case["seat"])
        np.testing.assert_array_equal(
            actual, np.array(case["expected_obs"], dtype=np.float32), err_msg=case["name"]
        )
        assert len(case["expected_obs"]) == OBS_SIZE


def test_fixtures_cover_the_blocks_the_runtime_gate_cannot(committed_cases):
    """Legality checks miss scores, signals, voids and multi-trick history.

    Without coverage here those blocks are unprotected, so assert the fixture set
    actually exercises them rather than trusting the generator's intent.
    """
    states = [c["state"] for c in committed_cases]

    assert any(s["total_scores"] != {"0": 0, "1": 0} for s in states), "no non-zero scores"
    assert any(len(s["completed_tricks"]) >= 2 for s in states), "no multi-trick round"
    assert any(
        t["signal"] for s in states for t in s["completed_tricks"]
    ), "no declared signal"
    assert {c["seat"] for c in committed_cases} == {0, 1, 2, 3}, "not all seats viewed"
