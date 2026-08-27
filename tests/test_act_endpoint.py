"""Tests for POST /act — the endpoint the game backend calls to move a bot.

Covers the request contract, the legal-move disagreement gate, and — most
importantly — that real checkpoints can actually play a legal game end to end.
"""

from __future__ import annotations

import time

import pytest

# Serving deps (fastapi) live in the [serve] extra, not [dev].
pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

import serving.app as serving_app  # noqa: E402
from becca_env.deck import Card, Suit, Value  # noqa: E402
from becca_env.game import BeccaGame, GamePhase, Signal  # noqa: E402
from serving.app import BOT_SERVICE_TOKEN_ENV, app  # noqa: E402
from serving.state_adapter import game_to_state_dict  # noqa: E402
from serving.tiers import TIERS, TierUnavailableError, available_tiers  # noqa: E402

# Esperto runs PIMC search; the design budgets well under a second per move and
# the point of the bound is to catch an accidental net-rollout config (~39 s).
ESPERTO_MAX_SECONDS = 5.0
TEST_TOKEN = "test-bot-token"

NEURAL_TIERS = ["facile", "forte"]

# Forte and esperto ship the promoted model. Historical checkpoints remain
# optional, so tests for tiers such as facile skip when their artifact is absent.
AVAILABLE_TIERS = {t.name for t in available_tiers()}


def needs_checkpoint(tier: str):
    return pytest.mark.skipif(
        tier not in AVAILABLE_TIERS,
        reason=f"tier {tier!r} needs a checkpoint file not present in this clone",
    )


def tier_params(names):
    return [pytest.param(name, marks=needs_checkpoint(name)) for name in names]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv(BOT_SERVICE_TOKEN_ENV, TEST_TOKEN)
    with TestClient(app) as test_client:
        yield test_client


def _act(client, game: BeccaGame, tier: str, **overrides):
    seat = game.current_seat
    body = {"state": game_to_state_dict(game, seat), "seat": seat, "tier": tier}
    body.update(overrides)
    return client.post(
        "/act",
        json=body,
        headers={"Authorization": f"Bearer {TEST_TOKEN}"},
    )


def _apply(game: BeccaGame, move: dict) -> None:
    """Apply an /act response to a game, the way the backend would."""
    if move["kind"] == "briscola":
        game.step(Suit(move["suit"]))
        return

    card = Card(Suit(move["suit"]), Value(move["value"]))
    if game.round.current_trick:
        game.step(card)
    else:
        signal = Signal(move["signal"]) if move["signal"] else None
        game.step((card, signal))


def test_tiers_endpoint_lists_available_tiers(client):
    names = [t["name"] for t in client.get("/tiers").json()]
    assert names == [t.name for t in available_tiers()]


def test_removed_predict_contract_returns_404(client):
    assert client.post("/predict", json={}).status_code == 404


def test_health_reports_loaded_model_without_authentication(client, monkeypatch):
    monkeypatch.setenv(BOT_SERVICE_TOKEN_ENV, "secret")

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "model": "ready",
        "tier": "forte",
    }


def test_version_reports_render_commit_without_authentication(client, monkeypatch):
    monkeypatch.setenv("RENDER_GIT_COMMIT", "render-commit")
    monkeypatch.setenv("GIT_COMMIT_SHA", "explicit-commit")

    response = client.get("/version")

    assert response.status_code == 200
    assert response.json() == {
        "service": "ai",
        "commit": "render-commit",
    }


def test_version_supports_explicit_commit_outside_render(client, monkeypatch):
    monkeypatch.delenv("RENDER_GIT_COMMIT", raising=False)
    monkeypatch.setenv("GIT_COMMIT_SHA", "explicit-commit")

    response = client.get("/version")

    assert response.status_code == 200
    assert response.json() == {
        "service": "ai",
        "commit": "explicit-commit",
    }


def test_ready_requires_configured_bearer_token(client, monkeypatch):
    monkeypatch.setenv(BOT_SERVICE_TOKEN_ENV, "secret")

    missing = client.get("/ready?tier=forte")
    wrong = client.get(
        "/ready?tier=forte",
        headers={"Authorization": "Bearer wrong"},
    )
    correct = client.get(
        "/ready?tier=forte",
        headers={"Authorization": "Bearer secret"},
    )

    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert correct.status_code == 200
    assert correct.json() == {
        "status": "ok",
        "model": "ready",
        "tier": "forte",
    }


def test_act_requires_configured_bearer_token(client, monkeypatch):
    monkeypatch.setenv(BOT_SERVICE_TOKEN_ENV, "secret")
    game = BeccaGame(seed=10)
    body = {
        "state": game_to_state_dict(game, game.current_seat),
        "seat": game.current_seat,
        "tier": "forte",
    }

    missing = client.post("/act", json=body)
    wrong = client.post("/act", json=body, headers={"Authorization": "Bearer wrong"})
    correct = client.post("/act", json=body, headers={"Authorization": "Bearer secret"})

    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert correct.status_code == 200


@pytest.mark.parametrize("token", [None, ""])
def test_startup_requires_nonempty_token(monkeypatch, token):
    if token is None:
        monkeypatch.delenv(BOT_SERVICE_TOKEN_ENV, raising=False)
    else:
        monkeypatch.setenv(BOT_SERVICE_TOKEN_ENV, token)

    with pytest.raises(RuntimeError, match="must be set and not empty"), TestClient(app):
        pass


def test_ready_rejects_unknown_tier(client):
    response = client.get(
        "/ready?tier=impossibile",
        headers={"Authorization": f"Bearer {TEST_TOKEN}"},
    )

    assert response.status_code == 422
    assert "unknown tier" in response.json()["detail"]


def test_ready_rejects_unavailable_tier(client, monkeypatch):
    def unavailable(_: str):
        raise TierUnavailableError("checkpoint missing")

    monkeypatch.setattr(serving_app, "get_agent", unavailable)

    response = client.get(
        "/ready?tier=facile",
        headers={"Authorization": f"Bearer {TEST_TOKEN}"},
    )

    assert response.status_code == 503
    assert "facile" in response.json()["detail"]


@pytest.mark.parametrize("tier", tier_params(sorted(TIERS)))
def test_every_tier_chooses_a_legal_briscola(client, tier):
    game = BeccaGame(seed=11)
    assert game.phase == GamePhase.CHOOSE_BRISCOLA

    response = _act(client, game, tier)
    assert response.status_code == 200, response.text

    move = response.json()
    assert move["kind"] == "briscola"
    assert Suit(move["suit"]) in game.legal_actions()


@pytest.mark.parametrize("tier", tier_params(NEURAL_TIERS))
def test_bot_plays_a_legal_card_from_its_own_hand(client, tier):
    game = BeccaGame(seed=12)
    game.step(Suit.DENARA)

    seat = game.current_seat
    response = _act(client, game, tier)
    assert response.status_code == 200, response.text

    move = response.json()
    card = Card(Suit(move["suit"]), Value(move["value"]))
    assert card in game.round.player_hands[seat]


@pytest.mark.parametrize("tier", tier_params(NEURAL_TIERS))
def test_bot_completes_a_full_round_legally(client, tier):
    """The real diagnostic: a bot drives every seat through 10 tricks.

    Every move goes back through `game.step`, which raises on an illegal card —
    so finishing the round IS the legality assertion.
    """
    game = BeccaGame(seed=13)
    signals_declared = []

    while game.round.number == 1 and game.phase != GamePhase.GAME_OVER:
        response = _act(client, game, tier)
        assert response.status_code == 200, response.text
        move = response.json()
        if move.get("signal"):
            signals_declared.append(move["signal"])
        _apply(game, move)

    assert len(game.round.hands_played) == 10 or game.round.number > 1
    # Not asserted: that signals ARE used. Whether the policy signals at all is
    # the open question this feature exists to answer, not a precondition.
    assert all(s in {sig.value for sig in Signal} for s in signals_declared)


@needs_checkpoint("forte")
def test_follower_never_receives_a_signal(client):
    """Only the trick leader may signal; a follower move must carry none."""
    game = BeccaGame(seed=14)
    game.step(Suit.DENARA)
    _apply(game, _act(client, game, "forte").json())  # leader plays

    assert game.round.current_trick, "expected an in-progress trick"
    move = _act(client, game, "forte").json()
    assert move["signal"] is None


def test_wrong_seat_returns_409(client):
    game = BeccaGame(seed=15)
    wrong_seat = (game.current_seat + 1) % 4

    response = _act(client, game, "forte", seat=wrong_seat)
    assert response.status_code == 409
    assert "turn" in response.json()["detail"]


def test_unknown_tier_returns_422(client):
    game = BeccaGame(seed=16)
    response = _act(client, game, "impossibile")
    assert response.status_code == 422
    assert "unknown tier" in response.json()["detail"]


def test_malformed_state_returns_422(client):
    game = BeccaGame(seed=17)
    state = game_to_state_dict(game, game.current_seat)
    del state["hands"]["1"]

    response = client.post(
        "/act",
        json={"state": state, "seat": game.current_seat, "tier": "forte"},
        headers={"Authorization": f"Bearer {TEST_TOKEN}"},
    )
    assert response.status_code == 422
    assert "malformed game state" in response.json()["detail"]


def test_temperature_out_of_range_is_rejected(client):
    game = BeccaGame(seed=18)
    response = _act(client, game, "forte", temperature=99.0)
    assert response.status_code == 422


@needs_checkpoint("forte")
def test_legal_move_gate_accepts_an_agreeing_backend(client):
    game = BeccaGame(seed=19)
    game.step(Suit.DENARA)
    _apply(game, _act(client, game, "forte").json())

    agreed = [{"suit": c.suit.value, "value": c.value.value} for c in game.legal_actions()]
    response = _act(client, game, "forte", expected_legal_cards=agreed)
    assert response.status_code == 200, response.text


@needs_checkpoint("forte")
def test_legal_move_gate_rejects_a_disagreeing_backend(client):
    """A backend whose legal set differs is looking at a different board."""
    game = BeccaGame(seed=19)
    game.step(Suit.DENARA)
    _apply(game, _act(client, game, "forte").json())

    response = _act(
        client,
        game,
        "forte",
        expected_legal_cards=[{"suit": "coppe", "value": "asso"}],
    )
    assert response.status_code == 409
    assert "legal-move disagreement" in response.json()["detail"]


@needs_checkpoint("esperto")
def test_esperto_search_stays_within_its_latency_budget(client):
    """Guards the PIMC rollout policy: net rollouts would take ~39 s per move."""
    game = BeccaGame(seed=20)
    game.step(Suit.DENARA)

    started = time.perf_counter()
    response = _act(client, game, "esperto")
    elapsed = time.perf_counter() - started

    assert response.status_code == 200, response.text
    assert elapsed < ESPERTO_MAX_SECONDS, f"esperto took {elapsed:.1f}s"
