using System.Collections.Generic;
using System.Numerics;
using ClockworkMenagerie.Core;
using GdUnit4;
using static GdUnit4.Assertions;

namespace ClockworkMenagerie.Tests;

/// <summary>
/// Unit tests for <see cref="CritterRepair"/> (docs/systems/repair.md §3, E9, E12,
/// test notes #1, #8). Pure logic. Steps are <see cref="OilStep"/>s at the origin because
/// they are deterministically completable via <c>Press</c> + on-target <c>UpdateCursor</c> +
/// <c>Tick</c>, with no geometry math needed.
/// </summary>
[TestSuite]
public class CritterRepairTest
{
    /// <summary>A pristine OilStep that fills fast (1/s) so one Tick(1.0) latches Completing.</summary>
    private static OilStep MakeStep() =>
        new() { JointPosition = Vector2.Zero, OilFillRatePerSec = 1.0f, CompletionSettleTime = 0.45f };

    /// <summary>
    /// Drives a single Active OilStep to <see cref="RepairStepState.Done"/>: press, hold
    /// on-target to fill (latches Completing at progress 1.0), then tick out the settle timer.
    /// The critter must be ticked separately by the caller to advance its own machine.
    /// </summary>
    private static void CompleteStep(OilStep step)
    {
        step.Press();
        step.UpdateCursor(Vector2.Zero); // on-target (joint at origin)
        step.Tick(1.0f);                 // fill to 1.0 -> Completing
        // settle: Completing -> Done after CompletionSettleTime (0.45s)
        step.Tick(0.5f);
    }

    [TestCase]
    public void Constructor_FixedOrder_OnlyFirstStepActive()
    {
        var s1 = MakeStep();
        var s2 = MakeStep();
        var s3 = MakeStep();
        var critter = new CritterRepair(new RepairStep[] { s1, s2, s3 }, fixedOrder: true);

        // Only the first step unlocks (Idle); the rest stay Locked (E3).
        AssertObject(s1.State).IsEqual(RepairStepState.Idle);
        AssertObject(s2.State).IsEqual(RepairStepState.Locked);
        AssertObject(s3.State).IsEqual(RepairStepState.Locked);

        int activeCount = 0;
        foreach (var _ in critter.ActiveSteps) activeCount++;
        AssertInt(activeCount).IsEqual(1);
    }

    [TestCase]
    public void Tick_FixedOrder_GatesNextStepUntilPriorDone()
    {
        var s1 = MakeStep();
        var s2 = MakeStep();
        var critter = new CritterRepair(new RepairStep[] { s1, s2 }, fixedOrder: true);

        // While step 1 is still locked-gating, step 2 must not be available.
        AssertObject(s2.State).IsEqual(RepairStepState.Locked);

        CompleteStep(s1);
        critter.Tick(0.016f); // critter re-evaluates and unlocks the next step

        AssertBool(s1.IsComplete).IsTrue();
        AssertObject(s2.State).IsEqual(RepairStepState.Idle); // now the active one

        int activeCount = 0;
        foreach (var _ in critter.ActiveSteps) activeCount++;
        AssertInt(activeCount).IsEqual(1); // still exactly one active at a time
    }

    [TestCase]
    public void Tick_AllStepsDone_FiresComeAliveExactlyOnce()
    {
        var s1 = MakeStep();
        var s2 = MakeStep();
        var s3 = MakeStep();
        var critter = new CritterRepair(new RepairStep[] { s1, s2, s3 }, fixedOrder: true)
        {
            ComeAliveDelay = 0.35f,
        };

        int fired = 0;
        critter.ComeAlive += () => fired++;

        // Complete each step in order, ticking the critter between to unlock the next.
        CompleteStep(s1);
        critter.Tick(0.016f);
        CompleteStep(s2);
        critter.Tick(0.016f);
        CompleteStep(s3);
        critter.Tick(0.016f); // detects AllStepsDone -> ComingAlive

        AssertObject(critter.State).IsEqual(CritterState.ComingAlive);
        AssertInt(fired).IsEqual(0); // not yet — waits ComeAliveDelay

        // Advance past ComeAliveDelay: fires once and enters Alive.
        critter.Tick(0.4f);
        AssertInt(fired).IsEqual(1);
        AssertObject(critter.State).IsEqual(CritterState.Alive);

        // Further ticks must never fire it again.
        critter.Tick(1.0f);
        critter.Tick(1.0f);
        AssertInt(fired).IsEqual(1);
    }

    [TestCase]
    public void AllStepsDone_BeforeCompletion_IsFalse()
    {
        var s1 = MakeStep();
        var s2 = MakeStep();
        var critter = new CritterRepair(new RepairStep[] { s1, s2 }, fixedOrder: true);

        AssertBool(critter.AllStepsDone).IsFalse();

        CompleteStep(s1);
        critter.Tick(0.016f);
        AssertBool(critter.AllStepsDone).IsFalse(); // only one of two done
    }

    [TestCase]
    public void OverallProgress_RisesAsStepsComplete()
    {
        var s1 = MakeStep();
        var s2 = MakeStep();
        var critter = new CritterRepair(new RepairStep[] { s1, s2 }, fixedOrder: true);

        AssertFloat(critter.OverallProgress).IsEqual(0f);

        CompleteStep(s1);
        critter.Tick(0.016f);

        // One of two steps fully done => overall ~0.5.
        AssertFloat(critter.OverallProgress).IsEqualApprox(0.5f, 0.001f);
    }

    [TestCase]
    public void State_BeforeCompletion_IsRepairing()
    {
        var critter = new CritterRepair(new RepairStep[] { MakeStep() }, fixedOrder: true);
        AssertObject(critter.State).IsEqual(CritterState.Repairing);
    }

    [TestCase]
    public void Constructor_FreeOrder_AllStepsActiveAtOnce()
    {
        var s1 = MakeStep();
        var s2 = MakeStep();
        var s3 = MakeStep();
        var critter = new CritterRepair(new RepairStep[] { s1, s2, s3 }, fixedOrder: false);

        // FixedOrder = false (future critters, E12): all not-Done steps available at once.
        AssertObject(s1.State).IsEqual(RepairStepState.Idle);
        AssertObject(s2.State).IsEqual(RepairStepState.Idle);
        AssertObject(s3.State).IsEqual(RepairStepState.Idle);

        int activeCount = 0;
        foreach (var _ in critter.ActiveSteps) activeCount++;
        AssertInt(activeCount).IsEqual(3);
    }
}
