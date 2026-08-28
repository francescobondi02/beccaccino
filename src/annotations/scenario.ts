import { createHash } from "crypto";
import {
  AnnotationDifficulty,
  AnnotationImportance,
  AnnotationTag,
  isAnnotationDifficulty,
  isAnnotationImportance,
  isAnnotationTag,
} from "./constants";
import {
  CardSignal,
  isCardSignal,
  isSuit,
  isValue,
  SUITS,
  Suit,
  Value,
} from "../domain/game/cards";
import { determineHandWinner } from "../domain/game/determineHandWinner";
import { selectLegalCards } from "../domain/game/legalCards";
import { seatAfter } from "../domain/game/turnOrder";

export type AnnotationSeat = 0 | 1 | 2 | 3;
export type AnnotationDecisionType = "play_card" | "choose_briscola";

export interface AnnotationCard {
  readonly suit: Suit;
  readonly value: Value;
}

export interface AnnotationPlayCardLegalAction extends AnnotationCard {
  readonly signal: CardSignal | null;
}

export interface AnnotationPlayCardAction
  extends AnnotationPlayCardLegalAction {
  readonly decisionType: "play_card";
}

export interface AnnotationChooseBriscolaAction {
  readonly decisionType: "choose_briscola";
  readonly suit: Suit;
}

export type AnnotationSelectedAction =
  | AnnotationPlayCardAction
  | AnnotationChooseBriscolaAction;

export interface AnnotationPlay extends AnnotationCard {
  readonly seat: AnnotationSeat;
  readonly position: number;
}

export interface AnnotationTrick {
  readonly number: number;
  readonly starterSeat: AnnotationSeat;
  readonly signal: CardSignal | null;
  readonly signalSeat: AnnotationSeat | null;
  readonly plays: readonly AnnotationPlay[];
}

export interface CompletedAnnotationTrick extends AnnotationTrick {
  readonly winnerSeat: AnnotationSeat;
}

interface AnnotationScenarioStateBase {
  readonly targetPoints: number;
  readonly roundNumber: number;
  readonly actingSeat: AnnotationSeat;
  readonly callerSeat: AnnotationSeat;
  readonly totalScores: Readonly<{ 0: number; 1: number }>;
  readonly hand: readonly AnnotationCard[];
}

export interface AnnotationPlayCardScenarioState
  extends AnnotationScenarioStateBase {
  readonly trickStarter: AnnotationSeat;
  readonly briscola: Suit;
  readonly completedTricks: readonly CompletedAnnotationTrick[];
  readonly currentTrick: AnnotationTrick;
  readonly legalActions: readonly AnnotationPlayCardLegalAction[];
}

export interface AnnotationChooseBriscolaScenarioState
  extends AnnotationScenarioStateBase {
  readonly legalActions: readonly Suit[];
}

export type AnnotationScenarioState =
  | AnnotationPlayCardScenarioState
  | AnnotationChooseBriscolaScenarioState;

interface AnnotationScenarioInputBase {
  readonly code: string;
  readonly predictedDifficulty: AnnotationDifficulty;
  readonly importance: AnnotationImportance;
  readonly tags: readonly AnnotationTag[];
  readonly stateHash: string;
}

export type AnnotationPlayCardScenarioInput = AnnotationScenarioInputBase & {
  readonly decisionType: "play_card";
  readonly state: AnnotationPlayCardScenarioState;
};

export type AnnotationChooseBriscolaScenarioInput =
  AnnotationScenarioInputBase & {
    readonly decisionType: "choose_briscola";
    readonly state: AnnotationChooseBriscolaScenarioState;
  };

export type AnnotationScenarioInput =
  | AnnotationPlayCardScenarioInput
  | AnnotationChooseBriscolaScenarioInput;

export type ParsedAnnotationScenario =
  | {
      readonly decisionType: "play_card";
      readonly state: AnnotationPlayCardScenarioState;
    }
  | {
      readonly decisionType: "choose_briscola";
      readonly state: AnnotationChooseBriscolaScenarioState;
    };

type JsonRecord = Record<string, unknown>;

function isAnnotationDecisionType(
  value: unknown,
): value is AnnotationDecisionType {
  return value === "play_card" || value === "choose_briscola";
}

function recordAt(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as JsonRecord;
}

function exactKeys(record: JsonRecord, expected: readonly string[], path: string) {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${path} must contain only: ${wanted.join(", ")}`);
  }
}

function integerAt(
  value: unknown,
  path: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${path} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function seatAt(value: unknown, path: string): AnnotationSeat {
  return integerAt(value, path, 0, 3) as AnnotationSeat;
}

function nonEmptyStringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function signalAt(value: unknown, path: string): CardSignal | null {
  if (value === null) return null;
  if (!isCardSignal(value)) {
    throw new Error(`${path} must be striscio, busso, volo, or null`);
  }
  return value;
}

function cardAt(value: unknown, path: string): AnnotationCard {
  const record = recordAt(value, path);
  exactKeys(record, ["suit", "value"], path);
  if (!isSuit(record.suit)) throw new Error(`${path}.suit is invalid`);
  if (!isValue(record.value)) throw new Error(`${path}.value is invalid`);
  return { suit: record.suit, value: record.value };
}

function playCardLegalActionAt(
  value: unknown,
  path: string,
): AnnotationPlayCardLegalAction {
  const record = recordAt(value, path);
  exactKeys(record, ["suit", "value", "signal"], path);
  if (!isSuit(record.suit)) throw new Error(`${path}.suit is invalid`);
  if (!isValue(record.value)) throw new Error(`${path}.value is invalid`);
  return {
    suit: record.suit,
    value: record.value,
    signal: signalAt(record.signal, `${path}.signal`),
  };
}

function playAt(value: unknown, path: string): AnnotationPlay {
  const record = recordAt(value, path);
  exactKeys(record, ["position", "seat", "suit", "value"], path);
  if (!isSuit(record.suit)) throw new Error(`${path}.suit is invalid`);
  if (!isValue(record.value)) throw new Error(`${path}.value is invalid`);
  return {
    position: integerAt(record.position, `${path}.position`, 0, 3),
    seat: seatAt(record.seat, `${path}.seat`),
    suit: record.suit,
    value: record.value,
  };
}

function playsAt(
  value: unknown,
  path: string,
  starterSeat: AnnotationSeat,
  completed: boolean,
): readonly AnnotationPlay[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if ((completed && value.length !== 4) || (!completed && value.length > 3)) {
    throw new Error(
      `${path} must contain ${completed ? "exactly four" : "zero to three"} plays`,
    );
  }
  return value.map((rawPlay, index) => {
    const play = playAt(rawPlay, `${path}[${index}]`);
    if (
      play.position !== index ||
      play.seat !== seatAfter(starterSeat, index)
    ) {
      throw new Error(`${path} must follow the starter in position order`);
    }
    return play;
  });
}

function signalFieldsAt(
  record: JsonRecord,
  path: string,
  starterSeat: AnnotationSeat,
) {
  const signal = signalAt(record.signal, `${path}.signal`);
  const signalSeat =
    record.signalSeat === null
      ? null
      : seatAt(record.signalSeat, `${path}.signalSeat`);
  if ((signal === null) !== (signalSeat === null)) {
    throw new Error(`${path}.signal and signalSeat must both be null or set`);
  }
  if (signalSeat !== null && signalSeat !== starterSeat) {
    throw new Error(`${path}.signalSeat must be the trick starter`);
  }
  return { signal, signalSeat };
}

function completedTrickAt(
  value: unknown,
  path: string,
): CompletedAnnotationTrick {
  const record = recordAt(value, path);
  exactKeys(
    record,
    ["number", "starterSeat", "winnerSeat", "signal", "signalSeat", "plays"],
    path,
  );
  const starterSeat = seatAt(record.starterSeat, `${path}.starterSeat`);
  const { signal, signalSeat } = signalFieldsAt(record, path, starterSeat);
  return {
    number: integerAt(record.number, `${path}.number`, 1, 10),
    starterSeat,
    winnerSeat: seatAt(record.winnerSeat, `${path}.winnerSeat`),
    signal,
    signalSeat,
    plays: playsAt(record.plays, `${path}.plays`, starterSeat, true),
  };
}

function currentTrickAt(value: unknown, path: string): AnnotationTrick {
  const record = recordAt(value, path);
  exactKeys(
    record,
    ["number", "starterSeat", "signal", "signalSeat", "plays"],
    path,
  );
  const starterSeat = seatAt(record.starterSeat, `${path}.starterSeat`);
  const { signal, signalSeat } = signalFieldsAt(record, path, starterSeat);
  return {
    number: integerAt(record.number, `${path}.number`, 1, 10),
    starterSeat,
    signal,
    signalSeat,
    plays: playsAt(record.plays, `${path}.plays`, starterSeat, false),
  };
}

function cardKey(card: AnnotationCard): string {
  return `${card.suit}:${card.value}`;
}

function actionKey(action: AnnotationPlayCardLegalAction): string {
  return `${cardKey(action)}:${action.signal ?? "none"}`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function annotationStateHash(state: AnnotationScenarioState): string {
  return createHash("sha256").update(canonicalJson(state)).digest("hex");
}

function expectedActionKeys(
  hand: readonly AnnotationCard[],
  currentTrick: AnnotationTrick,
): Set<string> {
  if (currentTrick.plays.length === 0) {
    return new Set(
      hand.flatMap((card) =>
        [null, "striscio", "busso", "volo"].map((signal) =>
          actionKey({ ...card, signal: signal as CardSignal | null }),
        ),
      ),
    );
  }
  const playable = selectLegalCards(hand, currentTrick.plays[0].suit);
  return new Set(playable.map((card) => actionKey({ ...card, signal: null })));
}

function parsePlayCardScenarioState(
  value: unknown,
): AnnotationPlayCardScenarioState {
  const path = "annotation scenario state";
  const record = recordAt(value, path);
  exactKeys(
    record,
    [
      "targetPoints",
      "roundNumber",
      "actingSeat",
      "callerSeat",
      "trickStarter",
      "briscola",
      "totalScores",
      "hand",
      "completedTricks",
      "currentTrick",
      "legalActions",
    ],
    path,
  );
  if (!isSuit(record.briscola)) throw new Error(`${path}.briscola is invalid`);
  const briscola = record.briscola;
  const actingSeat = seatAt(record.actingSeat, `${path}.actingSeat`);
  const callerSeat = seatAt(record.callerSeat, `${path}.callerSeat`);
  const trickStarter = seatAt(record.trickStarter, `${path}.trickStarter`);
  const scores = recordAt(record.totalScores, `${path}.totalScores`);
  exactKeys(scores, ["0", "1"], `${path}.totalScores`);

  if (!Array.isArray(record.completedTricks)) {
    throw new Error(`${path}.completedTricks must be an array`);
  }
  const completedTricks = record.completedTricks.map((trick, index) => {
    const parsed = completedTrickAt(trick, `${path}.completedTricks[${index}]`);
    if (parsed.number !== index + 1) {
      throw new Error(`${path}.completedTricks must be chronological`);
    }
    const winner = determineHandWinner(
      parsed.plays.map((play) => ({
        playerId: play.seat,
        suit: play.suit,
        value: play.value,
      })),
      briscola,
    );
    if (winner !== parsed.winnerSeat) {
      throw new Error(`${path}.completedTricks[${index}] has an invalid winner`);
    }
    return parsed;
  });

  const expectedStarter =
    completedTricks[completedTricks.length - 1]?.winnerSeat ?? callerSeat;
  const currentTrick = currentTrickAt(
    record.currentTrick,
    `${path}.currentTrick`,
  );
  if (
    currentTrick.number !== completedTricks.length + 1 ||
    currentTrick.starterSeat !== expectedStarter ||
    trickStarter !== expectedStarter
  ) {
    throw new Error(`${path}.currentTrick does not follow completed history`);
  }
  if (actingSeat !== seatAfter(trickStarter, currentTrick.plays.length)) {
    throw new Error(`${path}.actingSeat does not follow current trick`);
  }

  if (!Array.isArray(record.hand) || record.hand.length === 0) {
    throw new Error(`${path}.hand must be a non-empty array`);
  }
  const hand = record.hand.map((card, index) =>
    cardAt(card, `${path}.hand[${index}]`),
  );
  if (hand.length !== 10 - completedTricks.length) {
    throw new Error(`${path}.hand size does not match completed history`);
  }

  const visibleCards = [
    ...completedTricks.flatMap((trick) => trick.plays),
    ...currentTrick.plays,
    ...hand,
  ].map(cardKey);
  if (new Set(visibleCards).size !== visibleCards.length) {
    throw new Error(`${path} contains a duplicate visible card`);
  }

  if (!Array.isArray(record.legalActions) || record.legalActions.length === 0) {
    throw new Error(`${path}.legalActions must be a non-empty array`);
  }
  const legalActions = record.legalActions.map((action, index) =>
    playCardLegalActionAt(action, `${path}.legalActions[${index}]`),
  );
  const actualActions = new Set(legalActions.map(actionKey));
  const expectedActions = expectedActionKeys(hand, currentTrick);
  if (
    actualActions.size !== legalActions.length ||
    actualActions.size !== expectedActions.size ||
    [...actualActions].some((action) => !expectedActions.has(action))
  ) {
    throw new Error(`${path}.legalActions do not match the public state`);
  }

  return {
    targetPoints: integerAt(record.targetPoints, `${path}.targetPoints`, 1),
    roundNumber: integerAt(record.roundNumber, `${path}.roundNumber`, 1),
    actingSeat,
    callerSeat,
    trickStarter,
    briscola,
    totalScores: {
      0: integerAt(scores["0"], `${path}.totalScores.0`, 0),
      1: integerAt(scores["1"], `${path}.totalScores.1`, 0),
    },
    hand,
    completedTricks,
    currentTrick,
    legalActions,
  };
}

function parseChooseBriscolaScenarioState(
  value: unknown,
): AnnotationChooseBriscolaScenarioState {
  const path = "annotation scenario state";
  const record = recordAt(value, path);
  exactKeys(
    record,
    [
      "targetPoints",
      "roundNumber",
      "actingSeat",
      "callerSeat",
      "totalScores",
      "hand",
      "legalActions",
    ],
    path,
  );
  const actingSeat = seatAt(record.actingSeat, `${path}.actingSeat`);
  const callerSeat = seatAt(record.callerSeat, `${path}.callerSeat`);
  if (actingSeat !== callerSeat) {
    throw new Error(`${path}.actingSeat must be the caller`);
  }

  const scores = recordAt(record.totalScores, `${path}.totalScores`);
  exactKeys(scores, ["0", "1"], `${path}.totalScores`);

  if (!Array.isArray(record.hand) || record.hand.length !== 10) {
    throw new Error(`${path}.hand must contain exactly ten cards`);
  }
  const hand = record.hand.map((card, index) =>
    cardAt(card, `${path}.hand[${index}]`),
  );
  if (new Set(hand.map(cardKey)).size !== hand.length) {
    throw new Error(`${path}.hand contains a duplicate card`);
  }

  if (
    !Array.isArray(record.legalActions) ||
    record.legalActions.length !== SUITS.length
  ) {
    throw new Error(`${path}.legalActions must contain all four suits`);
  }
  if (record.legalActions.some((suit) => !isSuit(suit))) {
    throw new Error(`${path}.legalActions must contain all four suits`);
  }
  const legalActions = record.legalActions as Suit[];
  if (new Set(legalActions).size !== SUITS.length) {
    throw new Error(`${path}.legalActions must contain all four suits`);
  }

  return {
    targetPoints: integerAt(record.targetPoints, `${path}.targetPoints`, 1),
    roundNumber: integerAt(record.roundNumber, `${path}.roundNumber`, 1),
    actingSeat,
    callerSeat,
    totalScores: {
      0: integerAt(scores["0"], `${path}.totalScores.0`, 0),
      1: integerAt(scores["1"], `${path}.totalScores.1`, 0),
    },
    hand,
    legalActions,
  };
}

export function parseAnnotationScenario(
  decisionType: unknown,
  value: unknown,
  expectedHash?: string,
): ParsedAnnotationScenario {
  if (!isAnnotationDecisionType(decisionType)) {
    throw new Error("annotation scenario decisionType is invalid");
  }
  const parsed: ParsedAnnotationScenario =
    decisionType === "play_card"
      ? {
          decisionType,
          state: parsePlayCardScenarioState(value),
        }
      : {
          decisionType,
          state: parseChooseBriscolaScenarioState(value),
        };
  if (expectedHash && annotationStateHash(parsed.state) !== expectedHash) {
    throw new Error("annotation scenario state hash does not match stateHash");
  }
  return parsed;
}

export function parseAnnotationSelectedAction(
  value: unknown,
): AnnotationSelectedAction {
  const path = "selectedAction";
  const record = recordAt(value, path);
  if (
    record.decisionType === "play_card" ||
    record.decisionType === undefined
  ) {
    exactKeys(
      record,
      record.decisionType === undefined
        ? ["suit", "value", "signal"]
        : ["decisionType", "suit", "value", "signal"],
      path,
    );
    if (!isSuit(record.suit)) throw new Error(`${path}.suit is invalid`);
    if (!isValue(record.value)) throw new Error(`${path}.value is invalid`);
    return {
      decisionType: "play_card",
      suit: record.suit,
      value: record.value,
      signal: signalAt(record.signal, `${path}.signal`),
    };
  }
  if (record.decisionType === "choose_briscola") {
    exactKeys(record, ["decisionType", "suit"], path);
    if (!isSuit(record.suit)) throw new Error(`${path}.suit is invalid`);
    return {
      decisionType: "choose_briscola",
      suit: record.suit,
    };
  }
  throw new Error(`${path}.decisionType is invalid`);
}

export function isAnnotationActionLegal(
  scenario: ParsedAnnotationScenario,
  action: AnnotationSelectedAction,
): boolean {
  if (
    scenario.decisionType === "play_card" &&
    action.decisionType === "play_card"
  ) {
    return scenario.state.legalActions.some(
      (legal) =>
        legal.suit === action.suit &&
        legal.value === action.value &&
        legal.signal === action.signal,
    );
  }
  if (
    scenario.decisionType === "choose_briscola" &&
    action.decisionType === "choose_briscola"
  ) {
    return scenario.state.legalActions.includes(action.suit);
  }
  return false;
}

export function parseAnnotationScenarioBatch(
  value: unknown,
): readonly AnnotationScenarioInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("annotation scenario batch must be a non-empty array");
  }
  const codes = new Set<string>();
  const hashes = new Set<string>();
  return value.map((rawScenario, index) => {
    const path = `annotation scenario batch[${index}]`;
    const record = recordAt(rawScenario, path);
    exactKeys(
      record,
      [
        "code",
        "decisionType",
        "predictedDifficulty",
        "importance",
        "tags",
        "stateHash",
        "state",
      ],
      path,
    );
    const code = nonEmptyStringAt(record.code, `${path}.code`);
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(code)) {
      throw new Error(`${path}.code must be a lowercase stable identifier`);
    }
    if (!isAnnotationDifficulty(record.predictedDifficulty)) {
      throw new Error(`${path}.predictedDifficulty is invalid`);
    }
    if (!isAnnotationImportance(record.importance)) {
      throw new Error(`${path}.importance is invalid`);
    }
    if (
      !Array.isArray(record.tags) ||
      record.tags.length === 0 ||
      !record.tags.every(isAnnotationTag) ||
      new Set(record.tags).size !== record.tags.length
    ) {
      throw new Error(`${path}.tags must be unique fixed annotation tags`);
    }
    const stateHash = nonEmptyStringAt(record.stateHash, `${path}.stateHash`);
    if (!/^[a-f0-9]{64}$/.test(stateHash)) {
      throw new Error(`${path}.stateHash must be a lowercase SHA-256 hash`);
    }
    if (codes.has(code) || hashes.has(stateHash)) {
      throw new Error(`${path} duplicates a code or state hash`);
    }
    codes.add(code);
    hashes.add(stateHash);
    const parsed = parseAnnotationScenario(
      record.decisionType,
      record.state,
      stateHash,
    );
    return {
      code,
      predictedDifficulty: record.predictedDifficulty,
      importance: record.importance,
      tags: record.tags,
      stateHash,
      ...parsed,
    };
  });
}
