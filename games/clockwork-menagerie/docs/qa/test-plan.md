# QA Test Plan — Repair System (core logic)

> Owner: QA Tester. Scope: the pure-C# repair heart in `src/core/` (no scene tree).
> Source spec: `docs/systems/repair.md`. Architecture: `docs/architecture.md`.
> Framework: GdUnit4 (`[TestSuite]`/`[TestCase]`), naming `Method_State_Expectation`.
> Run: Orchestrator runs `dotnet test` with `GODOT_BIN` set. (QA does not run the suite.)

## How tests drive the logic

All tests construct the core classes directly and drive them with explicit
`Unlock()` / `Press()` / `UpdateCursor(Vector2)` / `Tick(dt)` / `Release()` calls — no
`ISceneRunner`, no scene tree (the headless scene runner is flagged unstable in the testing
skill). Time is deterministic: every time-based behavior is advanced by explicit `Tick(dt)`
calls, never real time. Positions use `System.Numerics.Vector2` (the core's own type).

Notes that shaped the tests (verified against the real API):

- **WindStep angle convention:** `UpdateCursor` uses `Atan2(offset.Y, offset.X)` (grows
  counter-clockwise). With `WindDirectionClockwise = true` (default), the winding direction
  is a *decreasing* atan2 angle. The first on-ring sample only seeds the reference angle, and
  each single-frame delta is clamped to `WindMaxDeltaPerFrameDeg` (25°), so winding is driven
  with many small consecutive on-ring samples.
- **ReseatStep grab:** the gated `TryGrab(cursorPos)` is the real entry point (returns bool;
  ignores clicks outside `GrabFromDistance` of `RestPosition`). Bare `Press()` always grabs.
- **OilStep fill:** `UpdateCursor` sets on/off-target; `Tick(dt)` accumulates fill only while
  Active **and** on-target. Default `OilDrainRatePerSec = 0` ⇒ off-target pauses (no drain).
- **CritterRepair payoff:** `ComeAlive` fires only from `Tick`, once, after `ComeAliveDelay`
  elapses past all-steps-Done. Steps are completed via fast-fill `OilStep`s (deterministic).
- **Step completion:** progress ≥ 1.0 latches `Completing`; `Completing → Done` after
  `CompletionSettleTime` (0.45s) of `Tick`.

## Requirement → test-case map

### WindStep (`repair.md` §5.1, E8; test notes #4, #7) — `test/WindStepTest.cs`

| Spec requirement | Test case |
|---|---|
| Progress increases monotonically while winding | `UpdateCursor_WindingDirection_IncreasesProgressMonotonically` |
| Counter-direction motion does not increase progress | `UpdateCursor_CounterDirection_DoesNotIncreaseProgress` |
| Counter motion after winding never subtracts ("no unwind punishment") | `UpdateCursor_CounterAfterWinding_DoesNotReduceProgress` |
| Progress clamps at 1.0 | `UpdateCursor_Progress_ClampsAtOne` |
| Completes at `TargetTurns` (latches Completing) | `UpdateCursor_ReachesTargetTurns_LatchesCompleting` |
| Single-frame jump clamped to `WindMaxDeltaPerFrameDeg` (E8) | `UpdateCursor_SingleHugeJump_ClampedByAntiJump` |
| Off-ring cursor does not count (E2) | `UpdateCursor_OffRing_DoesNotCount` |
| Release retains progress; re-press resumes (no regress) | `Release_WithRetainOnRelease_KeepsProgress` |
| Input ignored when not Active | `UpdateCursor_WhenNotActive_IgnoresInput` |

### ReseatStep (`repair.md` §5.2, E7; test notes #3, #6) — `test/ReseatStepTest.cs`

| Spec requirement | Test case |
|---|---|
| Grab within `GrabFromDistance` starts the gesture | `TryGrab_WithinGrabDistance_StartsActive` |
| Grab outside reach is ignored | `TryGrab_OutsideGrabDistance_IsIgnored` |
| Release within `SnapRadius` seats/completes | `Release_InsideSnapRadius_SeatsAndCompletes` |
| Release exactly at `SnapRadius` seats (inclusive, E7) | `Release_ExactlyAtSnapRadiusBoundary_SeatsInclusive` |
| Release outside `SnapRadius` returns to rest, no penalty | `Release_OutsideSnapRadius_ReturnsToRestNoProgress` |
| Miss is retryable (can grab + seat again) | `Release_AfterMiss_CanRetryAndSeat` |
| `Cancel` mid-drag = miss, no penalty (E1) | `Cancel_DuringDrag_ReturnsToRestNoPenalty` |
| Feedback proximity rises toward socket | `FeedbackProgress_NearSocket_IsHigherThanFarFromSocket` |

### OilStep (`repair.md` §5.3, E1/E2; test note #5) — `test/OilStepTest.cs`

| Spec requirement | Test case |
|---|---|
| Cursor within hotspot = on-target | `UpdateCursor_WithinHotspot_IsOnTarget` |
| Fills while held on-target | `Tick_HeldOnTarget_FillsProgress` |
| Off-target with default drain 0 pauses (no drain) | `Tick_OffTargetDefaultDrainZero_Pauses` |
| Resumes from same progress when back on-target | `Tick_OffTargetThenBackOn_ResumesFromSameProgress` |
| Release pauses, keeps progress, resumes on re-press | `Release_OnTarget_PausesKeepsProgress` |
| Completes when filled (latches Completing) | `Tick_FilledOnTarget_CompletesAndLatches` |
| Opt-in `OilDrainRatePerSec > 0` drains off-target (tunable coverage) | `Tick_OptionalDrainEnabledOffTarget_Drains` |

### CritterRepair (`repair.md` §3, E9/E12; test notes #1, #8) — `test/CritterRepairTest.cs`

| Spec requirement | Test case |
|---|---|
| FixedOrder: only first step Active, rest Locked | `Constructor_FixedOrder_OnlyFirstStepActive` |
| FixedOrder gates next step until prior Done | `Tick_FixedOrder_GatesNextStepUntilPriorDone` |
| `ComeAlive` fires exactly once when all steps done | `Tick_AllStepsDone_FiresComeAliveExactlyOnce` |
| `AllStepsDone` false until every step done | `AllStepsDone_BeforeCompletion_IsFalse` |
| `OverallProgress` rises as steps complete | `OverallProgress_RisesAsStepsComplete` |
| Starts in `Repairing` | `State_BeforeCompletion_IsRepairing` |
| FreeOrder (E12): all steps Active at once | `Constructor_FreeOrder_AllStepsActiveAtOnce` |

### RepairStep base machine (`repair.md` §4, E4/E5/E6; test notes #2, #7) — `test/RepairStepTest.cs`

| Spec requirement | Test case |
|---|---|
| Initial state Locked, progress 0 | `State_Initial_IsLocked` |
| Press while Locked ignored | `Press_WhileLocked_IsIgnored` |
| Unlock Locked → Idle | `Unlock_FromLocked_GoesToIdle` |
| Unlock idempotent past Locked | `Unlock_WhenPastLocked_IsIdempotent` |
| Repeated press while Active does not thrash (E6) | `Press_RepeatedWhileActive_DoesNotThrash` |
| Release when not Active is idempotent (E6) | `Release_WhenNotActive_IsIdempotent` |
| Progress 1.0 latches Completing, ignores input (E5) | `AdvanceProgress_ReachesOne_LatchesCompletingAndIgnoresInput` |
| Completing → Done after `CompletionSettleTime` | `Tick_CompletingPastSettleTime_BecomesDone` |
| Done is inert/terminal (E4) | `Done_IsInert_PressAndProgressDoNothing` |
| Non-positive `Tick` delta is a no-op | `Tick_NonPositiveDelta_IsNoOp` |

## Coverage of `repair.md` §9 observable-behavior checklist

| # | Behavior | Covered by |
|---|---|---|
| 1 | Order enforced (E3) | `Constructor_FixedOrder_OnlyFirstStepActive`, `Tick_FixedOrder_GatesNextStepUntilPriorDone` |
| 2 | No regression once Done (E4) | `Done_IsInert_PressAndProgressDoNothing` |
| 3 | No failure path; worst case → Idle | `Release_OutsideSnapRadius_ReturnsToRestNoProgress`, `Release_OnTarget_PausesKeepsProgress` |
| 4 | Wind monotonic; jump-clamped (E8) | `UpdateCursor_CounterAfterWinding_DoesNotReduceProgress`, `UpdateCursor_SingleHugeJump_ClampedByAntiJump` |
| 5 | Oil pause-not-drain (default) | `Tick_OffTargetDefaultDrainZero_Pauses` |
| 6 | Snap inclusive at boundary (E7) | `Release_ExactlyAtSnapRadiusBoundary_SeatsInclusive` |
| 7 | Completion latches (E5) | `AdvanceProgress_ReachesOne_LatchesCompletingAndIgnoresInput` |
| 8 | Payoff fires once (E9) | `Tick_AllStepsDone_FiresComeAliveExactlyOnce` |
| 9 | Focus loss = clean release (E10) | Covered indirectly: focus loss maps to `Release()` in the Node layer; `Release_*` tests prove no progress lost. **See gaps below.** |
| 10 | Tunability (.tres changes behavior) | Out of core scope — all tunables are settable C# props (set directly in tests). `.tres` round-trip is a Node-layer concern; see gaps. |

## Gaps / behaviors NOT testable against the current core API

These are flagged for the Orchestrator / Gameplay Programmer to reconcile:

1. **Focus-loss / window-blur (E10):** the core has no focus concept — the Node layer is
   expected to translate blur into a `Release()` call. We prove `Release()` loses no progress
   (Wind retains, Oil pauses), but the *blur → release* mapping itself lives in the untested
   Node layer.
2. **`.tres` tunability round-trip (test note #10):** the core exposes plain settable props;
   the `RepairStepDefinition` `[Export]` mirror + copy-into-core step is Node/Godot-side and
   not yet implemented (architecture §3 leaves it to the Gameplay Programmer). No core test can
   cover it until that layer exists.
3. **`TinkerAgain` reset:** present in `CritterRepair` but only valid in `Alive`; the slice
   defaults `AllowTinkerAgainReset = true` but GDD OQ3 leaves the behavior open. Not yet
   asserted pending a design decision — can add a regression test once OQ3 is resolved.
4. **`RequireAngleMatch` seat path:** defaults to `false` for the slice (position-only seat);
   the angle-gated branch in `ReseatStep.OnReleased` exists but is future-critter behavior, so
   it is left for a follow-up suite when an angle-matching critter is authored.
5. **Presentation tunables** (`HighlightPulsePeriod`, `WindTickDegrees`, `GearFollowLerp`,
   `MagnetHintRadius` visuals, settle/wake animation, SFX): presentation-only; verified by
   manual/exploratory testing once the Node + art/audio layers land, not by core unit tests.
