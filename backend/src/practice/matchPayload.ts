import {
  CardSignal,
  isCardSignal,
  isSuit,
  isValue,
  Suit,
  Value,
} from "../domain/game/cards";
import { exactKeys, integerAt, recordAt } from "../utils/json";

export const PRACTICE_MATCH_PAYLOAD_VERSION = 1;

export type PracticeSeat = 0 | 1 | 2 | 3;
export type PracticeCardCode = `${Suit}:${Value}`;
export type PracticeCardEntry = [PracticeSeat, PracticeCardCode];

export type PracticeHumanAction =
  | {
      kind: "choose_briscola";
      suit: Suit;
    }
  | {
      kind: "play_card";
      trick: number;
      position: number;
      card: PracticeCardCode;
      signal: CardSignal | null;
    };

export type PracticeTrickPayload = {
  number: number;
  starterSeat: PracticeSeat;
  winnerSeat: PracticeSeat | null;
  signal: CardSignal | null;
  cards: PracticeCardEntry[];
};

export type PracticeRoundPayload = {
  number: number;
  briscola: Suit | null;
  callerSeat: PracticeSeat;
  cricca: boolean;
  dealtHands: Record<string, PracticeCardCode[]>;
  tricks: PracticeTrickPayload[];
  humanActions: PracticeHumanAction[];
};

export type PracticeMatchPayload = {
  winPoints: number;
  rounds: PracticeRoundPayload[];
};

function seatAt(value: unknown, path: string): PracticeSeat {
  return integerAt(value, path, 0, 3) as PracticeSeat;
}

function nullableSignalAt(value: unknown, path: string): CardSignal | null {
  if (value === null) return null;
  if (!isCardSignal(value)) throw new Error(`${path} is invalid`);
  return value;
}

function cardCodeAt(value: unknown, path: string): PracticeCardCode {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a card code`);
  }
  const parts = value.split(":");
  if (parts.length !== 2 || !isSuit(parts[0]) || !isValue(parts[1])) {
    throw new Error(`${path} must be a valid suit:value card code`);
  }
  return value as PracticeCardCode;
}

function nullableSuitAt(value: unknown, path: string): Suit | null {
  if (value === null) return null;
  if (!isSuit(value)) throw new Error(`${path} is invalid`);
  return value;
}

function humanActionAt(
  value: unknown,
  path: string,
): PracticeHumanAction {
  const record = recordAt(value, path);
  if (record.kind === "choose_briscola") {
    exactKeys(record, ["kind", "suit"], path);
    if (!isSuit(record.suit)) throw new Error(`${path}.suit is invalid`);
    return { kind: "choose_briscola", suit: record.suit };
  }
  if (record.kind === "play_card") {
    exactKeys(
      record,
      ["kind", "trick", "position", "card", "signal"],
      path,
    );
    return {
      kind: "play_card",
      trick: integerAt(record.trick, `${path}.trick`, 1),
      position: integerAt(record.position, `${path}.position`, 0, 3),
      card: cardCodeAt(record.card, `${path}.card`),
      signal: nullableSignalAt(record.signal, `${path}.signal`),
    };
  }
  throw new Error(`${path}.kind is invalid`);
}

function trickAt(value: unknown, path: string): PracticeTrickPayload {
  const record = recordAt(value, path);
  exactKeys(
    record,
    ["number", "starterSeat", "winnerSeat", "signal", "cards"],
    path,
  );
  if (
    !Array.isArray(record.cards) ||
    record.cards.length === 0 ||
    record.cards.length > 4
  ) {
    throw new Error(`${path}.cards must contain one to four cards`);
  }
  const cards = record.cards.map((entry, index): PracticeCardEntry => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`${path}.cards[${index}] must be a seat and card pair`);
    }
    return [
      seatAt(entry[0], `${path}.cards[${index}][0]`),
      cardCodeAt(entry[1], `${path}.cards[${index}][1]`),
    ];
  });
  return {
    number: integerAt(record.number, `${path}.number`, 1),
    starterSeat: seatAt(record.starterSeat, `${path}.starterSeat`),
    winnerSeat:
      record.winnerSeat === null
        ? null
        : seatAt(record.winnerSeat, `${path}.winnerSeat`),
    signal: nullableSignalAt(record.signal, `${path}.signal`),
    cards,
  };
}

function dealtHandsAt(
  value: unknown,
  path: string,
): Record<string, PracticeCardCode[]> {
  const record = recordAt(value, path);
  exactKeys(record, ["0", "1", "2", "3"], path);
  return Object.fromEntries(
    ["0", "1", "2", "3"].map((seat) => {
      const hand = record[seat];
      if (!Array.isArray(hand) || hand.length !== 10) {
        throw new Error(`${path}.${seat} must contain ten cards`);
      }
      return [
        seat,
        hand.map((card, index) =>
          cardCodeAt(card, `${path}.${seat}[${index}]`),
        ),
      ];
    }),
  );
}

function roundAt(value: unknown, path: string): PracticeRoundPayload {
  const record = recordAt(value, path);
  exactKeys(
    record,
    [
      "number",
      "briscola",
      "callerSeat",
      "cricca",
      "dealtHands",
      "tricks",
      "humanActions",
    ],
    path,
  );
  if (typeof record.cricca !== "boolean") {
    throw new Error(`${path}.cricca must be a boolean`);
  }
  if (!Array.isArray(record.tricks) || record.tricks.length > 10) {
    throw new Error(`${path}.tricks must be an array of up to ten tricks`);
  }
  if (!Array.isArray(record.humanActions)) {
    throw new Error(`${path}.humanActions must be an array`);
  }
  return {
    number: integerAt(record.number, `${path}.number`, 1),
    briscola: nullableSuitAt(record.briscola, `${path}.briscola`),
    callerSeat: seatAt(record.callerSeat, `${path}.callerSeat`),
    cricca: record.cricca,
    dealtHands: dealtHandsAt(record.dealtHands, `${path}.dealtHands`),
    tricks: record.tricks.map((trick, index) =>
      trickAt(trick, `${path}.tricks[${index}]`),
    ),
    humanActions: record.humanActions.map((action, index) =>
      humanActionAt(action, `${path}.humanActions[${index}]`),
    ),
  };
}

export function parsePracticeMatchPayload(
  value: unknown,
): PracticeMatchPayload {
  const path = "practice match payload";
  const record = recordAt(value, path);
  exactKeys(record, ["winPoints", "rounds"], path);
  if (!Array.isArray(record.rounds) || record.rounds.length === 0) {
    throw new Error(`${path}.rounds must be a non-empty array`);
  }
  const rounds = record.rounds.map((round, index) =>
    roundAt(round, `${path}.rounds[${index}]`),
  );
  if (rounds.some((round, index) => round.number !== index + 1)) {
    throw new Error(`${path}.rounds must be chronological`);
  }
  return {
    winPoints: integerAt(record.winPoints, `${path}.winPoints`, 1),
    rounds,
  };
}
