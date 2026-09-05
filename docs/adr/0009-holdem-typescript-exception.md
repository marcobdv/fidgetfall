# ADR-0009: The Hold'em experiment lives in `apps/` on TypeScript, outside the Godot convention

- **Status:** Accepted
- **Date:** 2026-09-05

## Context
The studio builds games in **Godot 4.7 / C#** ([ADR-0003](0003-godot-csharp-net8-target.md)),
and games live in `games/` until they graduate to their own repo
([ADR-0008](0008-games-graduate-to-own-repos.md)). Those conventions assume a game: a
Godot project, scenes, assets, GdUnit4 tests.

An experiment arrived that does not fit either half of that assumption. It is an **online
Texas Hold'em table for humans and AI agents**: a browser client, a table server, and an
**MCP** endpoint that lets agents take a seat alongside people. It is a networked web
application whose defining requirement — agents connecting over MCP — has no Godot story
at all, and whose client is a page, not an engine build.

Forcing it into the convention would mean either running a Godot client against a
separate server (two toolchains for one experiment, and a download before anyone can
play) or writing an MCP server in C# against thinner tooling. Neither buys anything the
experiment needs.

## Decision
Keep it in this repo, but **outside the games convention on both axes**:

- It lives in **`apps/holdem/`**, not `games/`. `games/` means *Godot game*; a top-level
  `apps/` says plainly that this is a different kind of artifact.
- It is written in **TypeScript on Node**, not Godot/C#. `@modelcontextprotocol/sdk` is
  first-class there, the browser is the client with no build step, and one language spans
  engine, server, agent tools and tests.
- The **engineering conventions in [`docs/conventions.md`](../conventions.md) do not apply
  to it** — they are written for Godot projects. It carries its own equivalents: pure
  logic separated from I/O (the spirit of [ADR-0004](0004-pure-logic-node-separation.md)),
  deterministic seeded tests, and no scene-level testing to avoid
  ([ADR-0006](0006-avoid-headless-scene-tests.md)) because there are no scenes.
- If it ever earns a greenlight, ADR-0008 still governs: it graduates to its own repo.

## Consequences
- The repo now has two toolchains. Anyone cloning it for the studio harness can ignore
  `apps/` entirely; `npm test` there is independent of `dotnet test` anywhere else.
- CI must not assume every project is a Godot project. The Hold'em workflow runs on its
  own path filter.
- `apps/` is a precedent: future non-game tooling that is not part of the harness has a
  home that does not muddy `games/`.
- The cost is honest — a reader now has to know which convention applies where, which is
  exactly what this ADR exists to answer.

## Alternatives considered
- **Godot client + C# server.** Consistent with the studio, and the natural choice if
  this were a game we intended to ship. Rejected: it puts a download between a person and
  a poker hand, and the agent-facing half — the actual point of the experiment — gets
  worse tooling for no gain.
- **ASP.NET Core, no Godot.** Keeps the .NET language family and the existing conventions
  mostly intact. Rejected: it splits the difference badly — still two client stacks
  (browser + C#), still the weaker MCP story, and the conventions it preserves are about
  scenes and nodes, which this project does not have.
- **`games/holdem/`.** Keeps the portfolio in one place. Rejected: `games/README.md` and
  the orchestration playbook both describe Godot projects, and a non-Godot entry in that
  table would need an asterisk everywhere it appears.
- **A separate repo immediately.** Cleanest isolation. Rejected as premature under
  ADR-0008: this is an unproven experiment, and prototypes stay here until greenlit.
