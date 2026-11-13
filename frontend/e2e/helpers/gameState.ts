import type { Card, CardValue, Suit } from "../../../backend/src/contract/cards";
import type { GamePlayer, GameState, Score } from "../../../backend/src/contract/game";

export const iso = (time: number) => new Date(time).toISOString();

export const tablePlayers = (names = ["Giulia", "Luca", "Marta", "Diego"]): GamePlayer[] =>
  names.map((username, seat) => ({
    userId: seat + 1, username, isBot: false, seat, team: seat % 2 === 0 ? 0 : 1, botModel: null, abandoned: false,
  }));

export const cardsOf = (suit: Suit, values: CardValue[]): Card[] => values.map((value) => ({ suit, value }));

export const score = (team0Points = 0, team1Points = 0, team0Figures = 0, team1Figures = 0): Score => ({
  team0: { points: team0Points, figures: team0Figures },
  team1: { points: team1Points, figures: team1Figures },
});

export const gameState = (overrides: Partial<GameState> = {}): GameState => ({
  roomCode: "ROOM", version: 1, serverTime: iso(Date.now()), status: "playing", isPractice: true,
  players: tablePlayers(),
  round: { number: 1, callerUserId: 1, briscola: "spade", cricca: false, deal: null },
  trick: { number: 1, cards: [] }, lastTrick: null, myHand: [], playableCards: [], turn: null,
  score: score(), roundSummary: null, result: null, lastAction: null,
  ...overrides,
});

// Stamps the current server time, as the backend does on every response.
export const withCurrentServerTime = (state: GameState): GameState => ({ ...state, serverTime: iso(Date.now()) });
