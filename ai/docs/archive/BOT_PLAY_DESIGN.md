# Archived: BECCA Play Against the Bots Design

> Historical design snapshot. Use the root README and current runbooks for
> present behavior and commands.

**Status:** **BUILT — all five phases.** A human can start a practice game from the UI
("Pratica contro i bot" → tier picker), play a full round against the trained model, and
review every signal in the move log with hands revealed. Verified in a browser against the
live Python service, and end-to-end for all four tiers. Per-phase notes in §8.

**2026-08-24 observation-contract update:** A2 extends new actor observations
from 462 to 470 floats by appending current-round captures (2), trick counts
(2), and a viewer-relative caller one-hot (4). The 462-float prefix is
unchanged, and `/act` encodes to each loaded checkpoint's own input width, so
the historical Run B/Run C tiers remain serveable. New 470-feature models are
not promoted by this schema change alone: the fixed-budget three-seed A2
ablation remains unrun and is still the promotion gate.

To run it: `cd ai && uvicorn serving.app:app --port 8011`, then set `BOT_SERVICE_URL` in
`backend/.env`. Unset, practice rooms still start but every bot seat falls back to autoplay
and logs `bot_fallback_to_autoplay`.

Deferred by design: the per-move confidence readout (§7 item 5, D3), any hosted deploy of
the Python service (§10), and mobile layout for the diagnostic rail (desktop-only, ≥xl).
**Author:** synthesized from a five-reader ground-truth pass + three competing proposals + four judge panels.
**Scope of this document:** *what to build* to let a human play a real game against the trained
bots, so we can watch them and judge whether they play sanely. It is a design, not an
implementation plan — illustrative type sketches only, no production code.
**Audience:** whoever implements this. Self-sufficient: it carries the *why*, the *what exists /
what must be built*, the *judgement calls*, and a *verify* step per phase. A reader who does not
know this codebase should be able to follow it. Beccaccino and RL terms are explained on first use.

Every claim about existing code cites `file:line`. Where a decision is a judgement call rather
than a fact, it is labelled as such.

---

## 1. Goal & non-goals

### 1.1 The immediate goal (diagnostic)

We have trained bots. **Nobody has ever watched one play a full game.** The strong model scores
~71% against a scripted heuristic opponent, but a win-rate number does not tell us *whether the
bot plays like a sane Beccaccino player.* Specifically we cannot currently answer:

- When a bot is the **caller** (the player who chooses the trump suit — "briscola"), does it pick
  a reasonable briscola, or something absurd?
- When a bot **leads a trick**, does it use the three public signals — **busso** ("I'm strong in
  this suit, partner play high"), **striscio** ("I have a run / general strength"), **volo** ("this
  is my last card of this suit") — correctly and honestly? A "volo" is a lie if the bot still holds
  cards of that suit.
- Does it follow suit, win tricks it should, and generally behave like it understands the game?

The immediate deliverable is a way to **sit down and play a real game as one human against three
bots, in the existing game UI, and watch them.** This is a diagnostic, and it must be trustworthy:
if what we watch is not genuinely the trained policy on a correct board, the diagnostic is
worthless (see §3.2, §5).

### 1.2 The downstream goal (teaching product)

The same machinery is the foundation for a **"Learn to play Beccaccino"** section: a human
practises against three bots, **choosing how strong they should be** (we have a natural difficulty
ladder — see §6), with a guide layered on top. This design keeps that door open — it does not
paint the teaching product into a corner — but it **optimises the near-term build for the
diagnostic** and defers everything the teaching product needs but the diagnostic does not.

### 1.3 Non-goals (this iteration)

- **No production deployment of the bots.** The diagnostic runs locally. What it costs to host a
  Python inference service on Render is priced honestly in §6/§10 and explicitly deferred.
- **No all-bot (zero-human) auto-watch mode.** Only *human vs. 3 bots*. Note the reason is narrow:
  during normal operation an all-bot room *would* chain fine on its own, because each `playCard`
  re-arms `startTurnTimer` for the next seat (§3.4) — no human is needed to advance bot turns. The
  single gap is **restart recovery**: after a server restart the in-memory timers are gone and are
  re-armed lazily only when a *client* fetches state (`gameController.ts:285-292`); with no human
  client in the room, nothing re-drives the chain. That restart-only gap is not worth closing for a
  diagnostic the user drives by playing, so all-bot mode stays out of scope.
- **No re-training, no new model architectures, no PIMC-as-shipped-tier.** We use the checkpoints
  that already exist. PIMC (a search-based "hard" bot) is wired last and optional.
- **No guest / anonymous play.** Practice requires a logged-in human (that's you) — see §3.3.
- **No confidence/rationale as a hard requirement.** A per-move confidence readout is a cheap,
  high-value *option* (§5.4, §7) but is not on the critical path to watching a game.

---

## 2. Current state (what exists today)

### 2.1 The blunt facts

- **There is ZERO AI integration in the backend today.** A grep for `onnx`, `obs`, `OBS_SIZE`,
  `predict`, `462`, `action_mask`, `CARD_INDEX` across `backend/src/**` returns nothing. This is a
  greenfield seam — nothing to refactor, nothing to break.
- **Signals are ALREADY fully wired in the backend.** No new signal plumbing is needed:
  - `PlayedCard.signal String?` (`backend/prisma/schema.prisma:134`) stores `"striscio" | "busso" |
    "volo" | null`.
  - `playCard` accepts a `signal` and persists it **only for the trick leader** — the guard is
    `playedCards.length === 0 && signal ? signal : null` (`gameService.ts:459`), which mirrors the
    Python "only the leader may signal" rule.
  - The `card_played` socket event carries `signal` to every client (`gameService.ts:474`), and the
    frontend already receives it (`GameTable.tsx:451`).

### 2.2 The Python side (`ai/`)

- **`ai/becca_env/game.py`** — `BeccaGame`, a complete, self-sufficient Beccaccino engine
  (deal → briscola → follow-suit → trick → score → game-over). `RoundState` (`game.py:49-58`) holds
  `caller_seat`, `tricks_played` (a list of `TrickRecord`s, each with `winner`, `cards` as an ordered
  `list[(seat, Card)]`, `signal`, `signal_seat`), `current_trick`, `trick_starter`, `trick_signals`,
  `player_hands`, and `number`. `total_scores` is **cumulative RAW points per team** (`game.py:82`,
  accumulated at `:317-318`).
- **`ai/becca_env/observation.py`** — the encoder. `encode_observation(game, seat)` produces a
  fixed **470-float** vector (`OBS_SIZE = 470`), with an unchanged 462-float legacy prefix;
  `encode_action_mask(game, seat)`
  produces a **160-slot** legal-action mask; `decode_action(idx, game)` inverts an action index back
  to a move. Layout and index tables verified — see §5.2.
- **`ai/serving/app.py`** — a FastAPI service. Its only real endpoint, `POST /predict`
  (`app.py:44`), takes a **pre-encoded** `{obs: float[470], action_mask: float[160]}`, validates the
  widths (422 on mismatch, `app.py:50-56`), runs the ONNX model, and returns a **greedy argmax**
  `{action: int, confidence: float}` (`app.py:71-76`). **It does not encode anything** — it cannot
  turn game state into an observation. This matters: it does *not* save us from the encoder problem
  (§3.2).
- **`ai/evaluation/arena.py`** — `NeuralAgent(net, device, temperature=0.0)` (`arena.py:34-62`) is
  the agent wrapper the eval harness uses. `select_action(game, seat)` calls `encode_observation` +
  the net + `decode_action`; `temperature <= 0` → deterministic argmax, `temperature > 0` → sampled
  from a `Categorical` (`arena.py:54-59`). This is the lever for less-robotic weak bots (§6).
- **`ai/evaluation/heuristic.py`** — `HeuristicAgent.select_action(game, seat)` (`heuristic.py:87`),
  a scripted rules baseline, no neural net. Needs the full Python engine.
- **`ai/inference/pimc.py`** — a perfect-information Monte-Carlo search bot. `rollout_policy`
  defaults to `"heuristic"` (`pimc.py:62`). Committed, tested, not wired to serving.
- **`ai/training/checkpoint.py`** — `load_checkpoint(path)` + `build_net(ckpt, device)`
  (`checkpoint.py:59,78`) rebuild any checkpoint's exact architecture from a stamped `net_config`.

### 2.3 The models we have (the difficulty ladder is a real asset)

All three live only in `ai/checkpoints/kaggle-runb/checkpoints/` on this laptop (+ Kaggle); they
are **gitignored** (`ai/.gitignore` ignores `*.onnx`, `checkpoints/*.pt`, and `checkpoints/kaggle*/`)
and there is no object store or registry.

| Tier name | Artifact | What it is | Strength (as measured by eval harness) |
|-----------|----------|------------|-----------------------------------------|
| weak | `runB_bc.pt` (5.0 MB) | Behavioral-cloning only — imitates the heuristic | ~28.5% vs heuristic; **Elo 877** |
| mid | *(none — code)* | `HeuristicAgent`, scripted rules | the yardstick: BC loses to it, RL beats it |
| strong | `runB_rl.pt` (5.0 MB) | The RL self-play model | ~71% vs heuristic; **Elo 1123** (+246 over BC) |
| hard | *(none — code)* | PIMC search on top of RL | intended ceiling; wired last, optional |

("Elo" is a relative strength score; higher = stronger. "BC" = behavioral cloning, learning to copy
the heuristic. "RL" = reinforcement learning by self-play.) Both `.pt` checkpoints are the V4
transformer architecture (`d_model=192`), and both load through `build_net`.

### 2.4 The backend game loop (where a bot has to plug in)

- **`startTurnTimer(roomCode, currentTurnUserId, phase)`** (`turnTimer.ts:32`) is the **single
  universal turn-handoff chokepoint.** There is no stored "current turn" field; whose turn it is is
  derived on the fly. `startTurnTimer` is called from all six turn-transition sites, clears any prior
  timer, arms a `setTimeout(executeAutoPlay, …)` (60 s for a card, 90 s for briscola), registers a
  `TimerState` in the `activeTimers` map, and emits `turn_timer_started` to clients. It already has a
  precedent for a per-seat early-return: a **kicked** player is auto-played and the function returns
  before arming a normal timer (`turnTimer.ts:40-44`). It keeps three in-memory per-room maps:
  `activeTimers`, `timeoutCounts`, `kickedPlayers` (`turnTimer.ts:28-30`).
- **`playCard({roomCode, userId, suit, value, signal?})`** (`gameService.ts:349`) is how a move is
  applied. It wraps `playCardUnlocked` in `withRoomLock`, clears the timer (`:385`), rejects with
  `"It's not this player's turn"` unless the acting seat's `userId` matches (`:433`), persists the
  `PlayedCard` (signal only for the leader, `:459`), emits `card_played` (`:474`), and re-arms
  `startTurnTimer` for the next seat / trick winner / next round (`:511`, `:542`, `:735`).
- **`setBriscola({gameRoomId, playerId, suit})`** (`gameService.ts:221`) is the briscola-phase move.
  **Note the asymmetry: `playCard` is keyed on `userId`, `setBriscola` on `playerId`.** A bot driver
  must resolve both for a seat.
- **`autoPlayCard` / `autoChooseBriscola`** (`turnTimer.ts:181,194`) are the existing timeout
  fallbacks: play the first legal card / choose the most-held suit. They already prove a non-human
  actor can drive `playCard`/`setBriscola` end to end. They are the natural **safety fallback** for a
  bot.
- **Restart recovery:** in-memory timers vanish on restart and are re-armed lazily the first time a
  client fetches state (`gameController.ts:285-292`, routing through `startTurnTimer`).

### 2.5 Identity & seating constraints

- `Player.userId Int` is a **required, non-nullable FK to `User`** (`schema.prisma:60,63`). Every
  occupied seat must point at a real `User` row.
- `Player` has `@@unique([gameRoomId, seat])` and `@@index([userId])` (`schema.prisma:67-68`); `seat`
  is `Int?` (nullable). `setupRound` assigns seats 0-3 itself at round 1 (`gameService.ts` setup path).
- `User.username` is `@unique`; `email`/`googleId` are optional (`schema.prisma:37-42`).
- The game-start gate: game starts only when every player `isReady === true` and there are exactly 2
  players per team (`roomController.ts:402,404,418`), which then calls `setupRound`.
- **Aggregates have no bot/practice filter:** `getUserStats` queries by the human's `userId` over
  finished games (`userController.ts:195-198`); `getLeaderboard` aggregates per-user over finished
  games and is cached 60 s (`userController.ts:431-442,416`); `metrics.ts` counts started/open rooms
  (`metrics.ts:28-30`). Any persisted practice game pollutes all three unless fenced.

### 2.6 The frontend (`frontend/`)

- Entry cards ("Crea una nuova stanza", "Entra con il codice") live in `Index.tsx:504,537`. Routes
  are registered in `App.tsx:25-30` (`/`, `/room/:roomCode`, `/game/:gameRoomCode`, `/profile`,
  `/leaderboard`, `*`); there is no `/practice` route.
- `GameTable.tsx` (~1100 lines) is fully **userId/seat-driven**: it renders whatever players the
  server reports and gates interaction on `currentTurnUserId === userId`. It does not assume 4
  humans, so **bots that exist as real `Player` rows and are driven server-side render correctly
  as-is.**
- The state endpoint returns only the human's own hand (`myCards`, `gameController.ts:305`) — no
  other player's cards.
- Signal display today is **partial and ephemeral**: `currentSignal` is rendered as a badge only on
  the top seat (`GameTable.tsx:853`) and cleared every new trick (`:454`). There is no move history.

---

## 3. The four hard problems

Each problem states the options, the **decision**, and the reasoning. The panels agreed on the
architecture and split on details; where they split, it is called out.

### 3.1 Where does the bot's "brain" live?

**Problem.** To pick a move, a bot must (1) turn the current game state into the 470-float
observation, (2) run a model or policy, (3) turn the chosen action index back into a move. Step (1),
the encoder, is ~310 lines of Python with data-dependent control flow (deducing which seats are void
in which suit; relative-seat signal rows). Where does this run?

**Options.**
- **(a) Python FastAPI service**, reused verbatim, reached by the backend over HTTP.
- **(b) `onnxruntime-node` inside the Node backend** — forces porting the encoder to TypeScript, and
  cannot carry the heuristic/PIMC tiers (they need the full Python engine). The runtime image is
  `node:24-alpine` (musl libc); `onnxruntime-node` prebuilt binaries target glibc and commonly fail
  to load on Alpine.
- **(c) Python sidecar in the same container** — non-idiomatic on Render, heavy image.
- **(d) Local-dev-only Python** — same as (a) but never deployed.
- **(e) Browser (`onnxruntime-web`)** — **disqualified**: encoding the bot's observation needs the
  bot's *private hand*; running it in the human's browser leaks the bot's cards, and it re-incurs the
  TS-port risk.

**Decision.** **Python owns encoding + inference (option a/d).** For the diagnostic it runs
**locally** alongside the backend; the exact same code becomes a deployed service later by pointing
one env var at it. Concretely: extend `ai/serving/app.py` with a **new `POST /act` endpoint that
takes raw game state** (not the pre-encoded vector `/predict` wants) and owns
`encode_observation → policy → decode_action` end to end.

**Reasoning.** Keeping the encoder in Python means there is exactly **one** encoder, shared by
training and serving — encoder divergence is not *mitigated*, it is *structurally impossible* because
no second implementation exists. This directly kills the highest-severity risk (§3.2). It is also the
only option that can carry all four tiers, since the heuristic and PIMC bots require the full Python
engine.

> **The kill-switch (grafted from the "Python Oracle" proposal).** The backend reaches the service
> via `BOT_SERVICE_URL`. **If `BOT_SERVICE_URL` is unset, bots are simply disabled** — so the feature
> ships to production as dead-until-configured, with zero prod cost, zero new Render service, and no
> artifact-home decision, until the teaching product is deliberately funded.

### 3.2 Observation-encoder parity — the central technical risk

**Problem.** Even with the encoder in Python, the *backend* must serialize its game state and send
it across an HTTP boundary; Python must faithfully reconstruct a `BeccaGame` from that. Any drift
here produces a bot that **loads, runs, and plays plausibly but reads the wrong board** — the exact
silent-wrong-answer failure that would poison the diagnostic.

The sharpest trap: **the Python card index and the Prisma enum disagree on suit order.** Python's
`Suit` is `DENARA, SPADE, COPPE, BASTONI` (`deck.py:8-12`); Prisma's is `denara, coppe, spade,
bastoni` (`schema.prisma:13-17`) — **spade and coppe are transposed.** `CARD_INDEX` is suit-major
over the Python order (`observation.py:47`), and `SUIT_INDEX` drives the briscola one-hot and the
void-mask columns (`observation.py:48`). Any code that derives a numeric index from the Prisma enum
would transpose 20 card indices, swap the trump one-hot, and swap void-mask columns. (Value order
matches between the two, so only suits are at risk.)

**Options.**
- **Port the encoder to TypeScript** and parity-test it. This is the risk, not the fix.
- **Ship strings, index only in Python.** The backend sends enum **strings** (`"denara"`, `"spade"`,
  `"asso"`, …) and never computes a card, suit, or action index. Python resolves each string with its
  *own* `Suit("spade")` lookup.

**Decision.** **Ship strings; the backend computes no index at all.** Because Python resolves
`Suit("spade")` to its own ordinal regardless of how Prisma orders its enum, **the spade/coppe
transposition has no code path in which to occur.** The problem collapses from "reimplement 462
legacy floats plus the 8 appended public features correctly" to "translate ~8 game-state fields
into dataclass fields faithfully."

**But** two residual value-level risks remain, and both must be reconstructed by hand — call them out
loud:
1. **Scores.** Python's `total_scores` is cumulative **raw** points (`game.py:82,317`), and
   `encode_observation` normalizes by `win_points * 3` (`observation.py:222-224`). The backend stores
   **real** points and figures in *separate* columns per round (`Round.team0Points` +
   `Round.team0Figures`, `schema.prisma:112-115`). So the serializer must send
   **`raw = Σ (points_i * 3 + figures_i)`** per team. Summing only points drops each round's figures
   remainder and drifts. *(Note: the root `CLAUDE.md` says "Points stored as raw×3 in DB" — this is
   wrong; the code stores real points + figures. `computePoints` returns `floor(raw/3)`.)*
2. **Full round, ordered by play.** The void-mask, signal-mask, and card-status blocks walk *every
   completed trick of the round* with cards in **play order** (`observation.py:_compute_void_mask`,
   `_compute_signal_mask`, and the status loop). The serializer must therefore send the *whole round*
   with each `PlayedCard` carrying its seat and `position` — reuse the **full-round query shape** at
   `gameService.ts:548` (`hand.findMany … cards orderBy position include player`), **not** the
   latest-hand fetch. (Grafted from the "One Encoder" proposal.)

The full parity strategy — golden fixtures + a runtime gate — is §5. It is the most important section.

### 3.3 Bot identity & seating

**Problem.** `Player.userId` is a required FK (`schema.prisma:60`) and the whole turn loop is keyed
on `userId` (`gameService.ts:433`, `startTurnTimer`, `gameController`). How do we seat 3 bots without
breaking the live human game, and without polluting the leaderboard?

**Options.**
- **(a) Fixed pool of 3 seeded bot Users**, reused across games.
- **(b) Nullable `Player.userId` + `botModel` column** — forces re-keying the entire turn loop off
  `userId`. Rejected: too much blast radius on a live product.
- **(c) Per-game bot Users**, namespaced `bot-<code>-<seat>`, created per practice game.

**Decision — a hybrid the panels converged on:**
- **Keep `Player.userId` NON-NULL.** Bots are real `User` rows. This is the single biggest
  blast-radius reducer: **zero change to turn identification.** (All three proposals agreed.)
- **Use a bounded, idempotent fixed pool** of 3 reserved bot Users via an `ensureBotUsers()` helper
  (grafted from "Python Oracle"; the two runner-up proposals used per-game users and *admitted* the
  unbounded, undeletable row accumulation as scaling debt under the `ON DELETE RESTRICT` FK). The
  fixed pool is mechanically safe because **bots never call `createRoom`/`joinRoom`, so they never
  trip the per-`userId` "already in an active game" guard** (`roomController.ts:17,228`), and every
  player lookup is scoped to one room's loaded players.
- **Add three small, additive columns**, one migration (precedent: the `added_team` migration is a
  single `ALTER TABLE … ADD COLUMN … ; ALTER COLUMN … DROP NOT NULL`):
  - `User.isBot Boolean @default(false)` — fences bot Users out of `getLeaderboard`.
  - `Player.botModel String?` — which tier drives *this seat* (`"weak"|"strong"|"heuristic"|"hard"`),
    persisted so it survives a restart.
  - `GameRoom.isPractice Boolean @default(false)` — marks the room so we can (i) exclude the human's
    own practice games from stats, and (ii) gate the reveal-hands field server-side (§7).
- **Fence all three aggregates** (this is the highest-blast-radius integration point — a panel found
  that an `isBot`-only filter is *insufficient*): add `WHERE gameRoom.isPractice = false` (and exclude
  `isBot` users) to **`getLeaderboard`** (`userController.ts:431`), **`getUserStats`**
  (`userController.ts:195`), **and** `metrics.ts` (`:28-30`). `getUserStats` queries by the *human's*
  `userId`, so filtering only `isBot` would still count the human's practice games — the
  `isPractice` room flag is what excludes them.

> **Judgement call (stated openly):** the fixed pool means 3 bot `User` rows become effectively
> permanent once they own a finished-game `Player` (the FK is `ON DELETE RESTRICT`). That is 3 rows,
> fenced from every aggregate — acceptable for a diagnostic. If concurrent practice games ever become
> common, revisit (a future teaching product at scale may prefer the nullable-userId model). We are
> **not** choosing per-game users precisely to avoid unbounded row growth.
>
> **Why the 3 fixed bot Users are safe in *concurrent* practice games (justified, not asserted).**
> Two practice games running at once would seat the *same* 3 bot `User` rows in two different rooms
> simultaneously. This is safe because nothing about a bot is keyed on the global `userId` alone:
> - The `@@unique` constraint that could collide is `[gameRoomId, seat]` (`schema.prisma:67`) — it is
>   **scoped to a room**, so bot user 42 sitting at seat 1 in room ABCD and at seat 1 in room WXYZ are
>   two distinct `Player` rows with no conflict. There is no global unique on `userId`.
> - Every turn-loop lookup is already **room-scoped**: `playCard`/`setBriscola` and the auto-play
>   fallbacks resolve the seat inside a single room's loaded `players` (e.g.
>   `room.players.find(p => p.userId === userId)`, `turnTimer.ts:207`), never "the Player for user 42"
>   globally. `withRoomLock` (`gameService.ts:356`) also serializes per `roomCode`, so two rooms'
>   moves never interleave on shared state.
> - The `botSeats` registry (§3.4) is keyed **by `roomCode`** (`Map<roomCode, Map<userId, botModel>>`),
>   so each room's bot dispatch reads its own entry.
> - The "already in an active game" guard (`roomController.ts:17,228`) is never tripped by bots
>   because bots never call `createRoom`/`joinRoom`; the human in each room is a *different* user.
>
> The one thing the fixed pool cannot support is **the same human in two concurrent practice games**
> (they would fail the human's own active-game guard) — which is not a goal.

### 3.4 Turn triggering — how a bot's turn fires

**Problem.** Bots are not socket clients. Something server-side must notice "it is now bot seat X's
turn" and make the move. Three hazards lurk: **double-fire** (bot move races the 60 s auto-play
timer), **stuck seat** (bot hangs with no fallback), and **silent kick** (a slow bot accrues
timeouts, gets kicked after 3, and is silently replaced by the dumb heuristic forever — corrupting
the diagnostic).

**Decision — one early branch at the top of `startTurnTimer` (`turnTimer.ts:32`)**, mirroring the
existing kicked-player early-return (`:40-44`). All three proposals landed here; it is the only
per-turn "it is now X's turn" signal in the backend, and it is called from all six transition sites.

On each handoff, resolve whether the acting seat is a bot. The panels **split on how**:
- Two proposals do a `findFirst` DB query on the seat's `Player`+`User` *on every handoff of every
  game* — but `startTurnTimer` is **synchronous and DB-free today**, so this injects a DB round-trip
  and an async contract change into the live human path. A blast-radius panel explicitly penalised
  this.
- The winning proposal uses an **in-memory registry** (`botSeats: Map<roomCode, Map<userId,
  botModel>>`) alongside the file's existing `activeTimers`/`timeoutCounts`/`kickedPlayers` maps,
  populated when the practice game is created and re-populated in the restart-recovery path.

**Decision: use the in-memory registry.** It keeps the live human turn path synchronous and DB-free,
and it mirrors a pattern already in the file. If the seat is **not** a bot, behaviour is unchanged.
If it **is** a bot:
1. Emit `turn_timer_started` (so the human UI shows a "thinking" indicator).
2. **Do NOT** arm the human `setTimeout`, **do NOT** register in `activeTimers`, **do NOT** touch
   `timeoutCounts`. This closes all three hazards: no double-fire (no human timer armed), no
   kick-after-3 (never enters `executeAutoPlay`'s count path).
3. After a deliberate, named **`BOT_THINK_DELAY_MS`** (~900-1200 ms — so consecutive bot turns land
   one card at a time and don't resolve as an instant "tick storm"), fetch the seat's state, call
   `/act`, and apply the move through the **same** `playCard`/`setBriscola` humans use.
4. Wrap the whole dispatch in its **own** `BOT_MOVE_DEADLINE_MS` timer that, on `/act` failure or
   slowness, falls back to the existing `autoPlayCard`/`autoChooseBriscola` (`turnTimer.ts:181,194`)
   — so a bot seat can never hang — and **logs the fallback loudly and distinctly** (grafted from
   "Python Oracle"): a fallback means the seat is *not* the model, and if that is silently mistaken
   for the model the diagnostic is corrupted.

Because `playCard`/`setBriscola` re-arm `startTurnTimer` for the next seat, **consecutive bot turns
chain automatically** (bot → bot → bot) with the think-delay between each — no dedicated bot loop, no
polling. The residual race (a slow `/act` completing just as the deadline fires) is made *safe, not
silent* by `withRoomLock` + the turn-check at `gameService.ts:433`: the loser throws and does not
double-mutate.

**Restart recovery.** In human-vs-3-bots the human's client fetches state after a restart, which
re-routes through `startTurnTimer` (`gameController.ts:285-292`) and re-drives the bot. (An all-bot
room would stall — hence the non-goal in §1.3.)

**Client reconnect mid-bot-turn (must be idempotent).** `socketClient` reconnects with
`reconnectionAttempts: Infinity` (`socketClient.ts:33`), so a human whose browser briefly drops will
re-fetch state (`getGameState`) mid-bot-turn. That fetch runs the restart-recovery branch, whose
guard is `!timerState` (`gameController.ts:285`). **A bot seat deliberately does not register in
`activeTimers` (§3.4 step 2), so `getTurnTimerState` returns null for it** — meaning a reconnect
*can* re-enter `startTurnTimer` for a seat that already has a `scheduleBotMove` in flight, i.e. two
dispatches for the same turn. This is made **safe, not prevented**, by the same mechanism as the
deadline race (§3.4): both dispatches call `playCard`/`setBriscola`, which serialize on
`withRoomLock` (`gameService.ts:356`) and re-check the acting seat at `gameService.ts:433`; the
second one finds the turn already advanced and throws harmlessly. *(If double-dispatch ever proves
noisy in practice, gate `scheduleBotMove` on a per-room "dispatch in flight" flag in the `botSeats`
registry — but the lock makes it correct without that.)*

### 3.5 Human quits / abandons a practice game

**Problem.** Testing the diagnostic means starting and quitting **many** games, so this is the path
we hit most, not an edge case. The existing `leaveRoom` (`roomController.ts:477-532`) only deletes
the `GameRoom` when `room.players.length === 1` (`:498`). A practice game has **4 players** (1 human
+ 3 bots), so a quitting human takes the **else-branch** (`:511-521`): only the human's own `Player`
row is deleted (`:513`) and the room is left `started:true` / `finished:false` **forever**, with 3
orphaned bot `Player` rows still attached.

Two concrete consequences the rest of this doc did not price:
1. **Zombie rooms + orphaned bot Player rows accumulate — one set per abandoned game.** This
   directly undercuts the "bounded to 3 fixed rows" safety claim in §3.3: that bound holds for the 3
   fixed bot *`User`* rows, but **not** for `Player` rows, which are per-game and here leak on every
   quit. It also leaves `isPractice=true, finished=false` rooms lingering (they are fenced from the
   aggregates by §3.3, but they are still junk that grows without bound).
2. **The bot chain can re-arm a timer for a seat whose `Player` no longer exists.** If the human
   quits mid-trick while a bot dispatch is in flight (or a later recovery fetch fires), `startTurnTimer`
   / `scheduleBotMove` can arm a turn for a seat whose `Player` row was just deleted. The two auto-play
   fallbacks fail *differently*, and neither is silent: `autoPlayCard`→`playableCards` **throws**
   `"Player not in this game room"` (`cardService.ts:61-64`) before reading any cards — that throw is
   caught by `executeAutoPlay` and reported to Sentry under the `auto_play_race` tag with an
   `auto_play_failed` warn log (`turnTimer.ts:158-178`), so it is **logged, not silent**, though the
   turn still fails to advance. (The `if (cards.length === 0) return;` early-return at `turnTimer.ts:183`
   is a *different* case — Player still exists but holds zero cards — not the deleted-seat case here.)
   `autoChooseBriscola` does `room.players.find(...) → undefined` and `return`s (`turnTimer.ts:207-208`).
   Worse, the *human's own* seat being gone means a re-armed human timer points at a vanished player.
   The turn loop can wedge with no visible actor.

**Decision.** On human leave of a practice room, do **not** take the current else-branch. Instead,
in `leaveRoom`, branch on the room: **if `room.isPractice` (or, equivalently, the only non-bot player
is the one leaving), tear the whole room down** exactly as the `length === 1` path already does —
`player.deleteMany({ where: { gameRoomId }})` then `gameRoom.delete(...)` — which also removes the 3
bot `Player` rows (the bot `User` rows stay; they are the reusable fixed pool, §3.3). **Before** the
delete, stop the bot chain for that room: clear the timer and drop the room from the `botSeats`
registry (add `clearRoomTimerData(roomCode)` — `turnTimer.ts:108` already deletes
`activeTimers`/`timeoutCounts`/`kickedPlayers` — plus a one-line `botSeats.delete(roomCode)`), so no
in-flight `scheduleBotMove` re-arms a timer for a deleted seat. A practice game has exactly one human,
so "human leaves" always means "abandon the whole game" — there is no partial-leave semantics to
preserve.

**Verify (folded into Phase 3/4):** an integration test that starts a practice game, calls
`leaveRoom` as the human mid-round, and asserts the `GameRoom` and **all 4** `Player` rows are gone,
the 3 bot `User` rows remain, `getTurnTimerState(roomCode)` is null, and no `scheduleBotMove` fires
afterward (no `card_played` emitted post-leave).

---

## 4. Architecture

### 4.1 Components

```
┌─────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React, frontend/)                                           │
│  Index "Pratica contro i bot" card → /practice (tier picker)          │
│  → POST /api/rooms/practice → navigate to existing /game/:code        │
│  GameTable.tsx renders bots as ordinary players (userId-driven).      │
│  Diagnostic surface: persistent move-log, all-seat signal badges,     │
│  reveal-hands toggle (§7).                                            │
└───────────────┬───────────────────────────────────────────────────────┘
                │ REST + Socket.IO (unchanged; bots emit card_played/
                │ briscola_chosen exactly like humans)
┌───────────────▼───────────────────────────────────────────────────────┐
│ BACKEND (Express + Socket.IO + Prisma, backend/)  — AUTHORITATIVE      │
│  startTurnTimer  ──bot seat?──► scheduleBotMove():                     │
│    getStateForSeat(roomCode,userId)  ── strings-only DTO ──┐           │
│    playCard / setBriscola  ◄── move as strings ──┐         │           │
│  ensureBotUsers(); POST /api/rooms/practice; isPractice fences.        │
└───────────────┬─────────────────────────────────────────┬─────────────┘
                │ HTTP POST BOT_SERVICE_URL/act            │
                │ (unset ⇒ bots disabled)                  │
┌───────────────▼─────────────────────────────────────────▼─────────────┐
│ PYTHON /act  (ai/serving/app.py + state_adapter.py)  — LOCAL for now   │
│  state_adapter: DTO(strings) → BeccaGame/RoundState                    │
│  encode_observation (VERBATIM training encoder) → 470 floats           │
│  tier registry: weak=NeuralAgent(runB_bc), strong=NeuralAgent(runB_rl),│
│                 heuristic=HeuristicAgent, hard=PIMC(rollout=heuristic)  │
│  decode_action → {suit} | {suit,value,signal, confidence}             │
│  runtime legal-move gate: legal_actions() vs expected_legal → 409      │
└───────────────────────────────────────────────────────────────────────┘
```

### 4.2 Sequence — one bot **card** move end to end

```
startTurnTimer(roomCode, botUserId, "play_card")
  │  botSeats registry says botUserId is a bot (tier T)
  ├─ emit turn_timer_started {turnUserId: botUserId}   → human UI shows "thinking"
  ├─ (do NOT arm human timer / activeTimers / timeoutCounts)
  └─ after BOT_THINK_DELAY_MS:
       state = getStateForSeat(roomCode, botUserId)     // strings-only DTO,
                                                         // full round, cards by position,
                                                         // cumulative raw scores
       POST BOT_SERVICE_URL/act { state, seat, tier: T, temperature }
         │  Python: state_adapter → BeccaGame
         │          encode_observation(game, seat) → obs[net.obs_size]
         │          encode_action_mask(game, seat) → mask[160]
         │          legal_actions() vs state.expected_legal_cards → 409 if disagree
         │          policy(obs, mask) → action_idx ; decode_action → (Card, Signal)
         └─ ← { suit:"denara", value:"tre", signal:"busso", confidence:0.72 }
       playCard({ roomCode, userId: botUserId, suit, value, signal })   // userId-keyed
         └─ persists PlayedCard (signal kept only if leader), emits card_played,
            re-arms startTurnTimer for the NEXT seat  → chains to next bot or human
  (fallback) if /act errors or exceeds BOT_MOVE_DEADLINE_MS:
       autoPlayCard(roomCode, botUserId)  + LOUD log "bot_fallback_to_autoplay"
```

### 4.3 Sequence — bot **briscola** choice (caller is a bot)

```
startTurnTimer(roomCode, botUserId, "choose_briscola")
  │  bot seat, tier T
  └─ after BOT_THINK_DELAY_MS:
       state = getStateForSeat(...)                     // phase = choose_briscola
       POST /act { state, seat, tier: T }
         │  Python: phase == CHOOSE_BRISCOLA → mask[:4] = 1 (four suits)
         │          policy → action_idx ∈ 0..3 ; decode_action → Suit
         └─ ← { suit: "coppe", confidence: 0.61 }
       resolve botUserId → playerId for the seat        // setBriscola is playerId-keyed!
       setBriscola({ gameRoomId, playerId, suit: "coppe" })
         └─ emits briscola_chosen (briscola shows in UI badge), arms caller's first-card timer
```

The `suit`/`value`/`signal` fields crossing the boundary are always **enum strings** — the backend
never computes an index.

---

## 5. The observation-parity strategy (the main technical risk)

This section must be strong; §3.2 established that the residual risk is **state-reconstruction
fidelity in the TypeScript serializer**. We defend it in **three layers**, from cheapest to loudest.
The panels disagreed about how many layers are worth it — that disagreement is resolved at the end.

### 5.1 The verified layout and card-ordering mapping

`encode_observation` emits 470 floats in this exact order. Offsets 0:462 are
the unchanged legacy prefix; offsets 462:470 are the A2 public features:

| Offset | Size | Block | Reconstruction note |
|-------:|-----:|-------|---------------------|
| 0 | 40 | my_hand (binary) | the bot's private hand |
| 40 | 200 | card_status 40×5 (unseen/mine/partner/left/right) | relative to seat via `(player_seat - viewer_seat) % 4` (`observation.py:_seat_status_class`) |
| 240 | 160 | current_trick 4×40 | indexed by **play order**, aligns with `PlayedCard.position` |
| 400 | 4 | briscola one-hot | `SUIT_INDEX` (Python suit order) |
| 404 | 4 | my_seat one-hot | **absolute** seat |
| 408 | 4 | trick_starter one-hot | **absolute** seat |
| 412 | 10 | trick_number one-hot | `min(len(tricks_played), 9)`, **0-indexed** (backend `Trick.number − 1`) |
| 422 | 10 | round_number one-hot | `min(round.number − 1, 9)`, **0-indexed** |
| 432 | 2 | scores (team0, team1) | cumulative **raw** / `(win_points*3)`, clipped to 1 |
| 434 | 16 | void_mask 4×4 | rows **relative**: row0=me(zero), row1=left, row2=partner, row3=right |
| 450 | 12 | signal_mask 4×3 | rows relative; **row0=me IS populated** (unlike void) |
| 462 | 2 | round_captures | current-round raw points captured by team0/team1, divided by 35 |
| 464 | 2 | round_tricks | current-round trick counts for team0/team1, divided by 10 |
| 466 | 4 | caller | one-hot caller seat relative to the viewer |

**Index tables (the trap):**
- `CARD_INDEX = {card: i for i, card in enumerate(DECK)}` where `DECK = [Card(s,v) for s in Suit
  for v in Value]` → **suit-major**, so `card_index = suit_ordinal*10 + value_ordinal` in **Python
  suit order `[denara, spade, coppe, bastoni]`** (`deck.py`, `observation.py:47`).
- `SUIT_INDEX = {s: i for i, s in enumerate(Suit)}` — same Python order (`observation.py:48`).
- `SIGNAL_INDEX`: striscio=0, busso=1, volo=2 (`observation.py:53`).
- Action decode: `card_idx = action // 4`, `sig_idx = action % 4` (0=none,1=striscio,2=busso,3=volo);
  briscola phase `action 0-3 → list(Suit)[action]` (`observation.py:293-312`).

**The defence:** the backend serializer emits only strings (`"spade"`), and Python does every
lookup. `Suit("spade")` returns the correct Python member no matter Prisma's ordering. There is no
transposition because there is no backend-side index.

### 5.2 Layer 1 — golden-fixture parity test (STATIC, in `ai/`, before any bot plays)

Add `ai/serving/state_adapter.py` with `state_dict_to_game(dto) → BeccaGame` and
`game_to_state_dict(game, seat) → dto`. Then the strongest possible static invariant (grafted from
"Python Oracle" — a round-trip against the *live* game object, not a stored vector, so no
stale-fixture drift):

```python
# ai/tests/test_state_adapter_parity.py  (sketch — not final code)
for _ in range(N_RANDOM_GAMES):          # play random legal self-play games
    for (game, seat) in every_decision_point(game):
        dto  = game_to_state_dict(game, seat)
        rebuilt = state_dict_to_game(dto)
        assert np.array_equal(encode_observation(rebuilt, seat),
                              encode_observation(game, seat))      # byte-for-byte
        assert np.array_equal(encode_action_mask(rebuilt, seat),
                              encode_action_mask(game, seat))
        assert decode_action(chosen_idx, rebuilt) == decode_action(chosen_idx, game)
```

This locks the **Python adapter** to the encoder. The fixture set **MUST include** a position with a
declared signal *and* a known void in a specific suit, and a position where the left opponent (rel 1)
and right opponent (rel 3) are distinguishable — these exercise the relative-seat rows and the
spade/coppe strings explicitly. (A panel noted the runtime gate in Layer 3 does *not* cover the
scores/void/signal blocks, so this layer must.)

This matches the parity discipline `ai/CLAUDE.md` already mandates (`tests/test_rules.py` mirrors
`backend/tests/unit/`).

### 5.3 Layer 2 — runtime legal-move gate (DYNAMIC, catches the backend serializer)

Layer 1 cannot catch a **TypeScript serializer** bug — the TS serializer is not in the pytest loop.
This is the residual risk. The gate (grafted from the winning proposal, "Cross-Engine Legal-Move
Gate"):

- The backend **already computes the legal card set** via `playableCards` (`cardService.ts:30`) and
  sends it in the DTO as `expected_legal_cards` (as strings).
- Python **independently** derives `legal_actions()` from the reconstructed `BeccaGame`.
- If the two rule engines disagree on the board, `/act` returns **HTTP 409** and the move is refused
  — the backend falls back to `autoPlay` and logs loudly.

This turns a whole class of backend-serializer value bugs (wrong hand, wrong trick order, wrong lead
suit) into a **loud, per-move failure** on positions the static fixtures never covered.

> **Scope the gate honestly (panel correction).** The gate catches *legality* drift only. It does
> **NOT** catch errors in the scores block (offset 432), the signal_mask (450), the void_mask (434),
> or the briscola one-hot — those don't change which cards are legal.

**⚠️ THE UNCOVERED GAP — read this before trusting the three layers.** The two statements above
combine into a hole, and an earlier draft of this section papered over it by claiming those blocks
"stay covered by Layer 1." **They do not.** Layer 1 is a Python→Python round trip
(`game → dto → rebuilt game`); the TypeScript serializer never enters the pytest loop. Layer 2 only
compares legal-move sets. So this failure mode passes **every** layer:

> The backend serializer sends a faithful hand and trick (legal moves match ⇒ Layer 2 silent), but
> **wrong scores** (summing `team0Points` and dropping `team0Figures`), a **truncated round**
> (latest hand only, so earlier tricks' voids and signals vanish), or a **seat-mislabelled**
> signal history. Python then encodes exactly what it was handed — faithfully, from a wrong board.
> The bot plays legal, plausible, subtly-bad moves. No test fails. **This is the exact silent
> failure this whole design exists to prevent**, and it is also the highest-consequence one,
> because it would make us mistrust a model that is fine.

The gap is unavoidable in Layers 1–2 because *no test crosses the language boundary*. Hence:

### 5.3b Layer 2b — cross-language golden fixtures (MANDATORY, closes the gap)

The one test this design would otherwise be missing. It is the only layer that exercises the
**TypeScript serializer** itself.

1. **Python generates**, from real self-play games, a fixture file of `(game_state_dto, expected_obs)`
   pairs — the DTO as the backend must produce it, plus the 470-float vector the encoder yields.
   Committed as JSON (small: strings + one float array per case).
2. **A backend integration test** (`backend/tests/integration/`, which already has a `becca_test` DB
   and `NODE_ENV=test` bypass — `package.json:38,41`) seeds Postgres to the state each fixture
   describes, runs the **real serializer**, and asserts its DTO **deep-equals** the fixture DTO.

That converts every silent value bug above into a **failing test in the backend repo**, where the
buggy code lives. Note it asserts DTO-equality rather than calling Python, so it needs no Python in
the Node test process.

Fixtures must include, at minimum: a **multi-round** game (non-zero cumulative scores with a
non-zero figures remainder — the exact case that catches dropping `team0Figures`); a round with
**several completed tricks** carrying signals and an established void (catches truncation); and a
position where **left (rel 1) and right (rel 3) opponents are distinguishable** (catches seat
rotation). Without those three, the value blocks stay uncovered.

> This is the highest-value test in the plan. If effort must be cut, cut a difficulty tier — not this.

### 5.4 Layer 3 — confidence / entropy telemetry (SOFT smoke alarm + product value)

`/act` can also return the model's **confidence**, **policy entropy**, and the **value-head** output.
At watch-time this lets the user distinguish **"the model is weak"** (structured, position-dependent
confidence) from **"the observation is garbled"** (flat, near-uniform, high-entropy policy) — which
is precisely the confound the diagnostic exists to resolve (and see §5.5, OOD). This is also the
single best explainability primitive for the teaching-product guide.

> **This is new code on the `/act` path — not a free reuse (claim corrected).** The confidence value
> computed at `app.py:71-76` lives on the **ONNX `/predict`** path only. The `/act` architecture this
> doc chose (§4.1, Phase 1) runs the **torch** path via `NeuralAgent(build_net(load_checkpoint(...)))`,
> whose `select_action` returns only `decode_action(action_idx, game)` (`arena.py:45-61`) — **no
> distribution, no confidence.** It is nonetheless cheap to add on `/act`, because the net already
> returns `(logits, value)` (`arena.py:52`, `pimc.py:95,111`): compute a softmax over the *legal*
> logits (the same masked-softmax as `app.py:73-76`) for confidence and entropy, and read the value
> head, inside the `/act` handler before returning. Budget it as a small, deliberate addition — do not
> assume it comes for free.

> **Telemetry is NEURAL-only — it does not cover the "Medio" and "Esperto" tiers.** Only the two
> `NeuralAgent` tiers (Facile=`runB_bc`, Forte=`runB_rl`) expose a policy distribution. `HeuristicAgent`
> returns a decoded move with no logits (`heuristic.py:87` → a `Suit`/`(Card, None)`/`Card`), and PIMC's
> `pimc_choose_action` returns a bare flat action index (`pimc.py:190-208`) — an *averaged-value* argmax
> with no per-move probability. So the confidence/entropy readout is **present for Facile/Forte and
> absent for Medio/Esperto**; the UI (§7 affordance #5) must render it as "n/a" for the non-neural
> tiers rather than implying a uniform readout across all four. (PIMC *could* surface its averaged
> action-values as a bespoke confidence later, but that is a different quantity and out of scope here.)

> **Panel disagreement, resolved.** The winning proposal also proposed a *fourth* guard — a shared
> JSON-Schema-with-checksum committed on both sides of the `ai/`↔`backend/` submodule boundary.
> Multiple panels judged this the **weakest** guard (it checks *shape*, not *value*) and pure
> ceremony once Layer 1 + Layer 2 are green. **Decision: drop the JSON-Schema-checksum.** Keep Layers
> 1-3. This is the one place we deliberately trim the winning proposal.

**Net:** encoder divergence is structurally impossible (strings-only); adapter drift is caught
statically and byte-exactly (Layer 1); backend-serializer legality drift is caught loudly at runtime
(Layer 2); gross garbling is visible at watch-time (Layer 3). The value-block residue is covered by
Layer 1 and must stay in the fixture set.

### 5.5 Out-of-distribution states — a limit on what the diagnostic can conclude

The three layers above defend **fidelity**: they prove the bot reads the *correct* board and makes a
*legal* move. They do **not** — and cannot — prove the move is *sane*. That is the diagnostic's job to
observe, but it is bounded by a confound this design must state plainly:

- The RL policy (`runB_rl`) learned from **self-play**. A human opponent will steer games into
  positions the self-play distribution rarely visited (unusual briscola calls, lines a bot-vs-bot game
  would never produce, "mistakes" a human makes that a converged policy never explored). In such
  **out-of-distribution (OOD)** states the policy's output is untrustworthy in a way that is *not* a
  bug — it is a genuine gap in what the model has seen.
- The Layer-2 legal-move gate guarantees **legality, not sanity**: in an OOD state the policy can pick
  a legal-but-nonsensical card and the gate is perfectly happy. So a single ugly move seen at watch
  time is **three-way ambiguous** — it could be (a) the encoder/serializer is subtly wrong (Layers 1-2
  are meant to rule this out, but only for what they cover — §5.3 scopes that honestly), (b) the model
  is just weak on that tier, or (c) the model is fine but the position is OOD and it is guessing.

**What this means for conclusions.** The diagnostic can strongly answer *"does the bot behave sanely
across ordinary play?"* — a pattern of bad briscola calls or dishonest signals over many normal
positions is real signal. It **cannot** convict the model from a handful of odd moves in weird spots
a human deliberately or accidentally created; those are expected OOD behaviour, not evidence the
policy is broken. Judge trends over representative play, not isolated OOD moments.

**The entropy readout is a partial OOD detector — this is its real job.** §5.4 frames the
confidence/entropy telemetry as "weak model vs. garbled obs," but its more useful reading is here: a
**flat, high-entropy** policy distribution on the two neural tiers is exactly what an OOD state looks
like from the inside — the network has no confident opinion because it has not seen positions like
this. So when a bot makes a surprising move, check the entropy: **high entropy → likely OOD (discount
it); low entropy on a bad move → a genuine policy flaw worth flagging.** This does not disambiguate
OOD from a *garbled observation* on its own (both can read as high-entropy), which is why it sits on
top of — not instead of — the Layer 1/2 fidelity guarantees. And because the readout is neural-only
(§5.4), this OOD cue is unavailable for the Medio (heuristic) and Esperto (PIMC) tiers.

---

## 6. Difficulty ladder

The ladder is a **real asset** (§2.3), mapped to real agents with real strength evidence. In the
Python tier registry inside `/act`:

| Tier (UI) | Agent | Artifact / code | Strength evidence | Per-move latency (measured/known) |
|-----------|-------|-----------------|-------------------|-----------------------------------|
| **Facile** (easy) | `NeuralAgent(runB_bc)` | `runB_bc.pt` | Elo 877, ~28.5% vs heuristic — genuinely weak | ~1.2 ms CPU |
| **Medio** (mid) | `HeuristicAgent` | code (`heuristic.py`) | the yardstick (BC loses to it, RL beats it) | ~0 ms |
| **Forte** (strong) | `NeuralAgent(runB_rl)` | `runB_rl.pt` | Elo 1123, ~71% vs heuristic | ~1.2 ms CPU |
| **Esperto** (hard) | PIMC on RL | `pimc.py`, wired last | intended ceiling | ~135 ms (nd=10) – ~267 ms (nd=20) with **heuristic** rollout |

All latencies are invisible against the 60 s / 90 s turn budget. **PIMC must pin
`rollout_policy="heuristic"`** (`pimc.py:62`, the default): net-rollout PIMC is ~39 s/move — it would
make the app appear hung. PIMC is deferred to last and is optional (§3.3 hard-tier).

### 6.1 Greedy vs. temperature sampling — decision

The serving path and `NeuralAgent(temperature=0)` do **greedy argmax** (`app.py:71`,
`arena.py:54`), which is **deterministic**: the same position always yields the same move. That feels
robotic and is memorizable — bad for a practice/teaching product.

**Decision:** expose a **`temperature`** parameter on `/act` and **sample** (`Categorical` over
scaled logits) for the weaker tiers. `NeuralAgent` already supports this (`arena.py:57-59`), the ONNX
graph returns logits, so temperature is a **caller-side softmax — no model re-export.**

This is also the cheap way to **multiply tiers from two checkpoints** (grafted from "One Encoder"):
`RL@T=0` = "Forte/hard", `RL@T≈1.0` = "medio-forte", `BC@T≈1.0` = "facile/human-ish". So "specify how
strong the bots should be" becomes a discrete slider without any extra training.

> **Judgement call:** exact temperature values for each tier are **not yet chosen** — they need a
> quick empirical pass (play a few games at T ∈ {0.3, 0.7, 1.0} and eyeball). Per the no-magic-number
> rule, this document does **not** invent them; they are an open item (§9).

---

## 7. Diagnostic affordances (what the UI must show), ranked by value/effort

The point of the feature is to *judge bot quality*. Ranked best value-per-effort first:

1. **Watch the game at all (zero new UI).** Bots emit `card_played`/`briscola_chosen` exactly like
   humans (`gameService.ts:474,314`), and `GameTable.tsx` is userId-driven, so a human-vs-3-bots game
   *already renders* once bots are seated and driven. Briscola choice is already visible (it becomes
   the briscola badge, `GameTable.tsx` briscola display). **This is the core diagnostic and it costs
   only the backend work.**
2. **Persistent move-log panel (zero backend change).** Accumulate the already-arriving `card_played`
   events (`GameTable.tsx:451`) into an array and render seat / card / signal / trick#. Today
   `currentSignal` is cleared every new trick (`:454`) and shown only on the top seat — so signal
   evidence *scrolls away* before it can be reviewed. The log makes busso/striscio/volo reviewable
   after the fact across a whole round. **Cheapest high-value add.**
3. **Signal badges on all four seats.** Today the badge renders only on the top seat
   (`GameTable.tsx:853`). Render it on left/right/bottom too so any bot's signal is visible regardless
   of position. Pure display change.
4. **Reveal-hands toggle (backend field, `isPractice`-gated).** *Close to mandatory for the stated
   goal:* you cannot verify a **"volo"** was **honest** (bot genuinely void in that suit) or a
   **"striscio"** was backed by real strength without seeing the bot's hidden hand. The state endpoint
   returns only `myCards` today (`gameController.ts:305`). Add an `allHands` field to
   `getStateForSeat`, **gated server-side to `GameRoom.isPractice = true`** (never a pure client
   toggle — a panel flagged the privacy leak into real multiplayer), plus a "reveal hands" toggle in
   the UI.
5. **Per-move confidence/entropy readout (optional, NEURAL tiers only).** Surface the `/act` telemetry
   (§5.4) on `briscola_chosen`/`card_played` to flag low-confidence briscola calls and, per §5.5,
   separate an OOD "the model is guessing" moment from a low-entropy genuine flaw. Requires
   serving→backend→socket passthrough and **new compute on the `/act` path** (it is not reused from
   `/predict` — §5.4). **This readout only exists for the two `NeuralAgent` tiers (Facile, Forte);
   `HeuristicAgent` and PIMC return no distribution (§5.4), so the UI must show "n/a" for Medio and
   Esperto rather than a blank or a fake value.** Enrichment, not on the critical path.

> **Structural note (panel):** `GameTable.tsx` is ~1100 lines and dense. Put the move-log +
> reveal-hands + telemetry in a **sibling diagnostic component** that consumes the same socket
> events, rather than growing `GameTable` further.

> **Mobile / small-screen layout (open — the user's brief asked about this).** The diagnostic surface
> adds three space-hungry elements to a table view that already fills a phone screen: a persistent
> move-log, all-four-seat signal badges, and (when toggled) four revealed hands. The sibling component
> must not assume desktop width. The concrete question — *how does the diagnostic surface behave on a
> narrow viewport?* — is a real UI decision, deferred to §9 with options and a recommendation rather
> than guessed here.

---

## 8. Delivery phases

Each phase is independently verifiable. **Phase 1 is the shortest path to watching a real game** and
is provable in `ai/` alone before touching the backend.

**Phase 1 — Python `/act` + state adapter + golden parity test. — ✅ DONE**
Add `ai/serving/state_adapter.py` (`state_dict_to_game` / `game_to_state_dict`) and `POST /act` to
`serving/app.py` with a tier registry — Facile=`NeuralAgent(build_net(load_checkpoint(runB_bc)))`,
Medio=`HeuristicAgent`, Forte=`runB_rl` — plus a `temperature` param and the runtime legal-move gate
(§5.3). **Esperto (PIMC) is added at the END of this phase** (per D1) as a thin
`select_action(game, seat)` wrapper with `rollout_policy="heuristic"` pinned, so a PIMC problem
cannot block the other three tiers.
**VERIFY:** `pytest ai/tests/test_state_adapter_parity.py` green — `encode_observation(rebuilt) ==
encode_observation(original)` byte-for-byte over N random decision points, including the
signal+void+left/right fixture; `curl -X POST localhost:8000/act` returns a legal `{suit}` (briscola)
or `{suit,value,signal}` (play) **for all four tiers**; a corrupted `expected_legal` yields 409; and
**Esperto's measured per-move latency is < 500 ms** (guards against the ~39 s net-rollout path).

**Phase 1b — Cross-language golden fixtures (§5.3b). — ✅ DONE** (backend assertion in `backend/tests/integration/botStateFixtures.test.ts`; 5 deliberate serializer mutations each fail it)
The layer that actually covers the TypeScript serializer. Python emits a committed JSON fixture of
`(game_state_dto, expected_obs)` pairs from real self-play; a backend integration test seeds
`becca_test`, runs the real serializer, and deep-equals its DTO against the fixture. Must include a
multi-round game with a non-zero figures remainder, a multi-trick round with signals + an established
void, and a left/right-distinguishable position.
**VERIFY:** the backend test passes against the real serializer; then **deliberately break it three
ways** — sum `team0Points` while dropping `team0Figures`, send only the latest hand, and rotate the
signal seats by one — and confirm each break **fails the test**. A layer that cannot fail on a known
bug is not a layer. *(Sequencing note: this phase depends on the Phase 4 serializer existing, so in
practice write the fixtures here and land the backend assertion alongside Phase 4.)*

**Phase 2 — Schema + bot seeding + aggregate fences. — ✅ DONE**
One migration: `User.isBot`, `Player.botModel`, `GameRoom.isPractice`. Add idempotent
`ensureBotUsers()`. Add `isPractice`/`isBot` fences to `getLeaderboard` (`userController.ts:431`),
`getUserStats` (`:195`), and `metrics.ts` (`:28-30`).
**VERIFY:** `prisma migrate deploy` clean on `becca_test`; existing integration suite still green (no
change to human games); a test asserts `ensureBotUsers()` returns 3 distinct userIds and is
idempotent, and that a finished practice game does **not** appear in leaderboard / stats / metrics.

**Phase 3 — Practice-game creation. — ✅ DONE**
Add `POST /api/rooms/practice` taking a `tier`: create a `GameRoom` with `isPractice=true`, seat the
human + 3 bot `Player` rows (`botModel` set, teams 2v2, `isReady=true`, `seat=null`), and ready the
human to trip the existing start gate (`roomController.ts:402`) → `setupRound`.
**VERIFY:** integration test asserts a started room with exactly 4 players (1 human, 3 with
`botModel != null`), 2v2 teams, and a round created; the human is *not* blocked by the "already in an
active game" guard.

**Phase 4 — Bot-turn driver in `turnTimer.ts`. — ✅ DONE**
Add the `botSeats` in-memory registry + `registerBotSeats()` (called by Phase 3 and the
`getGameState` recovery path), the bot early-return in `startTurnTimer`, `scheduleBotMove()` with a
`getStateForSeat(roomCode, userId)` service extracted from `getGameState`'s assembly logic (using the
full-round query shape from `gameService.ts:548`), the `/act` call, the string→`playCard`/
`setBriscola` mapping, the `BOT_MOVE_DEADLINE_MS` fallback to `autoPlay*` with a loud log, and
`BOT_THINK_DELAY_MS`. **Also fix `leaveRoom` for practice abandonment (§3.5):** when the leaving
player is the human in an `isPractice` room, tear the room down (delete all 4 `Player` rows + the
`GameRoom`) and stop the bot chain first (`clearRoomTimerData(roomCode)` + `botSeats.delete(roomCode)`)
instead of taking the current else-branch that orphans 3 bot Players.
**VERIFY:** integration test with the local `/act` running: a practice game has the caller bot emit
`briscola_chosen`, all 3 bot seats emit `card_played`, a full 10-trick round completes and scores, a
leader-seat bot's play carries a busso/striscio/volo signal, bots are **never kicked**; kill the
Python service mid-game and confirm the seat falls back to autoplay with a loud log and no hang; an
all-human game takes the unchanged path (existing tests green). **Abandonment test (§3.5):** the human
calls `leaveRoom` mid-round → `GameRoom` + all 4 `Player` rows gone, the 3 bot `User` rows remain,
`getTurnTimerState(roomCode)` is null, and no `card_played` fires afterward.

**Phase 5 — Frontend entry + diagnostic surface. — ✅ DONE** (confidence readout deferred, per D3)
Add an "Impara a giocare / Pratica contro i bot" card on `Index.tsx:504` → new `/practice` route in
`App.tsx:25` (tier picker) → `POST /api/rooms/practice` → navigate to the existing `/game/:code`.
Build the persistent move-log, all-four-seat signal badges, and the `isPractice`-gated reveal-hands
toggle (backed by an `allHands` field on `getStateForSeat`) in a **sibling diagnostic component**.
**VERIFY:** manual/Playwright — launch practice, watch a full game, confirm briscola choice +
busso/striscio/volo appear in the move log, and reveal-hands shows whether a "volo" was truthful (bot
genuinely void in that suit).

**Diagnostic is complete after Phase 5** (human vs 3 bots, local, no deploy). Rough total **~5.5-6.5
focused days** — the original ~4-5 plus ~0.5 for the Phase 1b cross-language fixtures and ~0.5 for
the Esperto/PIMC tier now in scope (D1). Any hosted deploy is **not** in this estimate (§10).

---

## 8b. What the diagnostic found (first results)

The feature exists to answer a question, so here is the answer it gave on first use. From a
full round per tier through the real service (`backend/tests/integration/botLive.test.ts`
logs this) plus a browser session:

- **Forte declares a signal on almost every lead** — 9 of 10 in the logged round — and they
  are frequently dishonest. The clearest case: **`quattro di denara [busso]`**, announcing
  strength while leading the weakest card in the deck. This reproduces, through the real
  game path, the same finding the offline `watch_bots.py` audit reported (~29% busso
  consistency), so it is a property of the policy, not of this integration.
- **Facile, Medio and Esperto declare no signals at all.** For Medio that is by design
  (the scripted heuristic never signals). For Esperto it is a finding: PIMC's rollouts
  place no value on signalling, so search discards it.
- **Nothing else looked broken.** Briscola choices were reasonable, follow-suit was always
  respected, and no round failed the legality gate (no 409 in any tier).

**Root cause of the signal problem (unchanged from the earlier analysis):** signals were made
*observable* (the historical 450→462 signal extension, before A2's later 462→470 public-state
extension) but never *rewarded*. There is no gradient toward
using them honestly, so the policy learned to emit them as noise. Fixing it means reward
shaping and another training run — a separate decision, not part of this feature.

---

## 9. Risks & open questions

**Risks (with mitigation):**
- **Silent-wrong-board (highest).** Mitigated structurally (strings-only, §3.2) + Layer 1 byte parity
  + **Layer 2b cross-language fixtures (§5.3b — the one that actually covers the TypeScript
  serializer; Layers 1 and 2 do not)** + Layer 2 runtime 409 gate + Layer 3 telemetry (§5). The
  fixture sets *must* include multi-round scores with a figures remainder, a multi-trick round with
  signals and an established void, and left/right-distinguishable positions — or the value blocks go
  uncovered and a wrong board stays silent.
- **Fallback masks an `/act` outage.** If a bot silently degrades to `autoPlay`, the diagnostic
  watches the dumb heuristic, not the model. Mitigation: **loud, distinct** `bot_fallback_to_autoplay`
  log (not swallowed like the existing `auto_play_race` Sentry tag).
- **Aggregate pollution.** `isBot`-only is insufficient; `isPractice` room fence on **all three**
  aggregates is mandatory (§3.3).
- **Reveal-hands privacy leak.** Must be server-side gated on `isPractice`, never a client toggle.
- **Practice-room abandonment (most-likely bug to hit).** The 3 fixed bot *`User`* rows are bounded
  and fenced (accepted), but **bot `Player` rows are per-game and leak on every quit** unless §3.5 is
  implemented: the current `leaveRoom` else-branch (`roomController.ts:511-521`) strands a zombie
  `started:true/finished:false` room plus 3 orphaned bot Players, and can re-arm a timer for a deleted
  seat that wedges the turn loop (the `autoPlayCard` fallback throws and is logged to Sentry — §3.5 —
  not silent, but the turn still never advances). Mitigation is §3.5: on human leave of an `isPractice` room, tear down the whole
  room and stop the bot chain first. This is the path we hit most while running the diagnostic, since
  testing = start/quit many games.
- **Concurrent practice games.** Two at once seat the same 3 bot Users in two rooms; safe because
  every unique constraint and turn-loop lookup is room-scoped and `botSeats` is keyed by `roomCode`
  (justified in §3.3). The unsupported case is the *same human* in two practice games at once (their
  own active-game guard blocks it) — not a goal.
- **Pre-existing dead link (unrelated).** `Header.tsx:79` navigates to `/settings`, which has no
  route. Flagged, not touched — do not confuse it with a practice/settings surface.

**DECIDED by the user (2026-07-25) — these are settled, build to them:**

- **D1. All four tiers ship in the first cut, PIMC included** (supersedes open questions 2 and 3).
  Facile (BC) / Medio (heuristic) / Forte (RL) / Esperto (PIMC). **Hard requirement:** PIMC MUST pin
  `rollout_policy="heuristic"` (`pimc.py:62`) — the net-rollout path is ~39 s/move and would look
  like a hung app (§6). Esperto is still wired **last** within the phase plan, so a PIMC problem
  cannot block the diagnostic on the three cheap tiers.
- **D2. Bot moves are delayed, configurable.** `BOT_THINK_DELAY_MS` defaults to ~1000 ms so a trick
  is watchable and followable, and can be set to 0 to run many games quickly. It must be a named
  constant, not an inline literal.
- **D3. Diagnostic surface = move log + all-seat signal badges + reveal-hands** (affordances 1–4).
  Reveal-hands stays **server-side gated on `isPractice`** — never a client-only toggle (§9 risk).
  **Per-move confidence (affordance #5) is DEFERRED**, resolving open question 4: it needs
  serving→socket plumbing plus new `/act` compute, and works on the two neural tiers only. Note the
  cost of deferring: the §5.5 entropy cue for telling *out-of-distribution guessing* apart from *a
  genuine policy flaw* is unavailable in the first cut, so surprising moves will be ambiguous.
  Revisit when the guide is scoped.

**Open questions still needing the user's decision:**
1. **Temperature per tier.** Needs a quick empirical pass; not invented here (§6.1). *(User: OK to
   pick these by eyeballing a few games?)*
5. **Mobile / small-screen layout for the diagnostic surface.** The move-log + all-seat badges +
   reveal-hands panel do not fit a phone screen alongside the existing table view. Options: **(a)**
   diagnostic surface is **desktop-only** for the diagnostic iteration — simplest, and the diagnostic
   is a laptop activity anyway; **(b)** collapse the diagnostic panel into a bottom-sheet / tab toggle
   on narrow viewports so the table stays usable; **(c)** fully responsive reflow of all three
   elements. *Recommendation: **(a)** for the diagnostic (you will run it on a laptop), then **(b)**
   when the teaching product goes to real users on phones.* Which do we commit to for the first cut?
6. **The "guide" — what is it, and who writes it?** §1.2 names a "Learn to play Beccaccino" guide as
   the downstream goal but never says what the guide *is* (static rules explainer? interactive
   coached hands? contextual tips keyed off the confidence/OOD telemetry in §5.4/§5.5?) or **who
   authors the content** (you, in Italian per the UI-language convention? a domain expert? generated?).
   This is a product input the engineering design cannot supply. The bot-play machinery here is
   guide-agnostic and does not foreclose any of these — but the guide's shape (especially whether it
   consumes per-move telemetry) should be decided before the teaching product is scoped. *(Product
   call — flagged now so it is not silently assumed under "downstream goal.")*

---

## 10. What we are NOT doing yet (deferred by design)

Nothing here is forgotten — it is deliberately out of the diagnostic's critical path:

- **Hosted production Python service.** A second Render service (always-on to avoid free-tier
  cold-starts that would break the first bot move; service-to-service auth; a RUNBOOK entry). Gated
  behind `BOT_SERVICE_URL` being set; unset today ⇒ bots disabled in prod.
- **ONNX artifact home.** `*.onnx` and `*.pt` are gitignored and ride no git-clone deploy. When we
  deploy, export `model-bc.onnx` / `model-rl.onnx` (~5.13 MB each, both V4) and ship via **GitHub
  release assets** (or S3), fetched at boot. Not needed locally (Python loads the `.pt` directly).
- **PIMC "Esperto" tier.** Needs a thin `select_action(game, seat)` wrapper and must pin
  `rollout_policy="heuristic"`. Wired last, optional.
- **All-bot (0-human) auto-watch mode.** Would need an explicit driver loop because restart-recovery
  is triggered by a human client fetch (§3.4). Out of scope.
- **Guest / anonymous practice.** The teaching product may want it; it needs a change to the
  `GET /users/me` auth gate in `GameTable.tsx:161-186`. Deferred.
- **Per-move confidence/rationale as a shipped feature**, richer guide content, Elo-rated practice,
  and any onnxruntime-node / browser-inference path (both rejected in §3.1).
- **The JSON-Schema-checksum cross-submodule contract** — deliberately dropped as ceremony (§5.4).
```
