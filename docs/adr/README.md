# Architecture Decision Records

This log captures the **non-obvious decisions** behind Fidgetfall — the *why* and the
alternatives, not just the *what*. In an agentic studio this matters double: the
**agents read these docs as context**, so an ADR is both human reference and a
guardrail that keeps roles from re-litigating settled calls.

Format is lightweight [MADR](https://adr.github.io/madr/)-style. One file per
decision, numbered, immutable once `Accepted` — to change a decision, add a new ADR
that supersedes the old one (don't rewrite history).

## Template

```markdown
# ADR-NNNN: <short title>

- **Status:** Proposed | Accepted | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD

## Context
What forces are at play? What problem/constraint prompted a decision?

## Decision
What we chose, stated plainly.

## Consequences
What this makes easy, what it makes hard, and what to watch for.

## Alternatives considered
Options we rejected, and why.
```

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-pi-as-host-portable-harness.md) | Pi as the studio harness, kept host-portable | Accepted |
| [0002](0002-roles-as-clean-prompt-subagents.md) | Roles are subagents with clean prompts | Accepted |
| [0003](0003-godot-csharp-net8-target.md) | Godot 4.7 + C#, target net8.0 | Accepted |
| [0004](0004-pure-logic-node-separation.md) | Separate pure logic from Node glue | Accepted |
| [0005](0005-three-tier-asset-strategy.md) | Three-tier asset strategy | Accepted |
| [0006](0006-avoid-headless-scene-tests.md) | Favor pure-logic tests; avoid headless scene tests | Accepted |
| [0007](0007-placeholder-first-tier1-final.md) | Placeholder-first, Tier-1-final policy | Accepted |
| [0008](0008-games-graduate-to-own-repos.md) | Games graduate to their own repos at greenlight | Accepted |
