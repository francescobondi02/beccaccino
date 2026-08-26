# BECCA Future Improvements

This is the maintained list of ideas and next steps that are intentionally not
part of the current release. Recheck the current code before starting an item;
some entries came from an earlier production-readiness review.

## Data Collection

- Consider adding a stable anonymous player key only if training later needs
  per-player balancing, train/validation isolation, or joins between practice
  games and expert annotations. Practice V1 deliberately stores no identity.

## Product Ideas

- Add an annotator portal for viewing previous responses and making explicit
  corrections.
- Persist the pending annotation scenario so returning experts resume the same
  scenario after closing or changing browsers.

## Engineering Next Steps

- Recheck scoring order and cumulative figures at every winner/statistics call
  site, with focused regression tests.
- Recheck account-deletion behavior for users with finished multiplayer games.
- Keep production startup self-contained: use the pinned Prisma CLI and verify
  proxy-aware rate limiting.
- Keep local setup reproducible: verify Compose database URLs, scrub committed
  local secrets, and retain one frontend lockfile.
- Maintain package CI for backend, frontend, AI, and their shared bot fixtures.
- Continue removing duplicated game-rule, API, auth, player-normalization, and
  socket-contract logic where the duplication still exists.
- Continue hardening transactions and database constraints, then decompose
  `GameTable` only where tests can pin behavior first.
- Finish the small UX and reliability items: surface socket errors, resolve the
  `/settings` route, handle expired socket authentication, keep timers based on
  the client clock, use typed errors, and remove confirmed dead code.

## Complexity to Avoid

- Do not convert the repository into a workspaces monorepo solely to share
  socket types.
- Do not add Redis or multi-instance socket infrastructure before scale needs it.
- Do not add a materialized leaderboard before the current query and cache stop
  being sufficient.
- Do not enable every strict TypeScript option in one change.
- Do not add infrastructure or abstractions without a current user or operator
  need.
