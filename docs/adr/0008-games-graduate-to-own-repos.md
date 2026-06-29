# ADR-0008: Games graduate to their own repos at greenlight

- **Status:** Accepted
- **Date:** 2026-06-28

## Context
The studio's premise is producing *many* games. Where should game code live relative
to the studio harness (`.pi/`, skills, docs)? Options span a single monorepo to a
separate repo per game from day one. Games accumulate **binary assets** (art/audio)
that bloat a shared repo and eventually force Git LFS, and each shipped game is a
*product* with its own release cadence, issues, license, and visibility.

## Decision
**Hybrid, keyed to the production pipeline:**

- The **harness** (`.pi/`, `docs/`, skills, tooling) lives in `fidgetfall`.
- **`sample-clockwork` stays** in the harness repo — it is the verified template /
  toolchain smoke-test fixture, not a product, and CI uses it.
- A game **graduates to its own repo at the greenlight gate** (end of Prototype),
  taking its history with it. The Build Engineer scaffolds graduated repos from the
  template (own CI + releases).
- `fidgetfall` keeps a **portfolio index** (`games/README.md`) linking out to
  graduated game repos. The Producer decides graduation at the gate.

First graduation: `clockwork-menagerie` → its own private repo.

## Consequences
- Harness clones stay light; game asset bloat is isolated per game.
- Independent versioning, CI, issues, license, and visibility per game (studio can be
  private while a game is public, or vice versa).
- Overhead: graduation is a deliberate step (history split + new repo + CI). Prototypes
  live in `games/` until greenlit, so throwaways don't each spawn a repo.

## Alternatives considered
- **Permanent monorepo:** simplest now, but couples release cadences and bloats the
  studio repo with every game's binaries over time.
- **Separate repo per game from day one:** maximal isolation, but too much overhead for
  unproven prototypes.
