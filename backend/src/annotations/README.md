# Expert Annotations

## Overview

Contracts and strict parsers for expert annotation scenarios: scenario and
action types, fixed vocabularies, scenario-state validation and hashing,
selected-action parsing and legality, batch validation, conversion between
actions and `ExpertAnnotation` database columns, and next-scenario selection
for an expert. The parsers are shared by the HTTP annotation endpoints and the
operator scripts in `../scripts`.

## Interface

- `contracts.ts`: types `AnnotationSeat`, `AnnotationDecisionType`
  (`"play_card" | "choose_briscola"`), `AnnotationCard`,
  `AnnotationPlayCardLegalAction`, `AnnotationPlayCardAction`,
  `AnnotationChooseBriscolaAction`, `AnnotationSelectedAction`,
  `AnnotationPlay`, `AnnotationTrick`, `CompletedAnnotationTrick`,
  `AnnotationPlayCardScenarioState`, `AnnotationChooseBriscolaScenarioState`,
  `AnnotationScenarioState`, `AnnotationPlayCardScenarioInput`,
  `AnnotationChooseBriscolaScenarioInput`, `AnnotationScenarioInput`,
  `ParsedAnnotationScenario`.
- `constants.ts`: `ANNOTATION_DIFFICULTIES` (`easy`, `medium`, `hard`),
  `ANNOTATION_TAGS`, `ANNOTATION_IMPORTANCE` (`standard: 1`, `useful: 2`,
  `cornerCase: 3`), `ANNOTATION_DIFFICULTY_TARGETS`, guards
  `isAnnotationDifficulty`, `isAnnotationTag`, `isAnnotationImportance`, and
  the matching types.
- `parsing.ts`: `isAnnotationDecisionType`, `seatAt`, `nonEmptyStringAt`,
  `signalAt`, `cardAt`, `cardKey`.
- `state.ts`: `canonicalJson(value)`, `annotationStateHash(state)`,
  `parseAnnotationScenario(decisionType, value, expectedHash?)`.
- `action.ts`: `parseAnnotationSelectedAction(value)`,
  `isAnnotationActionLegal(scenario, action)`.
- `batch.ts`: `parseAnnotationScenarioBatch(value)`.
- `responseCodec.ts`: type `AnnotationActionColumns`,
  `actionToAnnotationColumns(action)`, `annotationColumnsToAction({ decisionType, skipped, columns })`.
- `selection.ts`: types `DifficultyCounts`, `SelectedAnnotationScenario`;
  `emptyDifficultyCounts()`, `difficultySelectionOrder(counts)`,
  `selectNextAnnotationScenario(userId)`.

## Invariants

- All record parsers reject missing or extra keys (`exactKeys` from
  `../utils/json.ts`).
- `canonicalJson` sorts object keys recursively; `annotationStateHash` is the
  SHA-256 of the canonical state, and `parseAnnotationScenario` rejects a state
  whose hash differs from `expectedHash` (`state.ts`).
- `play_card` states must be consistent with public history: completed tricks
  are numbered from 1, each has four plays in seat order from its starter, the
  first starts at the caller and each next one at the previous winner, and each
  stored winner equals `determineTrickWinner`. The current trick has 0 to 3
  plays, `actingSeat` follows those plays, the hand holds
  `10 - completedTricks.length` cards, and no visible card is duplicated
  (`state.ts:parsePlayCardScenarioState`).
- `legalActions` must equal the derived legal set: a trick leader gets every
  hand card with each of `null`, `striscio`, `busso`, `volo`; followers get
  only legal follow-suit cards with `signal: null` (`state.ts:expectedActionKeys`).
- A signal and its `signalSeat` are both null or both set, and only the trick
  starter can signal (`state.ts:signalFieldsAt`).
- `choose_briscola` states require `actingSeat === callerSeat`, ten distinct
  cards, and exactly the four suits as legal actions
  (`state.ts:parseChooseBriscolaScenarioState`).
- A selected action is legal only when it matches the scenario decision type
  and appears in `legalActions` (`action.ts:isAnnotationActionLegal`). A
  `play_card` action may omit `decisionType` (`action.ts:parseAnnotationSelectedAction`).
- Batches are non-empty arrays; codes match `^[a-z0-9][a-z0-9-]{2,79}$`,
  `stateHash` is lowercase SHA-256, tags are non-empty, unique, and from
  `ANNOTATION_TAGS`, and codes and state hashes are unique within the batch
  (`batch.ts:parseAnnotationScenarioBatch`).
- Skipped responses store no action columns; briscola responses store only
  `selectedBriscola`; card responses store suit, value, and an optional signal
  but never `selectedBriscola` (`responseCodec.ts:annotationColumnsToAction`).
- Next-scenario selection only returns active scenarios the user has not
  answered. Difficulty order follows the largest deficit against the 40%
  medium, 40% hard, 20% easy targets (ties keep that order); within a
  difficulty it ranks by `importance / sqrt(1 + responseCount)`, then
  importance, then id. Active scenarios with unknown difficulty strings are a
  fallback (`selection.ts:selectNextAnnotationScenario`).

## Side Effects

- `selection.ts` reads `ExpertAnnotation` and `AnnotationScenario` through the
  shared Prisma client (`../db.ts`), including one raw SQL query. All other
  files are pure.

## Verification

- Run: `cd backend && npx jest tests/unit/annotationScenario.test.ts tests/unit/annotationResponseCodec.test.ts tests/unit/annotationSelection.test.ts`
- Run: `cd backend && npx jest tests/integration/annotations.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
