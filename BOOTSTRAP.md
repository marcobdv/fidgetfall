# Bootstrap the Fidgetfall studio

This wires up the toolchain the agents need. Estimated time: ~15 minutes.

## 1. Prerequisites

| Tool | Version | Check | Get it |
|---|---|---|---|
| .NET SDK | 9.x | `dotnet --version` | <https://dotnet.microsoft.com/download> |
| Node.js | 20+ | `node --version` | <https://nodejs.org> (needed by Pi) |
| Godot | **4.7** **.NET / Mono** build | `godot --version` | <https://godotengine.org/download> |
| git | any | `git --version` | <https://git-scm.com> |

> ⚠️ You must use the **.NET (Mono) build of Godot**, not the standard build, or
> C# scripting will not work. On Windows, add the Godot executable to your `PATH`
> (or set `GODOT4` to its full path) so agents can run it headless.
>
> On this machine Godot 4.7 mono is installed at:
> `C:\Godot_v4.7-stable_mono_win64\Godot_v4.7-stable_mono_win64\Godot_v4.7-stable_mono_win64.exe`
> Set `GODOT_BIN` to that path — **GdUnit4's `dotnet test` requires it** to launch
> the engine:
> ```bash
> export GODOT_BIN="C:/Godot_v4.7-stable_mono_win64/Godot_v4.7-stable_mono_win64/Godot_v4.7-stable_mono_win64.exe"
> # PowerShell: $env:GODOT_BIN = "C:\Godot_v4.7-stable_mono_win64\Godot_v4.7-stable_mono_win64\Godot_v4.7-stable_mono_win64.exe"
> ```

## 2. Install Pi

```bash
npm install -g @mariozechner/pi-coding-agent
pi --version
```

Configure at least one model provider for Pi (e.g. an Anthropic API key) per the
Pi docs: <https://pi.dev>. The studio defaults to the `opus` family for heavy
reasoning roles and `sonnet` for implementation/asset roles; adjust per role in
`.pi/agents/*.md` frontmatter, or globally in `.pi/settings.json`.

## 3. Install studio packages

The studio uses the **subagents** extension so the Orchestrator can spawn role
agents. From the repo root:

```bash
pi install npm:@tintinweb/pi-subagents
```

(`.pi/settings.json` already lists this package; the command above fetches it.)

## 4. Verify Godot + C# toolchain

```bash
cd games/sample-clockwork
dotnet build                                   # compiles C# (Godot.NET.Sdk 4.7)
godot --headless --import --path .             # imports assets + generates C# glue
godot --headless --path . --quit-after 90      # runs Main.tscn for 90 frames, then quits

# Run the test suite (GdUnit4 launches Godot — GODOT_BIN must be set, see §1):
dotnet test                                    # expect: Passed! 5/5
cd ../..
```

This exact sequence has been verified on Godot 4.7 + .NET 9: the sample builds
(0 warnings/errors), imports, runs headless, and all 5 GdUnit4 tests pass. If it
works for you too, the studio toolchain is good to go.

## 5. Launch the studio

```bash
pi
```

Then talk to it — see the README for example prompts. The Orchestrator reads
`AGENTS.md` and delegates to the roles in `.pi/agents/`.

## Troubleshooting

- **`godot` not found** — ensure you installed the Mono/.NET build and it's on
  `PATH`. Agents fall back to `$GODOT4` if set.
- **C# scripts not recognized** — open the project once in the Godot editor to
  generate the `.godot/mono` glue, or run `godot --headless --build-solutions`.
- **Subagents don't appear** — confirm `pi install` completed and re-launch `pi`
  from the repo root so project-local config is loaded.
