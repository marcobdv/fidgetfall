# Engineering conventions

Authoritative coding/project standards for Fidgetfall. The Lead Programmer enforces
these in review.

## Toolchain & target framework
- **.NET 9 SDK** for tooling. Godot projects target **`net8.0`** (Godot's tested
  baseline) unless your installed Godot build is confirmed to support `net9.0`.
- **Godot 4.x .NET/Mono** edition. Keep the `Godot.NET.Sdk` version aligned with the
  editor version across all projects.

## Project structure (per game)
```
games/<slug>/
├── project.godot, <Slug>.csproj   (a <Slug>.sln is optional — Godot regenerates it)
├── src/        C# code, namespaced & mirroring scenes/
├── scenes/     .tscn (composition)
├── assets/     sprites/ models/ audio/ fonts/ shaders/ tilesets/ icons/
├── data/       .tres data resources by category
├── addons/     editor plugins (Tools Programmer)
├── test/       GdUnit4 specs
├── tools/      automation scripts
└── docs/       vision, gdd, systems/, levels/, art/, audio/, narrative/, qa/, ops/, backlog, milestones
```

## C# style
- **Nullable reference types ON** (`<Nullable>enable</Nullable>`); avoid `!` except
  for `_Ready`-initialized fields.
- PascalCase for types/methods/properties; `_camelCase` for private fields;
  `SCREAMING_CASE` only for consts.
- One top-level type per file; filename == type name; namespace mirrors folder.
- Node scripts are **`partial`**; use `double delta` in `_Process`/`_PhysicsProcess`.
- Prefer `[Export]` fields + signals over hard `GetNode` paths and tight coupling.
- Keep **game logic in plain C# classes** (unit-testable) and nodes as thin glue.

## Scenes & nodes
- Scenes are composition, scripts are behavior. Build reusable composites as scenes.
- PascalCase node names. Use unique names (`%Name`) for important references.
- Set collision **layers/masks** intentionally; document them per game.

## Data & tuning
- Designer-tunable numbers live in `[Export]` fields or `.tres` Resources — never
  hardcoded magic numbers. See the `godot-resource-authoring` skill.

## Assets
- `res://assets/<kind>/...`; placeholders prefixed `placeholder_` and tracked in
  `games/<slug>/docs/art/asset-status.md`. Final assets replace placeholders in place.
- **Sourced (Tier 1.5) and AI-generated (Tier 2) assets MUST be logged in
  `games/<slug>/CREDITS.md`** via the `asset-sourcing` credit helper — including CC0
  (for provenance). No NonCommercial/NoDerivatives assets in a shippable game.

## Testing
- GdUnit4 under `test/` as its **own project** (`test/<Slug>.Tests.csproj` referencing
  the game csproj) so the test framework never ships in exports; run with
  `dotnet test test/`. Put a `.gdignore` in `test/` so the editor skips it.
- `Method_State_Expectation` naming; deterministic; runs headless in CI. Every
  fixed bug gets a regression test.

## Git
- Conventional, small commits. Ignore: `.godot/`, `bin/`, `obj/`, `.mono/`,
  `*.user`, `build/`, `export/`, `.DS_Store`.
- Commit `project.godot`, `*.csproj`, `*.tscn`, `*.tres`, `export_presets.cfg`
  (and `*.sln` if you keep one).

## Definition of Done (every change)
1. `dotnet build` clean. 2. `dotnet test` green. 3. No broken scene/resource refs.
4. Relevant `docs/` updated. 5. Producer signed off for gated work.
