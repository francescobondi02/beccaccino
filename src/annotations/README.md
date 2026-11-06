# Annotations

## Overview
Client-side contract and presentation helpers for the expert annotation flow.
`model.ts` mirrors the annotation REST payloads; `presentation.ts` holds pure
seat, score, signal and history formatting used by the annotation views.

## Interface
- `ANNOTATION_DIFFICULTIES` — `easy`/"Facile", `medium`/"Media", `hard`/"Difficile" [constants.ts:ANNOTATION_DIFFICULTIES]
- `AnnotationDifficulty` [constants.ts:AnnotationDifficulty]
- Model types: `AnnotationSuit` (`denara` | `coppe` | `spade` | `bastoni`), `AnnotationValue`, `AnnotationSignal`, `AnnotationSeat` (0–3), `AnnotationCard`, `AnnotationPlayCardAction`, `AnnotationSelectedAction`, `AnnotationPlay`, `AnnotationTrick` [model.ts:AnnotationSuit], [model.ts:AnnotationSelectedAction], [model.ts:AnnotationTrick]
- Scenario union `AnnotationScenario` = `AnnotationPlayCardScenario` (`decisionType: "play_card"`, `legalActions: AnnotationPlayCardAction[]`) | `AnnotationChooseBriscolaScenario` (`decisionType: "choose_briscola"`, `legalActions: AnnotationSuit[]`) [model.ts:AnnotationScenario]
- API payloads: `AnnotationStatusResponse`, `NextAnnotationResponse`, `AnnotationResponseRequest`, `AnnotationResponseResult` [model.ts:AnnotationResponseRequest]
- `RelativePosition`, `SignalChoice` (`AnnotationSignal | undefined`) [presentation.ts:RelativePosition], [presentation.ts:SignalChoice]
- `relativePosition(seat, actingSeat)`, `seatLabel(seat, actingSeat)` [presentation.ts:relativePosition], [presentation.ts:seatLabel]
- `scoreLabel(raw)`, `cardKey(card)`, `actionMatchesCard(action, card)`, `formatSignal(signal)` [presentation.ts:scoreLabel], [presentation.ts:cardKey], [presentation.ts:actionMatchesCard], [presentation.ts:formatSignal]
- `historyFor(scenario): HistoryTrick[]` (type from `src/components/TrickHistoryDialog.tsx`) [presentation.ts:historyFor]

## Invariants
- The acting seat is always `bottom`; seats `+1`, `+2`, `+3` map to `left`, `top`, `right` via `(seat - actingSeat + 4) % 4` [presentation.ts:relativePosition]
- Seat labels: "Tu", "Socio", "Sinistra", "Destra" [presentation.ts:seatLabel]
- `scoreLabel` converts raw thirds into `floor(raw / 3)` points plus `raw % 3` figures, with Italian singular/plural [presentation.ts:scoreLabel]
- `formatSignal(null)` returns "Nessun segnale" [presentation.ts:formatSignal]
- In `historyFor`, only the play at `position === 0` carries the trick signal; the current trick is appended (marked `current: true`) only when it has plays [presentation.ts:historyFor]
- A response carries `scenarioId`, `scenarioHash`, `selectedAction` (or `null`), `skipped`, `comment`, `perceivedDifficulty` and `responseTimeMs` [model.ts:AnnotationResponseRequest]

## Side Effects
- None. All exports are types or pure functions.

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/annotations src/__tests__/components/AnnotationScenario.test.tsx src/__tests__/pages/Annotation.test.tsx`
- Run: `cd frontend && npm run typecheck && npm run lint`
