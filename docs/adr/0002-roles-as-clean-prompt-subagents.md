# ADR-0002: Roles are subagents with clean prompts

- **Status:** Accepted
- **Date:** 2026-06-28

## Context
A game studio has many disciplines. We model each as an agent. Pi subagents start
from a clean system prompt and do **not** auto-inherit the project handbook
(`AGENTS.md`) unless configured to. We must decide how much context each role carries.

## Decision
Each role is a subagent defined in `.pi/agents/<role>.md` with `prompt_mode: replace`
(a clean, focused prompt) plus frontmatter (`description`, `tools`, `model`,
`thinking`). Every role brief instructs the agent to **read `AGENTS.md` and the
relevant `docs/` and skills first**. The **top-level session is the Orchestrator**; it
routes work to roles and integrates results. Subagents do not spawn subagents (no
nesting), so the Producer *recommends* routing while the Orchestrator *spawns*.

## Consequences
- Narrow, cache-friendly prompts; each role stays focused and cheap.
- Studio context delivery depends on the role actually reading the handbook — a
  compliance dependency, not a guarantee. Mitigation under consideration: a 3-line
  "studio invariants" block embedded in each brief.
- Orchestration is a single-level fan-out; multi-phase work is sequenced by the
  Orchestrator in waves (see the orchestration playbook).

## Alternatives considered
- **`prompt_mode: append`** (inherit the parent/handbook): guarantees context but
  bloats every role prompt and couples roles to the full base prompt.
- **One mega-agent with all roles:** simpler to invoke, but loses specialization,
  parallelism, and clean separation of concerns.
