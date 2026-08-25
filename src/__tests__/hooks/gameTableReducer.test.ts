import { describe, it, expect } from "vitest";
import {
  gameTableReducer,
  initialGameTableState,
  type GameTableState,
} from "@/game/state";
import type {
  GameStateResponse,
  PlayedCardData,
} from "@/game/model";

/**
 * The reducer is the game table's single source of client-side truth: these
 * tests pin the update rules that used to live scattered across ~15 useState
 * setters — especially the signal set/clear rules and the reconnect timer
 * reconstruction, which are easy to break silently.
 */
describe("gameTableReducer", () => {
  const stateResponse: GameStateResponse = {
    status: "playing",
    round: { id: 7, number: 2, briscola: "coppe" },
    currentHandNumber: 3,
    callerUserId: 11,
    myCards: [
      { id: 1, suit: "denara", value: "asso", playerId: 5, roundId: 7, inHand: true },
    ],
    currentTurnUserId: 12,
    playedCards: [
      { playerId: 5, userId: 11, suit: "spade", value: "re", position: 0 },
    ],
    lastHandCards: [],
    totalPoints: { team0Points: 4, team1Points: 3, team0Figures: 2, team1Figures: 1 },
    turnTimer: null,
    finishedGame: null,
    isPractice: true,
    allHands: [],
  };

  const cardPlayed = (overrides: Partial<PlayedCardData> = {}): PlayedCardData => ({
    playerId: 5,
    userId: 11,
    suit: "denara",
    value: "asso",
    position: 1,
    signal: null,
    handNumber: 3,
    ...overrides,
  });

  const playCard = (
    state: GameTableState,
    data: PlayedCardData,
    myUserId: number | null = 99,
  ) =>
    gameTableReducer(state, {
      type: "card_played",
      data,
      myUserId,
      username: "anna",
    });

  it("state_fetched applies the full server response", () => {
    const state = gameTableReducer(initialGameTableState, {
      type: "state_fetched",
      data: stateResponse,
      now: 1000,
    });

    expect(state.currentRound).toEqual(stateResponse.round);
    expect(state.callerUserId).toBe(11);
    expect(state.currentTurnUserId).toBe(12);
    expect(state.myCards).toHaveLength(1);
    expect(state.playedCards).toHaveLength(1);
    expect(state.totalPoints.team0Points).toBe(4);
    expect(state.isPractice).toBe(true);
    expect(state.turnTimer).toBeNull();
  });

  it("state_fetched restores a finished game without a socket event", () => {
    const finishedGame = {
      winnerTeam: 1,
      totalRounds: 5,
      finalScores: { team0: 34, team1: 42 },
      roundsWon: { team0: 2, team1: 3 },
    };
    const state = gameTableReducer(initialGameTableState, {
      type: "state_fetched",
      data: {
        ...stateResponse,
        status: "finished",
        currentTurnUserId: null,
        finishedGame,
      },
      now: 1000,
    });

    expect(state.currentTurnUserId).toBeNull();
    expect(state.gameFinishedData).toEqual(finishedGame);
  });

  it("state_fetched rebuilds the timer start from the server's remaining time", () => {
    const state = gameTableReducer(initialGameTableState, {
      type: "state_fetched",
      data: {
        ...stateResponse,
        turnTimer: {
          turnUserId: 12,
          remainingMs: 40_000,
          totalMs: 60_000,
          phase: "play_card",
        },
      },
      now: 100_000,
    });

    // 20s already elapsed on the server, so the local countdown must behave
    // as if the timer started 20s ago.
    expect(state.turnTimer).toEqual({
      turnUserId: 12,
      totalMs: 60_000,
      startedAt: 80_000,
      phase: "play_card",
    });
  });

  it("state_fetched restores the lead signal and clears it for an empty trick", () => {
    const signalled = gameTableReducer(initialGameTableState, {
      type: "state_fetched",
      data: {
        ...stateResponse,
        playedCards: [
          {
            playerId: 5,
            userId: 11,
            suit: "spade",
            value: "re",
            position: 0,
            signal: "busso",
          },
        ],
      },
      now: 1000,
    });
    expect(signalled.currentSignal).toEqual({
      userId: 11,
      signal: "busso",
    });

    const emptyTrick = gameTableReducer(signalled, {
      type: "state_fetched",
      data: { ...stateResponse, playedCards: [] },
      now: 1000,
    });
    expect(emptyTrick.currentSignal).toBeNull();
  });

  it("card_played by me removes the card from my hand and adds it to the table", () => {
    const withHand: GameTableState = {
      ...initialGameTableState,
      myCards: [
        { id: 1, suit: "denara", value: "asso", playerId: 5, roundId: 7, inHand: true },
        { id: 2, suit: "coppe", value: "tre", playerId: 5, roundId: 7, inHand: true },
      ],
    };

    const state = playCard(withHand, cardPlayed(), 11);

    expect(state.myCards).toEqual([withHand.myCards[1]]);
    expect(state.playedCards).toHaveLength(1);
  });

  it("card_played by someone else leaves my hand alone", () => {
    const withHand: GameTableState = {
      ...initialGameTableState,
      myCards: [
        { id: 1, suit: "denara", value: "asso", playerId: 5, roundId: 7, inHand: true },
      ],
    };

    const state = playCard(withHand, cardPlayed(), 99);

    expect(state.myCards).toHaveLength(1);
    expect(state.playedCards).toHaveLength(1);
  });

  it("a signal on the trick's first card is shown; a signal-less lead clears the previous one", () => {
    const led = playCard(
      initialGameTableState,
      cardPlayed({ position: 0, signal: "busso" }),
    );
    expect(led.currentSignal).toEqual({ userId: 11, signal: "busso" });

    // Followers (position > 0) never carry a signal and must not clear it.
    const followed = playCard(led, cardPlayed({ position: 1 }));
    expect(followed.currentSignal).toEqual({ userId: 11, signal: "busso" });

    const newTrick = playCard(followed, cardPlayed({ position: 0 }));
    expect(newTrick.currentSignal).toBeNull();
  });

  it("card_played invalidates the previous turn and appends to the move log", () => {
    const withTimer: GameTableState = {
      ...initialGameTableState,
      currentTurnUserId: 11,
      playableCards: stateResponse.myCards,
      turnTimer: { turnUserId: 11, totalMs: 60_000, startedAt: 0, phase: "play_card" },
    };

    const state = playCard(withTimer, cardPlayed());

    expect(state.currentTurnUserId).toBeNull();
    expect(state.playableCards).toEqual([]);
    expect(state.turnTimer).toBeNull();
    expect(state.moveLog).toEqual([
      { handNumber: 3, username: "anna", suit: "denara", value: "asso", signal: null },
    ]);
  });

  it("briscola_chosen updates the round and clears the timer", () => {
    const inRound: GameTableState = {
      ...initialGameTableState,
      currentRound: { id: 7, number: 2, briscola: null },
      turnTimer: { turnUserId: 11, totalMs: 90_000, startedAt: 0, phase: "choose_briscola" },
    };

    const state = gameTableReducer(inRound, {
      type: "briscola_chosen",
      briscola: "spade",
    });

    expect(state.currentRound?.briscola).toBe("spade");
    expect(state.turnTimer).toBeNull();
  });

  it("round_ended stores the scores; round_end_dismissed clears them", () => {
    const ended = gameTableReducer(initialGameTableState, {
      type: "round_ended",
      data: {
        roundNumber: 2,
        team0: { points: 6, figures: 1 },
        team1: { points: 5, figures: 1 },
        winnerTeam: 0,
        cricca: false,
      },
    });
    expect(ended.roundEndData).toEqual({
      roundNumber: 2,
      team0Points: 6,
      team1Points: 5,
      winnerTeam: 0,
    });

    const dismissed = gameTableReducer(ended, { type: "round_end_dismissed" });
    expect(dismissed.roundEndData).toBeNull();
  });

  it("new_round_started clears previous-round transient state", () => {
    const state = gameTableReducer(
      {
        ...initialGameTableState,
        currentRound: { id: 7, number: 1, briscola: "spade" },
        callerUserId: 11,
        myCards: stateResponse.myCards,
        currentTurnUserId: 11,
        playedCards: stateResponse.playedCards,
        playableCards: stateResponse.myCards,
        currentHandNumber: 10,
        currentSignal: { userId: 11, signal: "busso" },
        roundEndData: {
          roundNumber: 1,
          team0Points: 6,
          team1Points: 5,
          winnerTeam: 0,
        },
      },
      { type: "new_round_started" },
    );

    expect(state.currentRound).toBeNull();
    expect(state.myCards).toEqual([]);
    expect(state.playedCards).toEqual([]);
    expect(state.playableCards).toEqual([]);
    expect(state.currentHandNumber).toBeNull();
    expect(state.currentSignal).toBeNull();
    expect(state.roundEndData).toBeNull();
  });

  it("game_finished stores the result and closes the round-end summary", () => {
    const midRoundEnd: GameTableState = {
      ...initialGameTableState,
      roundEndData: {
        roundNumber: 5,
        team0Points: 9,
        team1Points: 2,
        winnerTeam: 0,
      },
    };

    const finished = gameTableReducer(midRoundEnd, {
      type: "game_finished",
      data: {
        winnerTeam: 0,
        totalRounds: 5,
        finalScores: { team0: 42, team1: 30 },
        roundsWon: { team0: 3, team1: 2 },
      },
    });

    expect(finished.gameFinishedData?.winnerTeam).toBe(0);
    expect(finished.roundEndData).toBeNull();
  });

  it("turn_timer_started advances the turn and clears the previous turn's playable cards", () => {
    const timer = { turnUserId: 12, totalMs: 60_000, startedAt: 500, phase: "play_card" };
    const currentState: GameTableState = {
      ...initialGameTableState,
      currentTurnUserId: 11,
      playableCards: stateResponse.myCards,
    };

    const state = gameTableReducer(currentState, {
      type: "turn_timer_started",
      timer,
    });

    expect(state.currentTurnUserId).toBe(12);
    expect(state.playableCards).toEqual([]);
    expect(state.turnTimer).toEqual(timer);
  });

  it("turn_timer_started clears playable cards for a new trick led by the same player", () => {
    const timer = { turnUserId: 11, totalMs: 60_000, startedAt: 500, phase: "play_card" };
    const currentState: GameTableState = {
      ...initialGameTableState,
      currentTurnUserId: 11,
      playableCards: stateResponse.myCards,
    };

    const state = gameTableReducer(currentState, {
      type: "turn_timer_started",
      timer,
    });

    expect(state.currentTurnUserId).toBe(11);
    expect(state.playableCards).toEqual([]);
    expect(state.turnTimer).toEqual(timer);
  });
});
