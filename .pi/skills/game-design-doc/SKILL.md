---
name: game-design-doc
description: Author a concise, living Game Design Document and supporting design specs. Use when capturing vision, mechanics, systems, or scope for a game.
---

# Game Design Document (GDD)

A GDD is a **living, concise** reference — not a novel. Optimize for "a programmer
or designer can act on this without asking." Keep it updated; delete what's stale.

## One-page pitch (write this first — `docs/vision.md`)
- **Hook:** one sentence a player would repeat to a friend.
- **Pillars:** 3–5 load-bearing experience statements (and anti-goals).
- **Fantasy/tone:** what the player feels and is.
- **References:** 2–4, with what we take from each.

## GDD outline (`docs/gdd.md`)

```markdown
# <Game> — GDD

## 1. Overview
Genre, platform, target session length, audience, elevator pitch.

## 2. Pillars
(from vision.md — the lens for every feature decision)

## 3. Core loop
The 10-second and 2-minute loops. The verbs. Why it's fun.

## 4. Mechanics & systems
Per system: purpose, rules, states, inputs, edge cases, tunables.
Link to docs/systems/<system>.md for detail.

## 5. Progression & economy
Curves, unlocks, currencies, difficulty ramp. Tables of numbers.

## 6. Content scope
Levels, enemies, items — counts and a representative example each.

## 7. Controls & UX
Action list (ties to the input map) and key UX flows.

## 8. Art & audio direction
Pointers to docs/art/direction.md and docs/audio/*.

## 9. Narrative
Pointer to docs/narrative/bible.md; how story is delivered.

## 10. Scope & milestones
MVP / vertical slice / 1.0. What's explicitly OUT.

## 11. Open questions
Tracked decisions still to make.
```

## Per-system spec (`docs/systems/<system>.md`)
- Purpose (which pillar it serves), rules, state machine, **parameter table** with
  default values and ranges, edge cases, dependencies, test notes for QA.

## Rules of a good spec
- **Unambiguous:** no "feels good" without numbers or a reference.
- **Tunable:** every magic number names where it lives (an `[Export]` or `.tres`).
- **Scoped:** mark MVP vs later; list what's explicitly out.
- **Testable:** state the observable behavior QA can assert.
- **Living:** update it when the build changes; the doc is the source of truth.
