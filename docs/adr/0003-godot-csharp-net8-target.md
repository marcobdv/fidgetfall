# ADR-0003: Godot 4.7 + C#, target net8.0

- **Status:** Accepted
- **Date:** 2026-06-28

## Context
Games are built in Godot 4.7 (.NET/Mono edition) with C#. The machine has the .NET 9
SDK installed. Godot's `Godot.NET.Sdk` has a tested baseline target framework, and
mismatching it risks editor/runtime friction.

## Decision
Use the **.NET 9 SDK for tooling**, but target **`net8.0`** in game `.csproj` files —
Godot 4.7's tested baseline. `Godot.NET.Sdk` version is pinned to the editor version
(4.7.0). Projects may move to `net9.0` only when a specific Godot build is confirmed
to support it.

## Consequences
- Builds are reliable against the installed engine; verified end-to-end (sample +
  clockwork-menagerie build, import, run headless, tests pass on Godot 4.7).
- A small inconsistency to police: the .NET *SDK* is 9 but the *target* is 8.
  `docs/conventions.md` is authoritative; an early doc drift (AGENTS.md said net9.0)
  was caught in code review and corrected.

## Alternatives considered
- **Target net9.0** to match the installed SDK: cleaner on paper, but risks running
  ahead of Godot's tested baseline for no gameplay benefit.
- **Use the standard (non-Mono) Godot build with GDScript:** rejected — the studio is
  committed to C#/.NET for testability and tooling.
