# ADR-0009: Non-Godot services live in `apps/`, starting with the Blood on the Clocktower server

- **Status:** Accepted
- **Date:** 2026-09-05

## Context
The studio owner wants a **Blood on the Clocktower server** where humans and agents play
together: a web page that visualises the town with public and private chat, an MCP
endpoint agents connect through, and skills per character group. It is explicitly *not a
Fidgetfall game* — it shares none of the studio's stack (Godot 4.7, C#, GdUnit4, the
export pipeline) and none of its roles or skills apply to it — but it should live in this
repo for now.

That breaks two existing conventions if placed naively:

- `games/` means "a self-contained Godot project" (ADR-0008 graduates them at greenlight).
  A Node service there would break tooling and CI assumptions.
- The `.pi/skills/` tree is Godot/C# know-how for studio *roles*. Skills that teach an
  agent to play a character in a game it is a participant in are a different kind of
  artifact with a different audience.

## Decision
Add a top-level **`apps/`** directory for non-Godot services the studio owner wants in
this repo, and put the server at **`apps/botc/`**.

- `apps/botc/` is a self-contained npm workspace (`@botc/engine`, `@botc/server`,
  `@botc/client`) with its own `package.json`, tests, and README. Nothing outside it
  depends on it, and it depends on nothing in the studio.
- Its agent skills live in **`apps/botc/skills/`**, not `.pi/skills/` — they are shipped
  with the product and consumed by *players*, not by studio roles. The app README
  documents symlinking them into a host's skills directory.
- ADR-0008's graduation rule applies by analogy: if the server grows into a product with
  its own release cadence, it graduates to its own repo, and this repo keeps a link.

## Consequences
- The studio repo now holds two unrelated toolchains. `apps/` names that split so nobody
  mistakes the server for a game or copies its conventions into one.
- `games/` keeps its single meaning, and Godot tooling/CI need no exclusions.
- The server can be extracted to its own repo with a directory move — it has no inbound
  dependencies by construction.
- Watch for: a second `apps/` project tempting a shared toolchain config. Keep them
  independent until there are three, then reconsider.

## Alternatives considered
- **`games/blood-on-the-clocktower/`** — consistent with the portfolio idea, but `games/`
  means "Godot project" to both the docs and the tooling, and this is not one.
- **Its own repo from day one** — cleanest separation, but the owner asked for it here
  while it is being explored; ADR-0008's graduation path already covers the exit.
- **Top-level `botc/`** — fine for one project, but the next non-Godot thing would need a
  second top-level directory and no rule to explain either.
