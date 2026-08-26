# Beccaccino Online V2 — Phased Implementation Plan

A complete second-generation UI living side by side with V1, under `/v2`, reusing every
existing hook, socket handler, REST call, and card asset. No backend work, no mock data,
no changes to V1 pages, `src/index.css`, `tailwind.config.ts`, or `src/components/ui`.

## Visual system proposal

- **Felt**: deep green-blue table (`--becca-felt`, ~`hsl(168 32% 14%)`) with a soft radial
  vignette and a very low-opacity noise/paper texture layer (inline SVG data URI, no asset).
- **Surfaces**: ivory panels (`hsl(40 30% 96%)`) with 1px warm border, single-level depth —
  no nested cards, no glass.
- **Accents**: vermilion/coral primary (`hsl(8 72% 54%)`), cobalt for the opposing team
  (`hsl(216 70% 46%)`), restrained brass (`hsl(38 55% 55%)`) for briscola/win moments,
  charcoal text (`hsl(30 10% 16%)`).
- **Type**: compact scale, tight headings (no marketing hero sizes), tabular numbers for
  scores and timers.
- **Cards**: the real PNGs in `public/images/cards` are the visual identity — fanned in the
  lobby background, stacked in round transitions, never replaced by generic card icons.
- **Tokens**: all of the above declared as CSS variables inside `.becca-v2 { ... }` in
  `src/v2/styles/v2.css`, imported only by `V2App`. Tailwind arbitrary values
  (`bg-[hsl(var(--becca-felt))]`) keep `tailwind.config.ts` untouched.

## Route and component map

```text
/v2                 V2Lobby        (anonymous browse, auth-gated actions)
/v2/room/:roomCode  V2Room         (seats, teams, ready, share, leave)
/v2/game/:code      V2GameTable    (felt table, hand, HUD, dock, dialogs)
/v2/practice        V2Practice     (facile / medio / forte / esperto)
/v2/profile         V2Profile
/v2/leaderboard     V2Leaderboard
/v2/annotate        V2Annotation
/v2/*               V2NotFound
```

Shell: `V2App` → `V2Shell` (scoped `.becca-v2` root, felt background, `V2Header`,
`V2ConnectionBanner`, `V2LiveRegion`) → route element.

## V1 navigation that needs a V2 adapter

These hardcode V1 paths and must not be edited; V2 needs its own thin wrappers:

- `src/hooks/useAuth.ts` — `navigate("/")` on redirect-on-fail and on logout.
  → `useV2Auth` wraps `useAuth({ redirectOnFail: false })` and performs its own
  `/v2` redirect + logout navigation.
- `src/lib/roomRedirect.ts` — `handleActiveRoomConflict` navigates `/game/:code`.
  → `src/v2/lib/roomRedirect.ts` with the same `ApiError` 409 + `activeRoomCode`
  contract and the same Italian toast, redirecting to `/v2/game/:code`.
- `src/components/Header.tsx` — `/profile`, `/leaderboard`, `/annotate`, `/`.
  → `V2Header` (new component, same actions and Italian labels).
- `src/pages/GameRoom.tsx`, `GameTable.tsx`, `Practice.tsx`, `Leaderboard.tsx`,
  `Annotation.tsx`, `Profile.tsx`, `NotFound.tsx` all navigate to `/` — V2 pages are
  new files, so they simply navigate to `/v2`.
- Room share/invite links must be built from `window.location.origin + "/v2/room/" + code`.

## Motion approach

Use **CSS transforms/opacity + Web Animations API + a small `useFlip` hook** (FLIP for the
played-card flight and trick collection) plus `react-dom`'s existing render cycle. A
`MotionProvider` reads `prefers-reduced-motion` and exposes `enabled`; all durations flow
through one `motion.ts` token file so reduced motion collapses them to 0.

**No new dependency is justified.** Framer Motion would add ~40kB gzip for effects that are
one-shot transform/opacity transitions and FLIP measurements; `tailwindcss-animate` is
already present, and keyframes live in the scoped `v2.css`.

---

## Phase 1 — Route foundation, scoped design system, shell, lobby

**Create**
- `src/v2/V2App.tsx` (nested `Routes`, lazy children, imports `v2.css`)
- `src/v2/styles/v2.css` (tokens, felt/paper texture, keyframes, `prefers-reduced-motion`)
- `src/v2/lib/cn.ts` (re-export `@/lib/utils`), `src/v2/lib/roomRedirect.ts`,
  `src/v2/lib/motion.ts`, `src/v2/lib/paths.ts` (single source of `/v2` URLs)
- `src/v2/hooks/useV2Auth.ts`, `src/v2/hooks/useReducedMotion.ts`
- `src/v2/components/shell/{V2Shell,V2Header,V2ConnectionBanner,V2LiveRegion}.tsx`
- `src/v2/components/ui/{V2Button,V2Panel,V2Field,V2Badge,V2Tooltip}.tsx`
  (thin wrappers over existing shadcn primitives; no edits to `src/components/ui`)
- `src/v2/components/cards/{V2Card,CardFan,AmbientCards}.tsx`
- `src/v2/pages/{V2Lobby,V2NotFound}.tsx`
- `src/v2/components/lobby/{CreateRoomPanel,JoinByCodePanel,RoomList,ActiveGamesList}.tsx`

**Modify (only this)**
- `src/App.tsx`: `const V2App = lazy(() => import("./v2/V2App"))` and
  `<Route path="/v2/*" element={<V2App />} />`.

**Reuse**: `apiGet`/`apiPost`/`ApiError`, `useAuth`, `useConnectionStatus`,
`registerLobbyHandlers` / `subscribeToLobbyEvent` / `leaveLobby`, `src/rooms/model.ts`
normalizers, `AuthDialog`, `public/images/cards`.
Endpoints unchanged: `/users/me`, `/users/logout`, `/rooms/`, `/rooms/join`.

**Boundaries**: `V2Lobby` owns room list + auth-dialog state and is the sole lobby socket
subscriber; child panels are presentational with callbacks.

**Animation / responsive**: cards deal + fan into the ambient background once, then settle;
pointer-only parallax; button press feedback. On `<768px` ambient cards render behind a
scrim at low opacity, `pointer-events-none`, clipped so they never cover controls.

**Risks**: double lobby subscription if both a panel and the page register handlers; V1
`useAuth` redirect firing to `/` — mitigated by `redirectOnFail: false` in `useV2Auth`.

**Tests**: `src/__tests__/v2/V2Lobby.test.tsx` (create/join happy path, empty-code Italian
error, 409 → `/v2/game/:code`, anonymous browse with gated actions),
`src/__tests__/v2/paths.test.ts`.
Verify: `npm test`, `npm run lint`, `npm run typecheck`, Playwright screenshots of `/v2` at
390x844, 768x1024, 1440x900, 1440x720.

**Acceptance**: `/v2` renders the lobby as the first usable screen; every V1 route and test
passes unchanged; V1 initial bundle unchanged (V2 chunk is separate).

---

## Phase 2 — Waiting room and practice (depends on Phase 1)

**Create**: `src/v2/pages/{V2Room,V2Practice}.tsx`,
`src/v2/components/room/{SeatRing,SeatPlace,TeamColumn,ReadyBar,ShareLink}.tsx`,
`src/v2/components/practice/TierCard.tsx`, `src/v2/hooks/useV2Room.ts`.

**Reuse**: `registerRoomHandlers`, `subscribeToRoomEvent`, `leaveRoom`, `src/sockets/events.ts`
types, `src/rooms/model.ts`, `POST /rooms/join`, `POST /rooms/practice`, the four existing
tier ids and their current Italian descriptions and loading/error behavior, and the
"la pratica non influisce sulla classifica" rule.

**Boundaries**: `useV2Room` is the single room-socket owner (register once per `roomCode`,
clean up on unmount); components are pure.

**Animation / responsive**: seats animate in on arrival, team swap slides between columns,
ready pops a check. Desktop = ring around a compact table; mobile = stacked team columns.

**Risks**: leaving the room on unmount must not fire during React 18 StrictMode double-mount;
share link must be `/v2/room/:code`.

**Tests**: unit tests for seat/team/ready reducers and capacity of two per team; Playwright
`e2e/v2-lobby-to-game.spec.ts` adapting `e2e/helpers/BotPlayer.ts` with `/v2` paths.
Screenshots at all four viewports.

**Acceptance**: four bots reach game start via `/v2`; V1 e2e specs untouched and green.

---

## Phase 3 — Game table, geometry, animation system (depends on Phase 2)

**Create**: `src/v2/pages/V2GameTable.tsx`,
`src/v2/components/table/{FeltTable,SeatPlate,CenterSlots,HandRail,HudBar,TurnCue,
Countdown,BriscolaBadge,SignalPop,Dock}.tsx`,
`src/v2/components/dialogs/{V2TrumpSuitDialog,V2SignalDialog,V2RoundEndDialog,
V2GameFinishedDialog,V2LastTrickSheet,V2ChatSheet}.tsx`,
`src/v2/hooks/{useFlip,useTableGeometry,useTrickHold}.ts`.

**Reuse without modification**: `useGameTable` (state fetch, socket sync, playable cards),
`src/game/state.ts` reducer, `src/game/model.ts`, `GET /games/:code/state`,
`GET /games/playable-cards/:code`, all socket events, `TrickHistoryDialog` and
`PracticeHistoryDialog` (dev-only) mounted inside the V2 dock.

**Boundaries**: page owns `useGameTable` + UI dialog flags and pending-card ref
(duplicate-submit protection); table components receive props only. Geometry comes from
`useTableGeometry` (a layout mode: `mobile | tablet | desktop | short-desktop`) — mobile is
a distinct composition, not scaled desktop absolutes.

**Behavior preserved**: briscola selection, server-returned legal cards only, leader-only
signals including `Niente`, follower path with no prompt, authoritative timer and reconnect,
auto-play/inactivity/departure, 3s completed-trick hold with input blocked, round and final
results, practice cleanup.

**Animation**: FLIP flight from hand/seat into fixed center slots; briscola and signal
flip/pop; turn cue travels between seats; countdown turns urgent under 10s without layout
shift; after the 3s hold, cards collect toward the winning seat and the score ticks;
layered-card round transition; restrained win celebration. Decorative motion pauses while
the socket is reconnecting and the table settles directly into the newest server state.

**Risks**: card buttons must be `<button>` with accessible names; illegal cards readable but
`disabled`; HUD must never overlap the hand at 1440x720; no horizontal overflow at 390px.

**Tests**: unit tests for geometry mode selection, trick-hold blocking, and signal gating;
Playwright `e2e/v2-first-trick.spec.ts`. Screenshots at all four viewports plus a
reduced-motion run.

---

## Phase 4 — Profile, leaderboard, annotation (depends on Phase 1)

**Create**: `src/v2/pages/{V2Profile,V2Leaderboard,V2Annotation}.tsx`,
`src/v2/components/annotation/V2AnnotationScenario.tsx` (or reuse
`AnnotationScenario` wrapped in a V2 panel where its markup already fits).

**Reuse**: `/users/me/stats`, `PATCH /users/me`, `DELETE /users/me`, `/annotations/status`,
`/annotations/next`, `src/annotations/{model,constants}.ts`, `TrickHistoryDialog`.

**Preserved**: all statistics and recent games, edit name / delete account / logout,
responsive ranking data, shared-code expert access, `legalActions`-driven enablement,
leader-only signal choice, `Non sono sicuro` + 500-char comment, easy/medium/hard difficulty,
response payload fields (scenario id, state hash, action or skip, difficulty, comment,
client response time), open-ended contribution count. Never render predicted difficulty,
importance, tags, model outputs, or suggested actions.

**Animation**: minimal — fades and press feedback only; no ambient cards.

**Tests**: adapt `src/__tests__/pages/{Profile,Leaderboard,Annotation}.test.tsx` patterns into
`src/__tests__/v2/`; Playwright `e2e/v2-annotation.spec.ts`.

---

## Phase 5 — Accessibility, reduced motion, validation, V1 regression

**Modify**: only `src/v2/**` and `src/__tests__/v2/**` / `e2e/v2-*.spec.ts`.

**Work**: audit 44px touch targets, visible focus rings, WCAG AA contrast on felt, non-color
status cues (icon + text next to team/ready/turn), `aria-live="polite"` announcements for
turn, reconnect, briscola, signal, trick winner, and score — never per-second timer ticks;
mobile safe-area insets; full `prefers-reduced-motion` pass removing parallax, travel,
loops, and celebration while keeping every piece of information.

**Verify**: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, plus a
Playwright pass capturing `/v2`, `/v2/room/:code`, `/v2/game/:code`, `/v2/practice`,
`/v2/profile`, `/v2/leaderboard`, `/v2/annotate` at 390x844, 768x1024, 1440x900 and
1440x720, once normally and once with `reducedMotion: "reduce"`.

**V1 regression**: `git diff --stat` must show changes only in `src/App.tsx`, `src/v2/**`,
and the new test files; all pre-existing unit and e2e specs green; `/`, `/room/:code`,
`/game/:code`, `/practice`, `/profile`, `/leaderboard`, `/annotate` screenshot-identical.

---

## Safest Build-mode prompt for Phase 1 only

> Implement Phase 1 of the Beccaccino V2 plan and nothing else. Create `src/v2/` with
> `V2App.tsx` (nested lazy routes for `/v2`, `/v2/*`), `styles/v2.css` containing all design
> tokens and keyframes scoped under `.becca-v2`, `lib/paths.ts`, `lib/roomRedirect.ts`
> (same `ApiError` 409 + `activeRoomCode` contract, redirecting to `/v2/game/:code`),
> `lib/motion.ts`, `hooks/useV2Auth.ts` (wraps `useAuth({ redirectOnFail: false })` and
> redirects to `/v2`), `hooks/useReducedMotion.ts`, the shell components
> (`V2Shell`, `V2Header`, `V2ConnectionBanner`, `V2LiveRegion`), V2 UI wrappers, the card
> components (`V2Card`, `CardFan`, `AmbientCards`) using `public/images/cards`, and the
> pages `V2Lobby` and `V2NotFound` with create-room, join-by-code, available rooms, active
> games, and practice entry. Reuse `apiGet`/`apiPost`, `useAuth`, `useConnectionStatus`,
> `registerLobbyHandlers`/`subscribeToLobbyEvent`/`leaveLobby`, `src/rooms/model.ts`, and
> `AuthDialog`. The ONLY file outside `src/v2/` you may change is `src/App.tsx`, adding a
> single lazy `<Route path="/v2/*" element={<V2App />} />`. Do not touch `src/index.css`,
> `tailwind.config.ts`, `components.json`, `src/components/ui`, or any V1 page or component.
> All product text stays in Italian. Add `src/__tests__/v2/V2Lobby.test.tsx` covering create,
> join-by-code, empty-code validation, and the 409 active-room redirect, then run
> `npm test`, `npm run lint`, and `npm run typecheck`.
