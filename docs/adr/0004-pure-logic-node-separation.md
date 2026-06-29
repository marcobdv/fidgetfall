# ADR-0004: Separate pure logic from Node glue

- **Status:** Accepted
- **Date:** 2026-06-28

## Context
Godot gameplay code tends to live inside `Node` subclasses, which require the scene
tree to instantiate and are awkward (and, headless, unstable) to unit-test. We want
fast, deterministic tests of game logic.

## Decision
Keep **game logic in plain C# classes** (`src/core/`, no `using Godot;`) and make
`Node` scripts **thin glue** that drives that logic. Tunables flow from `[Export]`
fields / `.tres` `Resource`s into the pure objects at load. The pure core is the
unit-testable heart; the Node layer is verified by build + headless run (and,
sparingly, integration tests).

## Consequences
- Logic is testable with no scene tree — e.g. clockwork-menagerie's repair core has
  41 fast, deterministic GdUnit4 tests that caught real spec/impl mismatches.
- Slightly more files and an explicit core↔Node boundary (e.g. converting
  `System.Numerics.Vector2` ↔ Godot `Vector2`).
- The Node-layer wiring (input → core → SFX → payoff) still needs integration
  coverage; pure tests don't reach it (see ADR-0006 and the playtest-harness skill idea).

## Alternatives considered
- **Logic directly in Node scripts:** less boilerplate, but tests need the engine and
  become slow/fragile (see ADR-0006).
