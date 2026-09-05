# Games portfolio

Where the studio's games live. Per [ADR-0008](../docs/adr/0008-games-graduate-to-own-repos.md),
**prototypes live here** under `games/` while in development; once a game clears the
**greenlight gate** it **graduates to its own repo** (own CI + releases) and is listed
below as a link. `sample-clockwork` is the exception — it stays here permanently as
the verified template and toolchain smoke-test.

## In this repo

| Project | What it is | Status |
|---|---|---|
| [`sample-clockwork/`](sample-clockwork) | The verified Godot 4.7 / C# **template** + toolchain smoke test (builds, imports, runs headless, tests pass). Copy it to start a new game. | Permanent fixture |

*(Active prototypes, if any, also appear here until they graduate.)*

## Graduated games (own repos)

| Game | Repo | Description |
|---|---|---|
| Clockwork Menagerie | [marcobdv/clockwork-menagerie](https://github.com/marcobdv/clockwork-menagerie) | Cozy, no-fail game about repairing little clockwork creatures. Playable vertical slice. Built end-to-end by the studio orchestration. |

## Not a game

Non-game experiments live in [`apps/`](../apps), outside this portfolio and outside the
Godot conventions — see [ADR-0009](../docs/adr/0009-holdem-typescript-exception.md).
Today that is [`apps/holdem`](../apps/holdem), an online Texas Hold'em table for humans
and AI agents.

## Starting a new game

Copy `sample-clockwork/` to `games/<your-slug>/`, rename the assembly, and run the
studio's [orchestration playbook](../docs/orchestration-playbook.md) (Concept →
Design → build waves → verify). Graduate it at the greenlight gate.
