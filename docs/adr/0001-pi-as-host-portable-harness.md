# ADR-0001: Pi as the studio harness, kept host-portable

- **Status:** Accepted
- **Date:** 2026-06-28

## Context
We need an agent harness to run the studio: an agent loop, subagents (for roles),
and skills (reusable capabilities). The harness should be minimal, extensible, and
not lock the studio's value into one vendor's runtime.

## Decision
Use **Pi** (`pi.dev`, Mario Zechner's minimal TypeScript coding-agent harness) as
the primary host: `.pi/agents/*.md` for roles, `.pi/skills/*/SKILL.md` for skills,
`AGENTS.md` for the handbook, `.pi/settings.json` for config, and the
`@tintinweb/pi-subagents` extension for spawning role agents.

Critically, keep the studio's substance **host-portable**: roles, skills, and the
orchestration model are plain markdown + repo conventions, not Pi-specific code. The
studio must run under any agent host that can read files, run bash, and spawn
subagents.

## Consequences
- The studio runs under Pi *and* under other hosts (verified: it ran end-to-end from
  Claude Code, with Claude Code's Agent tool standing in for Pi's subagents — see
  ADR-0002 and the orchestration playbook).
- No vendor lock-in; swapping the model provider or host doesn't touch role/skill files.
- Cost: a thin dependency on the subagents extension for the Pi path; the portable
  path relies on the host having an equivalent subagent mechanism.

## Alternatives considered
- **Heavier CLIs** (full-featured agent frameworks): more built-in, but more
  lock-in and ceremony than a minimal studio needs.
- **A bespoke orchestrator in code:** maximum control, but re-implements what Pi
  already does and loses the "just markdown + conventions" portability.
