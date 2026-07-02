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
> C# scripting will not work. Add the Godot executable to your `PATH` so agents
> can run it headless, and set `GODOT_BIN` to its full path — GdUnit4 needs it
> to host any test marked `[RequireGodotRuntime]` (pure-logic tests run without
> it):
> ```bash
> export GODOT_BIN="/path/to/Godot_v4.7-stable_mono.exe"
> # PowerShell: $env:GODOT_BIN = "C:\path\to\Godot_v4.7-stable_mono_win64.exe"
> ```
> Record your machine's actual path in an untracked `LOCAL.md` at the repo root
> (gitignored) so agents can find it without hardcoding it into shared docs.

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

# Run the test suite (pure-logic tests — no Godot binary needed; tests are
# their own project under test/, so point dotnet test at it):
dotnet test test/                              # expect: Passed! 20
cd ../..
```

This exact sequence has been verified on Godot 4.7 + .NET 9: the sample builds
(0 warnings/errors), imports, runs headless, and all 20 GdUnit4 test cases pass.
If it works for you too, the studio toolchain is good to go.

## 5. Launch the studio

```bash
pi
```

Then talk to it — see the README for example prompts. The Orchestrator reads
`AGENTS.md` and delegates to the roles in `.pi/agents/`.

## Troubleshooting

- **`godot` not found** — ensure you installed the Mono/.NET build and it's on
  `PATH`. Agents fall back to `$GODOT_BIN` if set.
- **C# scripts not recognized** — open the project once in the Godot editor to
  generate the `.godot/mono` glue, or run `godot --headless --build-solutions`.
- **Subagents don't appear** — confirm `pi install` completed and re-launch `pi`
  from the repo root so project-local config is loaded.
