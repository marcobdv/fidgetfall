using System.Numerics;
using ClockworkMenagerie.Core;
using GdUnit4;
using static GdUnit4.Assertions;

namespace ClockworkMenagerie.Tests;

/// <summary>
/// Unit tests for the shared <see cref="RepairStep"/> base machine (docs/systems/repair.md §4,
/// E4/E5/E6, test notes #2, #7). Exercised through a concrete <see cref="OilStep"/> driver
/// (fast fill) so we only assert base-class behavior: Locked/Idle gating, idempotent
/// press/release, completion latch, and the Completing -> Done settle timer.
/// </summary>
[TestSuite]
public class RepairStepTest
{
    private static OilStep MakeStep() =>
        new() { JointPosition = Vector2.Zero, OilFillRatePerSec = 1.0f, CompletionSettleTime = 0.45f };

    [TestCase]
    public void State_Initial_IsLocked()
    {
        var step = MakeStep();
        AssertObject(step.State).IsEqual(RepairStepState.Locked);
        AssertFloat(step.Progress).IsEqual(0f);
        AssertBool(step.IsComplete).IsFalse();
    }

    [TestCase]
    public void Press_WhileLocked_IsIgnored()
    {
        var step = MakeStep();
        step.Press(); // not unlocked yet -> no effect (E3-like gating)
        AssertObject(step.State).IsEqual(RepairStepState.Locked);
    }

    [TestCase]
    public void Unlock_FromLocked_GoesToIdle()
    {
        var step = MakeStep();
        step.Unlock();
        AssertObject(step.State).IsEqual(RepairStepState.Idle);
    }

    [TestCase]
    public void Unlock_WhenPastLocked_IsIdempotent()
    {
        var step = MakeStep();
        step.Unlock();
        step.Press(); // Active now
        step.Unlock(); // must not yank an Active step back to Idle
        AssertObject(step.State).IsEqual(RepairStepState.Active);
    }

    [TestCase]
    public void Press_RepeatedWhileActive_DoesNotThrash()
    {
        var step = MakeStep();
        step.Unlock();
        step.Press();
        step.Press(); // E6: repeated press is idempotent
        step.Press();
        AssertObject(step.State).IsEqual(RepairStepState.Active);
    }

    [TestCase]
    public void Release_WhenNotActive_IsIdempotent()
    {
        var step = MakeStep();
        step.Unlock();      // Idle
        step.Release();     // E6: release with no active gesture is a no-op
        AssertObject(step.State).IsEqual(RepairStepState.Idle);
    }

    [TestCase]
    public void AdvanceProgress_ReachesOne_LatchesCompletingAndIgnoresInput()
    {
        var step = MakeStep();
        step.Unlock();
        step.Press();
        step.UpdateCursor(Vector2.Zero);
        step.Tick(1.0f); // fill to 1.0 -> Completing (E5)

        AssertObject(step.State).IsEqual(RepairStepState.Completing);
        AssertFloat(step.Progress).IsEqual(1f);

        // Input is ignored while Completing: a release must not knock it out of Completing.
        step.Release();
        AssertObject(step.State).IsEqual(RepairStepState.Completing);
    }

    [TestCase]
    public void Tick_CompletingPastSettleTime_BecomesDone()
    {
        var step = MakeStep();
        step.Unlock();
        step.Press();
        step.UpdateCursor(Vector2.Zero);
        step.Tick(1.0f); // -> Completing

        step.Tick(0.44f); // just under CompletionSettleTime (0.45) -> still Completing
        AssertObject(step.State).IsEqual(RepairStepState.Completing);

        step.Tick(0.02f); // crosses 0.45 total -> Done
        AssertObject(step.State).IsEqual(RepairStepState.Done);
        AssertBool(step.IsComplete).IsTrue();
    }

    [TestCase]
    public void Done_IsInert_PressAndProgressDoNothing()
    {
        var step = MakeStep();
        step.Unlock();
        step.Press();
        step.UpdateCursor(Vector2.Zero);
        step.Tick(1.0f);   // Completing
        step.Tick(0.5f);   // Done
        AssertObject(step.State).IsEqual(RepairStepState.Done);

        // E4: Done is terminal and inert — no input changes it.
        step.Press();
        step.UpdateCursor(Vector2.Zero);
        step.Tick(1.0f);
        step.Release();

        AssertObject(step.State).IsEqual(RepairStepState.Done);
        AssertFloat(step.Progress).IsEqual(1f);
    }

    [TestCase]
    public void Tick_NonPositiveDelta_IsNoOp()
    {
        var step = MakeStep();
        step.Unlock();
        step.Press();
        step.UpdateCursor(Vector2.Zero);

        step.Tick(0f);    // ignored
        step.Tick(-1f);   // ignored
        AssertFloat(step.Progress).IsEqual(0f);
        AssertObject(step.State).IsEqual(RepairStepState.Active);
    }
}
