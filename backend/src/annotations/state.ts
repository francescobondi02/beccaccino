import { createHash } from "crypto";
import {
  CardSignal,
  isSuit,
  isValue,
  SUITS,
  Suit,
} from "../domain/game/cards";
import { determineTrickWinner } from "../domain/game/trickWinner";
import { selectLegalCards } from "../domain/game/legalCards";
import { seatAfter } from "../domain/game/turnOrder";
import {
  AnnotationCard,
  AnnotationChooseBriscolaScenarioState,
  AnnotationPlay,
  AnnotationPlayCardLegalAction,
  AnnotationPlayCardScenarioState,
  AnnotationScenarioState,
  AnnotationSeat,
  AnnotationTrick,
  CompletedAnnotationTrick,
  ParsedAnnotationScenario,
} from "./contracts";
import {
  cardAt,
  cardKey,
  isAnnotationDecisionType,
  seatAt,
  signalAt,
} from "./parsing";
import { exactKeys, integerAt, JsonRecord, recordAt } from "../utils/json";

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
  let expectedStarter = callerSeat;
  const completedTricks = record.completedTricks.map((trick, index) => {
    const parsed = completedTrickAt(trick, `${path}.completedTricks[${index}]`);
    if (
      parsed.number !== index + 1 ||
      parsed.starterSeat !== expectedStarter
    ) {
      throw new Error(
        `${path}.completedTricks must follow the caller and previous winners`,
      );
    }
    const winner = determineTrickWinner(
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
    expectedStarter = parsed.winnerSeat;
    return parsed;
  });

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
