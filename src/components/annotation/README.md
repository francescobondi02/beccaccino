# Annotation Components

## Overview
Presentational views for the expert annotation flow: scenario summary, current
trick, decision controls (card + signal, or briscola), and the skip-comment and
difficulty dialogs. They receive data and callbacks through props and perform no
fetching. Types and helpers come from `../../annotations/`.

## Interface
- `ScenarioSummary` (default export) — props `{ scenario: AnnotationScenario }`; shows round/target, caller, and for `play_card` also trick starter and briscola; shows both team totals via `scoreLabel` [ScenarioSummary.tsx:ScenarioSummary]
- `ScenarioTrick` (default export) — props `{ scenario: AnnotationPlayCardScenario; onOpenHistory() }`; renders `currentTrick` on a 3×3 grid relative to the acting seat; the centre cell shows "Presa N", "Tocca a te" and, when present, the formatted trick signal with its seat label; a history icon button (`aria-label="Apri storico della smazzata"`) calls `onOpenHistory` [ScenarioTrick.tsx:ScenarioTrick], [ScenarioTrick.tsx:CurrentTrick]
- `ScenarioDecision` (default export) — props `scenario`, `selectedCard`, `selectedSuit`, `signalChoice`, `isLeader`, `isSubmitting`, `canConfirm`, `onCardSelect`, `onSuitSelect`, `onSignalSelect`, `onSkip`, `onConfirm` [ScenarioDecision.tsx:ScenarioDecision]
- `SkipCommentDialog` — props `open`, `comment`, `isSubmitting`, `onOpenChange`, `onCommentChange`, `onContinue` [ResponseDialogs.tsx:SkipCommentDialog]
- `DifficultyDialog` — props `open`, `difficulty`, `isSubmitting`, `errorMessage?`, `canLoadAnotherScenario`, `onOpenChange`, `onDifficultyChange`, `onLoadAnotherScenario?`, `onSubmit` [ResponseDialogs.tsx:DifficultyDialog]

## Invariants
- Card and signal options are enabled only when a `scenario.legalActions` entry matches them with `actionMatchesCard` (signals also match `action.signal`); briscola suits are enabled only when `scenario.legalActions.includes(suit)` [ScenarioDecision.tsx:ScenarioDecision]
- Card, suit, signal and "Non sono sicuro" buttons are disabled while `isSubmitting` [ScenarioDecision.tsx:ScenarioDecision]
- The signal picker appears only for `play_card` scenarios when `isLeader` and a card is selected; it offers Striscio, Busso, Volo and Niente (`null`) [ScenarioDecision.tsx:SIGNAL_OPTIONS], [ScenarioDecision.tsx:ScenarioDecision]
- `choose_briscola` scenarios show the full hand (not selectable) plus four suit radio buttons; no trick is shown [ScenarioDecision.tsx:SUIT_OPTIONS], [ScenarioDecision.tsx:ScenarioDecision]
- "Conferma scelta" is disabled unless `canConfirm` and not `isSubmitting` [ScenarioDecision.tsx:ScenarioDecision]
- Team indexes derive from `actingSeat % 2`; the acting team is labelled "La tua squadra" [ScenarioSummary.tsx:ScenarioSummary]
- Skip comments are capped at 500 characters (`maxLength={500}`; counter counts code points via `Array.from`) [ResponseDialogs.tsx:SkipCommentDialog]
- Both dialogs ignore close requests while `isSubmitting` [ResponseDialogs.tsx:SkipCommentDialog], [ResponseDialogs.tsx:DifficultyDialog]
- "Invia risposta" is disabled with no difficulty, while submitting, or when `canLoadAnotherScenario` is true; difficulty options come from `ANNOTATION_DIFFICULTIES` [ResponseDialogs.tsx:DifficultyDialog]
- The briscola label maps the enum `denara` to the display text "denari" [ScenarioSummary.tsx:ScenarioSummary]

## Side Effects
- None. All actions are delegated to callback props; images load from `/images/semi/*` [ScenarioDecision.tsx:SUIT_OPTIONS], [ScenarioSummary.tsx:ScenarioSummary]

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/components/AnnotationScenario.test.tsx src/__tests__/pages/Annotation.test.tsx`
- Run: `cd frontend && npm run typecheck && npm run lint`
