# Fidgetfall 🎮 — an agentic game studio

Fidgetfall is a **game development studio staffed by AI agents**. Every
traditional role in a game company — producer, designer, programmer, artist,
animator, sound designer, QA, build engineer — is a specialist [Pi](https://pi.dev)
subagent with its own focused brief and skill set. They collaborate to design,
build, test, and ship games made in **Godot 4** with **C# / .NET 9**.

> You bring the vision and the greenlights. The studio does the work.

## How it works

- **Harness:** [Pi](https://pi.dev), a minimal, extensible TypeScript coding-agent
  harness by Mario Zechner (creator of libGDX).
- **The top-level Pi session is the Studio Orchestrator.** It clarifies what you
  want, delegates to the right role, integrates the results, and reports back.
- **Roles** live in [`.pi/agents/`](.pi/agents) — one markdown file per discipline.
- **Skills** (reusable Godot/C# know-how) live in [`.pi/skills/`](.pi/skills).
- **The studio handbook** is [`AGENTS.md`](AGENTS.md) — read it to understand the
  whole operation.

## Quick start

1. Install the toolchain and wire up the studio: **[BOOTSTRAP.md](BOOTSTRAP.md)**.
2. From the repo root, launch Pi:
   ```bash
   pi
   ```
3. Talk to the studio in plain language, e.g.:
   - *"Pitch me a cozy 2D game about repairing broken clockwork animals."*
   - *"Build a playable prototype of the core loop with placeholder art."*
   - *"Have QA write tests for the player movement and run them."*
   - *"Cut a Windows + Linux build of the current prototype."*

   The Orchestrator routes each request to the right role(s).

## The team

| Production | Design | Engineering | Art | Audio | Quality / Ops |
|---|---|---|---|---|---|
| Producer | Game Designer | Lead Programmer | Concept Artist | Sound Designer | QA Tester |
| Creative Director | Level Designer | Gameplay Programmer | Game Artist | Composer | Build Engineer |
| | Narrative Designer | Tools Programmer | Animator | | |
| | UX/UI Designer | Technical Artist | | | |

Full definitions and a delegation guide: [`docs/roles.md`](docs/roles.md).

## Repository layout

```
.pi/agents/   role subagents      docs/         studio process & conventions
.pi/skills/   Godot/C# skills      games/        one Godot C# project per game
AGENTS.md     studio handbook      BOOTSTRAP.md  setup instructions
```

## Status

Studio scaffolding is in place. The first game project lives in
[`games/`](games) once a concept is greenlit. See
[`docs/pipeline.md`](docs/pipeline.md) for how a game goes from pitch to release.
