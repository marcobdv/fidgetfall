---
name: godot-csharp-setup
description: Create or configure a new Godot 4 C#/.NET game project — project.godot, .csproj, .sln, folder layout. Use when starting a new game under games/<slug>/ or fixing C# project wiring.
---

# Godot 4 + C# project setup

Use this to stand up a buildable Godot 4 (.NET edition) project. Requires the
**Godot Mono/.NET build** and the .NET SDK.

## Folder layout (per game, under `games/<slug>/`)

```
games/<slug>/
├── project.godot            # engine config
├── <Slug>.csproj            # C# project (Godot.NET.Sdk)
├── <Slug>.sln               # solution (optional; Godot regenerates it)
├── src/                     # C# scripts (mirrors scene structure)
├── scenes/                  # .tscn scenes
├── assets/                  # sprites, audio, shaders, fonts, models
├── data/                    # .tres resources by category (see docs/conventions.md)
├── addons/                  # editor plugins (only when used)
├── tools/                   # pipeline/editor tooling (only when used)
├── test/                    # GdUnit4 tests
├── docs/                    # GDD, design, art/audio direction, qa, ops
└── CREDITS.md               # asset provenance log (created by credit-asset.mjs)
```

`data/`, `addons/`, and `tools/` can start empty or be added when first needed,
but resources/plugins/tooling go there — not scattered — per `docs/conventions.md`.

## 1. `project.godot`

Minimal Godot 4 project file (config_version 5):

```ini
config_version=5

[application]
config/name="<Slug>"
run/main_scene="res://scenes/Main.tscn"
config/features=PackedStringArray("4.7", "C#", "Forward Plus")

[dotnet]
project/assembly_name="<Slug>"
```

## 2. `<Slug>.csproj`

```xml
<Project Sdk="Godot.NET.Sdk/4.7.0">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <EnableDynamicLoading>true</EnableDynamicLoading>
    <Nullable>enable</Nullable>
    <LangVersion>latest</LangVersion>
    <RootNamespace><Slug></RootNamespace>
  </PropertyGroup>
</Project>
```

> **TFM note:** `net8.0` is Godot's tested baseline. If your Godot build supports
> it you may use `net9.0` — the studio runs the .NET 9 SDK regardless. Keep the
> `Godot.NET.Sdk` version aligned with your installed Godot version.

## 3. Build & verify

```bash
cd games/<slug>
dotnet build                       # compiles C#
godot --headless --path . --quit   # imports & validates the project
```

If C# types aren't recognized in-editor, run `godot --headless --build-solutions`
or open the project once in the editor to generate `.godot/mono` glue.

## Conventions
- One game = one project = one assembly. Don't share a `.csproj` across games.
- Keep `src/` mirroring `scenes/` so a scene's script is easy to find.
- Commit `project.godot`, `*.csproj`, `*.sln`; ignore `.godot/`, `bin/`, `obj/`,
  `.mono/`, `export/`.
