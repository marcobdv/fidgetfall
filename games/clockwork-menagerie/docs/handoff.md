# Clockwork Menagerie — Vertical Slice Handoff (Gameplay Programmer)

The playable Godot Node layer over the pure `src/core/` repair logic. The core was NOT
modified (all 41 QA tests still pass).

## How to play (controls)

Mouse-driven, single verb, no fail state (GDD §7). Run `scenes/Main.tscn`.

| Action | Binding | Does |
|---|---|---|
| `interact` | Left mouse button (or `E`) | The single context-sensitive verb. |
| `cancel`   | Right mouse button / `Esc` | Releases a grabbed gear back to rest. |

Fixed order — the active step glows; later steps are dim/inert:

1. **Wind** — hold LMB with the cursor on the wind key (within the ring around the
   spring stub on top of the beetle) and **circle clockwise**. The key spins, a soft
   tick plays every 30° of travel (pitch rises with progress). ~2.5 turns completes it.
   Releasing keeps progress (no unwinding).
2. **Re-seat** — the loose gear sits to the lower-left of the beetle. Press LMB on it to
   grab (pickup pluck), drag it onto the dashed socket ghost (top-left bay). The ghost
   brightens within snap range; release there to seat (seat chime). A miss glides the
   gear back to rest — no penalty. RMB/Esc also returns it.
3. **Oil** — hold LMB over the rear-right leg joint. An oil sheen fills (~1.8 s) with a
   soft looping drip; moving off pauses (never drains). Full = a little relieved wiggle.

When all three are done the beetle **comes alive**: come-alive chime + a spark twinkle,
a happy bob/head-tilt, then it toddles to the right across the desk.

## What's wired (file map)

### Resource tunable seam (the designer `.tres` flow — architecture.md §3)
- `src/data/RepairStepDefinition.cs` — `[GlobalClass] : Resource` base mirroring §7.0
  tunables; `Build()` constructs the matching pure-core step, `ApplyBase()` copies shared
  fields.
- `src/data/WindStepDefinition.cs`, `ReseatStepDefinition.cs`, `OilStepDefinition.cs` —
  per-type `[Export]` mirrors of repair.md §7.1/§7.2/§7.3; each `Build()`s its core step.
- `src/data/CritterDefinition.cs` — `[Export] RepairStepDefinition[] Steps`, `FixedOrder`,
  `ComeAliveDelay`, `AllowTinkerAgainReset` (§7.4); `BuildCritter()` builds the core
  `CritterRepair` with critter tunables copied on.
- Authored data: `data/steps/beetle_{wind,reseat,oil}.tres`, `data/critters/beetle.tres`.
  **Editing a value (e.g. `TargetTurns`) changes behavior with no code edit** (test #10).

### Node / view layer (thin glue, no rules)
- `src/view/CritterController.cs` (`Node2D`) — loads `CritterDefinition`, builds the core
  `CritterRepair`, binds each step to its view, routes `interact`/`cancel`/cursor to the
  active step in `_PhysicsProcess`, `Tick()`s the core, fires the shared `step_done` chime
  on each step's Active→Completing, and runs the come-alive payoff on
  `CritterRepair.ComeAlive`.
- `src/view/IStepView.cs` — the routing contract the controller uses per step.
- `src/view/WindStepView.cs` — spins the key by accumulated winding, ticks SFX every
  `WindTickDegrees`, pulses while Idle, brightens while Active.
- `src/view/ReseatStepView.cs` — grabbable gear follows the cursor (lerped by
  `GearFollowLerp`), socket ghost brightens within `MagnetHintRadius`, miss tweens back to
  rest over `GearReturnTime`, plays pickup/seat SFX.
- `src/view/OilStepView.cs` — oil sheen rises with progress, looping drip while pouring
  (silenced the instant it pauses), relieved wiggle on completion, oil-can near cursor.
- `src/view/SoundManager.cs` — `AudioStreamPlayer` round-robin pool; `Play`/`PlayJittered`
  by logical key. Maps the six SFX (`wind_tick`, `gear_pickup`, `gear_seat`, `oil_drip`,
  `step_done`, `come_alive`).
- `src/view/CursorView.cs` — sets the custom `cursor.svg` hardware pointer (fingertip
  hotspot ~6,4).

### Scenes
- `scenes/Critter.tscn` — the beetle: `CritterController` root, `beetle_body.svg`, the
  three step views at their authored sites (wind stub top, socket bay top-left, joint
  rear-right; loose gear lower-left), and the come-alive `spark.svg`.
- `scenes/Main.tscn` (the main scene) — `bench_bg.svg` backdrop, fixed `Camera2D`,
  `SoundManager`, `CursorView`, an instanced `Critter`, and a one-line control hint label.
- `project.godot` — added a `[display]` block (1152×648, canvas_items stretch / keep
  aspect) so the bench fills the window. Input map (`interact`/`cancel`) was already set.

### Core ↔ engine boundary
Core positions are `System.Numerics.Vector2`; views convert at the boundary
(`new(v.X, v.Y)`). Each view sets its core step's world anchor on `Bind()`
(Wind `Pivot`, Reseat `RestPosition`/`SocketPosition`, Oil `JointPosition`) from its child
sprites' global positions, so moving sprites in the scene moves the hotspots.

## SFX / asset hookup
All real paths: sprites `res://assets/sprites/*.svg`, SFX `res://assets/audio/sfx/*.wav`.
Events: wind tick per `WindTickDegrees`, `gear_pickup` on grab, `gear_seat` on seat,
`oil_drip` looped while pouring, `step_done` on each completion, `come_alive` on payoff.

## Verification (all green)
- `dotnet build` → Build succeeded, 0 warnings, 0 errors.
- `dotnet test` → 41/41 passed (core untouched).
- `& $GODOT_BIN --headless --import --path .` → reimport DONE, no errors.
- `& $GODOT_BIN --headless --path . --quit-after 120` → exit 0, no script errors/warnings.
  A runtime print confirmed the `.tres` chain builds 3 steps with the first (wind) Idle and
  the rest Locked.

## Notes / open items
- Come-alive motion (bob + toddle) is code-driven in `CritterController._Process`, not an
  `AnimationPlayer` — left as a clean seam for the Animator to replace with authored clips
  and the wake/walk/whirr sequence.
- `MagnetHintRadius` hover hum is not yet authored (audio shopping list); the seat-ready
  cue currently reuses a soft high `gear_pickup`. Swap in the hum when available.
- `AllowTinkerAgainReset` is exposed and wired in the core (`TinkerAgain`) but no reset UI
  is hooked yet (GDD open Q2 — deferred). The slice ends on the toddle.
