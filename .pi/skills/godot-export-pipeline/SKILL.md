---
name: godot-export-pipeline
description: Configure Godot 4 export presets and run headless exports/builds for Windows, Linux, and web, plus CI wiring. Use when packaging builds or setting up CI/CD.
---

# Export & build pipeline (Godot 4, C#)

Produce runnable builds headlessly so anyone (and CI) can ship a game.

## 1. Export presets (`export_presets.cfg`)

Created by the editor's Project → Export, but the file is text and reviewable.
Define at least Windows and Linux desktop presets. Each `[preset.N]` block has a
`name`, `platform`, `export_path`, and `[preset.N.options]`. Example skeleton:

```ini
[preset.0]
name="Windows Desktop"
platform="Windows Desktop"
runnable=true
export_path="build/windows/<Slug>.exe"

[preset.0.options]
binary_format/architecture="x86_64"

[preset.1]
name="Linux"
platform="Linux"
runnable=true
export_path="build/linux/<Slug>.x86_64"
```

> **Export templates** for your Godot version must be installed
> (`godot --headless --export-* ` needs them). Install via the editor's
> "Manage Export Templates" or download the matching templates archive.

## 2. Headless export commands

```bash
cd games/<slug>

# Build C# first (release), then export with the matching preset name:
dotnet build -c ExportRelease

godot --headless --export-release "Windows Desktop" build/windows/<Slug>.exe
godot --headless --export-release "Linux"           build/linux/<Slug>.x86_64
# Debug builds: --export-debug
```

Use `--export-release` for shipping, `--export-debug` for test builds. The preset
name must match `export_presets.cfg` exactly.

## 3. CI (GitHub Actions sketch)

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: '9.0.x' }
      - name: Setup Godot
        uses: chickensoft-games/setup-godot@v2
        with: { version: 4.7.0, use-dotnet: true }
      - run: dotnet build games/<slug>
      - run: dotnet test  games/<slug>           # GdUnit4 headless
      - run: |
          cd games/<slug>
          godot --headless --export-release "Linux" build/linux/<Slug>.x86_64
      - uses: actions/upload-artifact@v4
        with: { name: linux-build, path: games/<slug>/build/linux }
```

## Conventions
- Output to `games/<slug>/build/<platform>/` (gitignored).
- Pin Godot + .NET versions in CI and in `docs/ops/release.md`.
- Version every build (e.g. `application/config/version` in `project.godot`) and
  write release notes alongside the artifact.
