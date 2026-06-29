# Orchestration playbook

How the Studio Orchestrator drives a production. This is the reusable recipe behind
the pipeline phases ([pipeline.md](pipeline.md)) — the concrete "spawn these roles in
this order" mechanics. It exists because subagents don't nest (ADR-0002): the
Orchestrator (top-level session) owns sequencing.

## Principles

- **Artifacts, not chat.** Every role writes files to the repo and returns a short
  summary. The Orchestrator integrates from the files.
- **Waves.** Run independent roles in parallel; serialize across dependencies. A wave
  ends at a **verification or quality gate**.
- **Verify, don't trust.** After a build wave, the Orchestrator independently runs
  build/test/import/run before advancing — even if a subagent reports success.
- **Reconcile conflicts at the top.** When QA and an implementer disagree, the
  Orchestrator adjudicates (is the test wrong or the code?) and routes the fix.
- **Seed each role from its brief.** Tell the subagent to read `.pi/agents/<role>.md`,
  `AGENTS.md`, the relevant `docs/`, the skills, and the actual code it builds on —
  then give it the task + deliverable paths.

## The wave pipeline (vertical slice)

This is the sequence used to build `clockwork-menagerie` from concept to a running,
tested slice.

```
Design   Creative Director ─▶ Game Designer            (vision ▶ GDD + system spec)
            │ greenlight gate (human) ─ is it fun / in scope?
Wave 1   Lead Programmer        (project scaffold + pure logic core; build gate)
Wave 2   ┌ Game Artist          (Tier-1 sprites)        ┐ parallel — independent
         ├ Sound Designer        (synth SFX)            │  outputs; QA depends only
         └ QA Tester             (unit tests on core)   ┘  on Wave-1 core
            │ QA gate ─ tests green? Orchestrator runs `dotnet test`
Wave 3   Gameplay Programmer     (Node layer, scenes, input, wire core+assets+SFX)
Wave 4   Orchestrator            (independent verify: build/test/import/run; fix loop)
            │ greenlight gate ─ graduate the game? (ADR-0008)
```

### Wave dependencies (what's safe to parallelize)
- Roles writing to **disjoint paths** can run concurrently (Art→`assets/sprites`,
  Sound→`assets/audio`, QA→`test/`).
- Anything that **consumes another role's output** is a later wave (Game Designer
  needs the vision; QA needs the core; Gameplay needs core + assets).
- Avoid two roles writing the **same files** in one wave (e.g. both editing
  `project.godot`) — sequence them.

## Gates the Orchestrator enforces

| Gate | Check |
|---|---|
| Build (post-Wave-1) | `dotnet build` clean |
| QA (post-Wave-2) | `dotnet test` green; adjudicate any failures |
| Verify (Wave 4) | build + test + `godot --headless --import` + `--quit-after N` exit 0, no script errors |
| Greenlight | human confirms the slice; Producer decides graduation (ADR-0008) |

## Lessons baked in

- **The QA gate earns its place.** In the clockwork-menagerie run, 2 of 41 tests
  failed; the Orchestrator diagnosed both as stale test expectations (the core was
  correct) and fixed the tests — a real bug the build alone wouldn't catch.
- **Headless ≠ playable.** Build/import/run-clean proves it *loads and runs without
  errors*; it does not prove the interactive experience. A windowed session (or a
  future `godot-playtest-harness`) is needed to confirm play and visuals.
- **Absorbing roles is a smell.** When the Orchestrator folds a role's work into
  another (e.g. art direction into the Game Artist), say so explicitly — don't let a
  skipped discipline look done.

## Full-cast vs slice

A vertical slice uses ~7 roles. A production pass exercises the rest: Producer
(backlog/milestones), Concept Artist (formal direction), Animator (`AnimationPlayer`),
Technical Artist (shaders), Composer (music), UX/UI (menus), Narrative (flavor/quests),
Tools Programmer (editor tooling), Level Designer (spaces), Build Engineer (export +
CI). Sequence them as additional waves against the same gates.
