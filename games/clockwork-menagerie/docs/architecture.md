# Clockwork Menagerie — Technical Architecture

> Owner: Lead Programmer. Audience: Gameplay Programmer (implements the Node layer),
> QA (unit-tests the core), and the Tools/Tech-Art/Audio roles wiring presentation.
> Source of truth for *rules* is `docs/systems/repair.md`; this doc owns *structure*.

## 1. Goals & constraints

- One Godot project = one assembly (`ClockworkMenagerie`), `net8.0`, `Godot.NET.Sdk/4.7.0`.
- **Repair logic is testable without the scene tree** (AGENTS.md determinism rule). The
  heart of the game is pure C# with no `using Godot;`.
- No failure path anywhere; progress is monotonic (`repair.md` §1).
- Designer tunables live in `[Export]`/`.tres`, never hardcoded (`conventions.md`).

## 2. Layering

```
                 ┌─────────────────────────────────────────────┐
  scenes/*.tscn  │ Composition: bench, beetle, hotspots, camera │  (Level Designer + Gameplay)
                 └──────────────────────┬──────────────────────┘
                                        │ [Export] refs + signals
                 ┌──────────────────────▼──────────────────────┐
  src/ (Node)    │ Godot glue: reads input + cursor, drives     │  (Gameplay Programmer)
                 │ visuals/audio, copies .tres tunables into    │
                 │ the core, forwards Press/UpdateCursor/Tick   │
                 └──────────────────────┬──────────────────────┘
                                        │ plain method calls / event
                 ┌──────────────────────▼──────────────────────┐
  src/core/      │ PURE C# repair logic — NO Godot types.       │  (Lead Programmer — DONE)
  (engine-free)  │ RepairStep state machines + CritterRepair.   │  ← unit-testable (QA)
                 └─────────────────────────────────────────────┘
  data/*.tres    │ Authored tunables (CritterDefinition + steps) │  (Game Designer)
```

- **`src/core/`** — engine-free. Already implemented and build-verified. The contract the
  rest of the game is written against. No dependency points *out* of this folder.
- **`src/` (Node layer)** — thin `partial` Godot nodes. They translate `interact`/`cursor`/
  `cancel` (input map) and cursor positions into core calls, and translate core state
  (`State`, `Progress`, events) into animation/SFX. **No game rules live here.**
- **`data/`** — `.tres` resources the Game Designer edits. Resource classes are dumb data.

### Why the split (and the one subtlety)

The pure core uses `System.Numerics.Vector2` for cursor/pivot/socket positions so it needs
nothing from Godot. The Node layer converts Godot `Vector2` ↔ `System.Numerics.Vector2` at
the boundary (a one-line `new(v.X, v.Y)`). This is the only friction the split costs, and it
buys fully headless-testable logic.

## 3. How `RepairStepDefinition` resources feed tunables

The core classes expose every tunable from `repair.md` §7 as plain settable C# properties,
pre-seeded with the spec defaults. The Godot layer mirrors those onto Godot `Resource`
subclasses (one per step type) so designers tune in the Inspector / `.tres`:

```
RepairStepDefinition (Resource, [GlobalClass])      → base tunables (§7.0)
 ├─ WindStepDefinition   : [Export] TargetTurns, WindRingOuterRadius, …  (§7.1)
 ├─ ReseatStepDefinition : [Export] SnapRadius, GrabFromDistance, …      (§7.2)
 └─ OilStepDefinition    : [Export] OilFillRatePerSec, OilHotspotRadius… (§7.3)
CritterDefinition (Resource)  : [Export] RepairStepDefinition[] Steps; FixedOrder; ComeAliveDelay; AllowTinkerAgainReset  (§7.4)
```

**Flow at load:** the critter Node loads `data/critters/beetle.tres`, and for each
`*StepDefinition` it constructs the matching core `*Step` and copies the exported values onto
the core object's properties (e.g. `windStep.TargetTurns = def.TargetTurns`). The core then
runs independently of Godot. A `.tres` edit changes behavior with no code change
(`repair.md` test #10).

> Definitions and the copy are intentionally **left to the Gameplay Programmer** — they are
> Godot-side (`[Export]`/`Resource`) and belong with the Node layer. The seam is: core props
> are public and settable; definitions are a thin `[Export]` mirror + a copy step.

## 4. Node / scene plan (for the Gameplay Programmer)

Suggested, not binding. Keep nodes thin and prefer `[Export]` + signals over `GetNode` paths.

```
Main.tscn  (res://scenes/Main.tscn — the main scene project.godot points at)
└─ Bench (Node2D)                       # fixed-camera bench framing (Level Designer)
   ├─ Camera2D                          # fixed
   ├─ Beetle (Node2D)  [CritterController.cs]
   │   ├─ MainspringHotspot (Area2D/Node2D)  [WindStepView.cs]   ← drives a WindStep
   │   ├─ GearHotspot      (Area2D/Node2D)   [ReseatStepView.cs] ← drives a ReseatStep
   │   ├─ JointHotspot     (Area2D/Node2D)   [OilStepView.cs]    ← drives an OilStep
   │   └─ AnimationPlayer                    # wake / head-tilt / walk (Animator)
   └─ Lighting / background (warm pool of light)
```

- **`CritterController`** (`partial`, `Node2D`): loads `CritterDefinition`, builds the core
  `CritterRepair` + its `RepairStep`s, owns the per-frame `Tick(delta)`, routes `interact`/
  `cancel`/cursor to the active step(s), subscribes to `CritterRepair.ComeAlive` to kick off
  the payoff. Bridges `Input.IsActionJustPressed("interact")` → `step.Press()`, etc.
- **`*StepView`** nodes: own the visuals/SFX for one step, read `step.State`/`step.Progress`
  (and `FeedbackProgress`/`IsWithinMagnetHint` for re-seat, `IsOnTarget` for oil) each frame
  to update coil tightness, drag ghost, fill bar, magnet hum, settle anims, chimes.
- **Cursor:** `GetGlobalMousePosition()` is converted to `System.Numerics.Vector2` and passed
  to the active step's `UpdateCursor`. Hotspot pickup uses the step's radius tunables.
- **Input contract:** `interact` press → `Press()`/`TryGrab()`; release/focus-loss/`cancel` →
  `Release()`/`Cancel()`; every `_Process(double delta)` → `critter.Tick((float)delta)`.

## 5. Per-step & critter state machines (implemented in core)

- `RepairStep` (abstract): `Locked → Idle → Active → Completing → Done` (`repair.md` §4).
  `Progress` is normalized 0..1 and only moves via the monotonic, clamped `AdvanceProgress`/
  `CommitProgress`. `Completing` auto-advances to `Done` after `CompletionSettleTime` via
  `Tick`. Subclass seams: `OnActivated`, `OnActiveTick`, `OnReleased`, `OnCompleting`.
- `WindStep` / `ReseatStep` / `OilStep`: the three archetypes (§5.1–5.3). Edge cases E1–E12
  are handled in the core (anti-jump clamp, inclusive snap, pause-not-drain, no-penalty miss,
  idempotent press/release, latch-on-complete).
- `CritterRepair`: owns `Repairing → ComingAlive → Alive` (§3), unlocks steps per
  `FixedOrder`, exposes `ActiveSteps`/`OverallProgress`/`AllStepsDone`, and fires the
  **`ComeAlive`** event exactly once after `ComeAliveDelay`. Supports `TinkerAgain` reset.

## 6. The "come-alive" payoff approach

The core does not know about animation — it only signals intent. When the last step reaches
`Done`, `CritterRepair` enters `ComingAlive`, waits `ComeAliveDelay`, then raises the
**`ComeAlive`** event once and moves to `Alive`. Input is ignored throughout (E9). The Node
layer's `CritterController` subscribes to `ComeAlive` and plays the diegetic payoff —
`AnimationPlayer` wake → chime (Sound Designer) → head-tilt/happy-whirr personality beat →
walk across the desk (Animator). The optional "tinker again" soft reset (GDD Q2) calls
`CritterRepair.TinkerAgain(freshSteps)` with steps rebuilt from the `CritterDefinition`.

This keeps the emotional payoff entirely in the presentation layer while the *trigger* is a
single, testable event from pure logic.

## 7. Testing

- GdUnit4 specs under `test/`, `Method_State_Expectation` naming, deterministic, headless.
  The core needs no scene tree — drive a step/critter with explicit `Press`/`UpdateCursor`/
  `Tick` calls and assert `State`/`Progress`/`ComeAlive`. QA owns these (see `repair.md` §9
  for the observable-behavior checklist; all 10 map directly onto core assertions).

## 8. File map (delivered by Lead Programmer)

```
project.godot              # assembly ClockworkMenagerie, main scene res://scenes/Main.tscn, [input] interact + cancel
ClockworkMenagerie.csproj  # Godot.NET.Sdk/4.7.0, net8.0, gdUnit4 + Microsoft.NET.Test.Sdk
ClockworkMenagerie.sln
.gitignore
docs/architecture.md       # this file
src/core/
  RepairStepState.cs       # Locked/Idle/Active/Completing/Done
  RepairStep.cs            # abstract base: monotonic Progress, state machine, seams
  WindStep.cs              # §5.1
  ReseatStep.cs           # §5.2
  OilStep.cs              # §5.3
  CritterState.cs         # Repairing/ComingAlive/Alive
  CritterRepair.cs        # ordered steps, ComeAlive event, reset
```
