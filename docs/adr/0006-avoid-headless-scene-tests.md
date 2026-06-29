# ADR-0006: Favor pure-logic tests; avoid headless scene tests

- **Status:** Accepted
- **Date:** 2026-06-28

## Context
GdUnit4's `ISceneRunner` can drive live nodes in tests. In this environment, doing so
with a `CharacterBody2D`/physics node under `--headless` crashed the test host with a
native `AccessViolationException`, aborting the *entire* suite — not just the one test.

## Decision
**Default to unit-testing pure logic** (ADR-0004) with no scene tree. Use
`ISceneRunner` scene tests only when genuinely necessary, keep them isolated so a
native crash can't take down the suite, and treat headless scene tests as unstable.
The `godot-testing-gdunit4` skill carries this caution.

## Consequences
- Test suites are fast, deterministic, and reliable headless (sample: 10/10;
  clockwork-menagerie: 41/41).
- A real coverage gap remains: the Node-layer integration (input→core→SFX→payoff) is
  not unit-tested. Mitigation: build + headless run (smoke), and a proposed
  `godot-playtest-harness` skill for scripted-input integration tests.
- When we first tried a scene-level regression test for a clamp bug, it crashed the
  host; we replaced it with a pure-logic test of an extracted helper — the pattern
  this ADR codifies.

## Alternatives considered
- **Lean on scene tests for integration:** higher fidelity, but currently
  crash-prone headless and CI-hostile.
