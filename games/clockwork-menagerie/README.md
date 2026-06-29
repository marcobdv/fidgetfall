# Clockwork Menagerie 🐞⚙️

A cozy, no-fail game about tending and repairing little clockwork creatures at a warm
lamplit workbench. Wind the spring → re-seat a gear → oil a joint, and the critter
springs to life and toddles across your desk.

Built in **Godot 4.7** with **C# / .NET 8**. Flat-vector art + chiptune audio, all
procedurally generated (no external asset dependencies).

> Produced by the [Fidgetfall](https://github.com/marcobdv/fidgetfall) agentic game
> studio — designed, built, and tested by a team of AI role-agents. This repo
> **graduated** from the studio at its greenlight gate (see the studio's ADR-0008).

## Status

Playable **vertical slice**: one beetle critter, one bench, the three-step repair loop
→ come-to-life payoff. Builds clean, 41 unit tests pass, runs headless without errors.

## Run it

Requires the **Godot 4.7 .NET/Mono** build and the .NET SDK.

```bash
dotnet build
godot --headless --import --path .   # first time: import assets + C# glue
godot --path .                       # play it (windowed)
```

Controls: **hold `interact`** (left mouse / `E`) to wind and oil; **press-drag-release**
to re-seat the gear; **`cancel`** (right mouse / `Esc`) drops a grabbed gear.

## Test

```bash
export GODOT_BIN=/path/to/godot      # GdUnit4 launches the engine to host tests
dotnet test                          # expect: 41/41 pass
```

## Layout

```
src/core/    pure, engine-free repair logic (unit-tested heart)
src/data/    [Export]/.tres tunable definitions (designer-editable)
src/view/    thin Godot Node layer over the core
scenes/      Main.tscn (bench) + Critter.tscn
assets/      flat-vector sprites + synthesized SFX
data/        authored .tres step/critter definitions
test/        GdUnit4 unit tests
docs/        vision, GDD, repair spec, architecture, art/audio direction, handoff
```

The pure-logic/Node separation, the tunable `.tres` flow, and the test approach follow
the studio's conventions and ADRs.
