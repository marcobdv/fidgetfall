# Production pipeline

How a game moves from idea to release at Fidgetfall. Each phase ends in a
**quality gate** the Producer clears with the human before advancing.

## Phase 0 — Concept
**Goal:** decide if there's a game worth making.
- `creative-director` → `docs/vision.md` (hook, pillars, tone, references, anti-goals).
- `game-designer` → rough core-loop sketch.
- **Gate:** human greenlights the pitch. One page, exciting, focused.

## Phase 1 — Pre-production
**Goal:** know what we're building and how.
- `game-designer` → `docs/gdd.md` + `docs/systems/*.md` (MVP-scoped).
- `lead-programmer` → `docs/architecture.md` + project scaffold (`godot-csharp-setup`).
- `concept-artist` → `docs/art/direction.md`; `narrative-designer` → bible (if narrative-led).
- `producer` → `docs/backlog.md` + `docs/milestones.md`.
- **Gate:** GDD + architecture + backlog exist and agree on the MVP. Scope is honest.

## Phase 2 — Prototype (vertical slice)
**Goal:** prove the core loop is fun, with placeholder everything.
- `gameplay-programmer` → playable core loop (`godot-2d-platformer-kit`, scripting).
- `game-artist` → Tier-1 assets (`procedural-asset-generation`).
- `level-designer` → one greybox level that teaches the loop.
- `qa-tester` → smoke tests for the core mechanics.
- **Gate (Greenlight):** Creative Director confirms it's fun. If not, iterate or pivot
  *here*, cheaply — do not scale a loop that isn't fun.

## Phase 3 — Production
**Goal:** build the game against the backlog in milestones.
- All disciplines work in parallel off the Producer's backlog.
- Programmers build systems; designers spec & tune; artists/audio produce and
  integrate; tech artist elevates the look; QA tests each increment.
- **Gate (per milestone):** features match spec, build green, tests pass, docs current.

## Phase 4 — Polish & QA
**Goal:** make it feel finished.
- `qa-tester` hardens; `game-designer` + `animator` tune game feel; `technical-artist`,
  `sound-designer`, `composer` elevate; `ux-ui-designer` finishes flows & accessibility.
- **Gate:** no known sev-1/2 bugs; accessibility checklist passes; feel is dialed.

## Phase 5 — Release
**Goal:** ship a runnable, versioned build.
- `build-engineer` → headless exports + CI (`godot-export-pipeline`), release notes.
- `producer` → final sign-off, milestone shipped.
- **Gate:** clean checkout builds, tests, and exports via one command; artifact runs.

## Cross-cutting rules
- **Artifacts in the repo**, summaries in chat. Handoffs go through the Producer.
- **Vertical slice before content. Placeholder before final. Tests before "done".**
- A phase doesn't start until the prior gate is cleared and signed off.
