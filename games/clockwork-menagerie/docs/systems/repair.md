# System Spec — Repair

> The one system of consequence in the vertical slice. Serves **Pillar 1** (repair is
> care, not a puzzle) and **Pillar 2** (tactile, legible tinkering). Implementation-
> agnostic but decision-complete: a Gameplay Programmer should implement this without
> guessing intent. Every magic number names where it lives.

## 1. Purpose & overview

A **Critter** owns an ordered list of **RepairStep**s. Each step is a tiny state machine
driven by exactly one mouse gesture (the single `interact` verb, context-sensitive on the
active step). Completing all steps fires the critter's **come-to-life** payoff.

The slice has one critter (**Beetle**) with three steps in fixed order:

1. **Wind** the mainspring (`WindStep`)
2. **Re-seat** the bent gear (`ReseatStep`)
3. **Oil** the stuck leg joint (`OilStep`)

There is **no failure**. Progress is monotonic: a completed step never regresses, and an
in-progress step at worst returns to its start without losing any *completed* work.

## 2. Architecture intent (for the programmer)

- Keep the step logic as **pure C#** (testable without the scene tree) where practical;
  `Node` glue reads input and drives visuals/audio. (Per `AGENTS.md` determinism rule.)
- A critter is configured by a **`CritterDefinition` resource** (`.tres`) holding ordered
  `RepairStepDefinition` resources. Each step type subclasses a base
  `RepairStepDefinition` and exposes its tunables as `[Export]` fields so designers tune
  in the Inspector / `.tres` without code changes.
- Suggested resource shape (names indicative, not binding):
  - `CritterDefinition` : `RepairStepDefinition[] Steps`, `bool FixedOrder = true`.
  - `RepairStepDefinition` (base) : shared tunables (§7.0).
  - `WindStepDefinition`, `ReseatStepDefinition`, `OilStepDefinition` : per-type tunables.
- The controller exposes `interact` (button, press/hold/release) and the cursor
  position/delta to whichever step is `Active`.

## 3. Critter-level state machine

```
            all steps Done
  Repairing ───────────────► ComingAlive ──(anim+audio finish)──► Alive
     ▲                                                              │
     │ (slice: optional "tinker again" reset — see GDD open Q2)     │
     └──────────────────────────────────────────────────────────────┘
```

- **Repairing:** exactly one step is `Active` (the first not-yet-`Done` step in order).
  All earlier steps are `Done`; all later steps are `Locked` (inert, no affordance).
- **ComingAlive:** triggered the frame the last step reaches `Done`. Plays wake animation
  + chime + personality beat + walk. Input is ignored during this state.
- **Alive:** terminal for the slice. (Optional reset returns to a fresh `Repairing`.)

**Step advancement (FixedOrder = true):** when the active step → `Done`, the next step in
the array becomes `Active`. If `FixedOrder = false` (future critters), *all* not-`Done`
steps are simultaneously `Active`/available; the slice does not use this path but the
code must not assume single-active.

## 4. Per-step state machine

Every `RepairStep`, regardless of type, follows the same four states:

```
 Locked ──(becomes current step)──► Idle
                                      │
                  cursor over hotspot │ (Idle⇄Idle highlight only)
            press `interact` on hotspot
                                      ▼
                                   Active ──progress ≥ target──► Completing
                                      │  ▲                          │
            release/cancel /          │  │ regress per step rules   │ (settle anim
            cursor leaves (per type)  ▼  │                          ▼  + chime, no input)
                                   Idle ─┘                         Done  (terminal)
```

State definitions:

| State | Meaning | Accepts input? | Visual |
|---|---|---|---|
| `Locked` | Not yet this step's turn (FixedOrder). | No | Neutral, no pulse. |
| `Idle` | Current step, awaiting the player. | Press starts it; hover highlights. | Soft pulse/highlight invite. |
| `Active` | Gesture in progress. | Yes — drives `progress`. | Continuous feedback (§5). |
| `Completing` | Target reached; settle + chime playing. | No (locks input). | Snap/seat anim + chime. |
| `Done` | Finished. | No. | Settled, no invite. |

`progress` is normalized **0.0 → 1.0**; the step completes when `progress ≥ 1.0`
(after any required hold, per type). `Completing` lasts `CompletionSettleTime` then → `Done`.

## 5. Per-step rules (the three archetypes)

### 5.1 Wind (mainspring) — `WindStep`
- **Gesture:** hold `interact`; while held, move the cursor in a **circular** motion
  around the spring's pivot. Accumulated signed angular travel = winding.
- **Progress:** `progress = clamp(accumulatedTurns / TargetTurns, 0..1)`.
  `accumulatedTurns` increases with cursor angular delta about the pivot **only in the
  intended direction** (clockwise = winding). Counter-direction motion is **ignored**
  (clamped at 0 contribution), never subtracted — there is no "unwinding" punishment.
- **Hold requirement:** angular travel only counts while `interact` is held *and* the
  cursor is within `WindRingOuterRadius` of the pivot (so the player is "on" the key).
- **Feedback:** spring coil visibly tightens; tick SFX every `WindTickDegrees` of travel;
  pitch/density of ticks rises with `progress`.
- **Release behavior:** releasing `interact` keeps accumulated progress (winding holds).
  Re-press resumes. So Wind does **not** regress on release.
- **Complete:** at `progress ≥ 1.0`, the key gives a final firm tick → `Completing`.

### 5.2 Re-seat (bent gear) — `ReseatStep`
- **Gesture:** press `interact` while the cursor is over the loose gear to **grab** it;
  hold and drag; the gear follows the cursor (optionally lagged by `GearFollowLerp`);
  release over the socket to seat.
- **Progress (continuous, for feedback):**
  `progress = clamp(1 - (distanceToSocket / GrabFromDistance), 0..1)` while grabbed.
- **Seat condition:** on release, if `distanceToSocket ≤ SnapRadius` **and** (if
  `RequireAngleMatch`) the gear's rotation is within `SnapAngleTolerance` of the socket's
  target angle → the gear **snaps** to the socket exactly → `Completing`.
- **Miss behavior (no failure):** on release **outside** `SnapRadius`, the gear smoothly
  returns to its **start rest position** over `GearReturnTime`; step → `Idle`. No progress
  penalty beyond having to grab again. `cancel` (or `Esc`) during a drag does the same.
- **Optional rotation:** for the slice, `RequireAngleMatch = false` (position-only seat,
  simplest feel). Tunable left exposed for harder future gears.
- **Feedback:** socket shows a faint "ghost" target; when within `SnapRadius`, the ghost
  brightens and a soft magnetic hum plays to signal "let go here." Seat = click/chime.

### 5.3 Oil (stuck leg joint) — `OilStep`
- **Gesture:** move the oiler (cursor) over the joint hotspot and **hold** `interact` to
  pour; an oil meter fills while held + on-target.
- **Progress:** `progress += OilFillRatePerSec * dt` while (`interact` held AND cursor
  within `OilHotspotRadius` of the joint). Clamped 0..1.
- **Hold-off behavior:** if the player releases or moves off-target before full, filling
  **pauses** (does not drain) — calm, no punishment. Resumes on re-hold-on-target.
  (If a tiny drain is wanted for feel, `OilDrainRatePerSec` defaults to 0 = no drain.)
- **Free-up:** at `progress ≥ 1.0`, the joint visibly loosens (a small test-wiggle of the
  leg) → `Completing`.
- **Feedback:** an oil-fill bar/sheen on the joint rises with progress; a soft drip/ooze
  SFX loops while pouring; the leg gives a little relieved wiggle on completion.

## 6. Edge cases (all states, all steps)

| # | Situation | Rule |
|---|---|---|
| E1 | Player releases `interact` mid-gesture | Wind: keep progress. Oil: pause (no drain). Re-seat: return gear to rest, → `Idle`. **Never** a fail. |
| E2 | Cursor leaves the active hotspot mid-gesture | Wind: angular travel stops counting until back in ring. Oil: filling pauses. Re-seat: gear keeps following cursor (still grabbed) until release. |
| E3 | Player clicks a `Locked` (future) part | Ignored, no feedback beyond default. Only the `Active` step responds. |
| E4 | Player clicks an already-`Done` part | Ignored. `Done` is inert and terminal. |
| E5 | `progress` reaches 1.0 mid-frame | Latch to `Completing` immediately; ignore further input for that step; do not allow overshoot to matter. |
| E6 | Player rapidly spams press/release | No state thrash: a press only starts a gesture from `Idle`; releases are idempotent. Debounced by event, not timer. |
| E7 | Re-seat release exactly at `SnapRadius` boundary | Inclusive: `distance ≤ SnapRadius` counts as a seat. |
| E8 | Wind cursor crosses the pivot / jumps (alt-tab, big delta) | Clamp any single-frame angular delta to `WindMaxDeltaPerFrameDeg` to avoid teleport-winding from a cursor jump. |
| E9 | Last step completes | Critter → `ComingAlive`; **all** input ignored until `Alive`. |
| E10 | Window loses focus mid-gesture | Treat as `interact` released (E1 rules). No progress lost beyond E1. |
| E11 | Two hotspots overlap under cursor | The `Active` step's hotspot wins; others are non-interactive anyway (E3/E4). |
| E12 | `FixedOrder = false` future critter | Multiple steps `Active` at once; each is independent; payoff still requires *all* `Done`. (Not exercised by slice.) |

## 7. Parameter table (tunables)

Defaults are starting points for the first feel test; ranges are safe authoring bounds.
All live as `[Export]` fields on the relevant `RepairStepDefinition` subclass (or base),
authored per-critter in a `.tres`. Units noted. **Programmer:** expose every row; do not
hardcode.

### 7.0 Shared (base `RepairStepDefinition`)
| Parameter | Default | Range | Unit | Meaning |
|---|---|---|---|---|
| `CompletionSettleTime` | 0.45 | 0.2 – 1.0 | s | Duration of `Completing` (settle anim + chime) before `Done`. |
| `HighlightPulsePeriod` | 1.2 | 0.6 – 2.5 | s | Period of the `Idle` invite pulse. |
| `HotspotBaseRadius` | 48 | 16 – 128 | px | Default pointer pickup radius for the step's hotspot (overridden per type below where relevant). |

### 7.1 Wind (`WindStepDefinition`)
| Parameter | Default | Range | Unit | Meaning |
|---|---|---|---|---|
| `TargetTurns` | 2.5 | 1.0 – 6.0 | turns | Winding revolutions to complete (1 turn = 360° of accumulated travel). |
| `WindDirectionClockwise` | true | bool | — | Which rotational direction counts as winding. |
| `WindRingOuterRadius` | 110 | 60 – 220 | px | Max cursor distance from pivot for travel to count ("on the key"). |
| `WindRingInnerRadius` | 18 | 0 – 60 | px | Dead zone near pivot (tiny circles shouldn't over-count). |
| `WindTickDegrees` | 30 | 10 – 90 | deg | Angular travel between tick SFX/visual notches. |
| `WindMaxDeltaPerFrameDeg` | 25 | 5 – 60 | deg | Clamp on single-frame angular delta (anti-jump, E8). |
| `WindRetainOnRelease` | true | bool | — | Keep progress when `interact` released (slice: true). |

### 7.2 Re-seat (`ReseatStepDefinition`)
| Parameter | Default | Range | Unit | Meaning |
|---|---|---|---|---|
| `SnapRadius` | 36 | 12 – 80 | px | Release-distance to socket that counts as seated (inclusive, E7). |
| `GrabFromDistance` | 60 | 24 – 140 | px | Cursor distance to gear within which a press grabs it (also normalizes feedback `progress`). |
| `GearFollowLerp` | 0.6 | 0.1 – 1.0 | — | Drag follow smoothing (1.0 = rigid to cursor, lower = laggy/weighty). |
| `GearReturnTime` | 0.30 | 0.1 – 0.8 | s | Time for a missed gear to glide back to rest. |
| `RequireAngleMatch` | false | bool | — | Whether rotation must also align to seat (slice: false). |
| `SnapAngleTolerance` | 20 | 5 – 45 | deg | If `RequireAngleMatch`, allowed angular error at seat. |
| `MagnetHintRadius` | 48 | 20 – 100 | px | Distance at which the socket ghost brightens + hum plays. Should be `≥ SnapRadius`. |

### 7.3 Oil (`OilStepDefinition`)
| Parameter | Default | Range | Unit | Meaning |
|---|---|---|---|---|
| `OilFillRatePerSec` | 0.55 | 0.2 – 1.5 | 1/s | Progress added per second while pouring on-target (default ≈ 1.8 s to fill). |
| `OilDrainRatePerSec` | 0.0 | 0.0 – 0.5 | 1/s | Progress lost per second when off-target/released (slice: 0 = pause, no drain). |
| `OilHotspotRadius` | 44 | 16 – 100 | px | Cursor distance to joint within which pouring counts. |
| `OilMinHoldToStart` | 0.0 | 0.0 – 0.4 | s | Optional hold before fill begins (slice: 0 = instant). |

### 7.4 Critter / payoff (`CritterDefinition`)
| Parameter | Default | Range | Unit | Meaning |
|---|---|---|---|---|
| `FixedOrder` | true | bool | — | Steps must be done in array order (slice: true). |
| `ComeAliveDelay` | 0.35 | 0.0 – 1.0 | s | Beat between final `Done` and the wake animation starting. |
| `AllowTinkerAgainReset` | true | bool | — | Whether `Alive` offers a soft reset to a fresh critter (GDD open Q2). |

## 8. Dependencies

- **Gameplay Programmer:** implements the state machines, resources, and `[Export]`
  fields above; wires `interact`/`cursor`/`cancel` from the input map (GDD §7).
- **Animator:** wake/personality/walk animations + per-step settle motions
  (spring tighten, gear snap, joint wiggle).
- **Sound Designer:** tick, scrape/magnet hum, drip, seat-chime, wake-chime, happy whirr.
- **Concept/Game Artist:** beetle + three repair-site shapes, socket ghost, oil sheen.
- **Level Designer:** the single bench scene framing (fixed camera) that places the
  critter and its three hotspots legibly.

## 9. Test notes (for QA — observable behavior)

1. **Order enforced:** clicking the gear or joint before the spring is wound does nothing
   (E3); only the spring responds first.
2. **No regression:** once a step is `Done`, no input changes it (E4).
3. **No failure path:** releasing/cancelling any gesture never produces a fail state or
   loses a *completed* step; worst case a step returns to `Idle` (E1, re-seat miss).
4. **Wind monotonic:** counter-direction cursor motion never reduces wind progress; a big
   cursor jump never adds more than `WindMaxDeltaPerFrameDeg` of winding (E8).
5. **Oil pause-not-drain (default):** moving off the joint mid-pour holds progress steady
   (with default `OilDrainRatePerSec = 0`).
6. **Snap inclusive:** a gear released with center exactly `SnapRadius` from the socket
   seats (E7).
7. **Completion latches:** reaching `progress ≥ 1.0` immediately locks the step into
   `Completing`; further input is ignored (E5).
8. **Payoff fires once:** when the third step completes, the critter enters `ComingAlive`
   exactly once, ignores input, plays wake → chime → walk, then `Alive` (E9).
9. **Focus loss safe:** alt-tabbing mid-gesture behaves as a clean `interact` release
   (E10), losing no completed progress.
10. **Tunability:** changing a `.tres` value (e.g. `TargetTurns`) changes behavior with no
    code edit.

## 10. Open questions

- **OQ1 (→ GDD Q4):** Re-seat as hold-drag (current spec) vs. click-grab/click-place.
  Spec assumes **hold-drag**; revisit after first feel test.
- **OQ2 (→ GDD Q3):** Is `cancel` needed, or does releasing `interact` cover every case?
  Spec wires `cancel` only as a re-seat safety net.
- **OQ3 (→ GDD Q2):** Behavior of `AllowTinkerAgainReset` (loop vs. end-on-walk).
- **OQ4:** Should Oil use a tiny non-zero `OilDrainRatePerSec` for "active care" feel?
  Default 0 (calm). Decide in playtest; the tunable is already exposed.
