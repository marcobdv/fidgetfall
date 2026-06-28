using System.Numerics;
using ClockworkMenagerie.Core;
using GdUnit4;
using static GdUnit4.Assertions;

namespace ClockworkMenagerie.Tests;

/// <summary>
/// Unit tests for <see cref="OilStep"/> (docs/systems/repair.md §5.3, E1/E2, test note #5).
/// Pure logic — time is driven by explicit <see cref="RepairStep.Tick"/> calls (deterministic,
/// no real time). Joint at origin; on-target = cursor within <see cref="OilStep.OilHotspotRadius"/>.
/// </summary>
[TestSuite]
public class OilStepTest
{
    private static readonly Vector2 Joint = Vector2.Zero;
    private static readonly Vector2 OnTarget = new(10f, 0f);   // within hotspot radius (44)
    private static readonly Vector2 OffTarget = new(100f, 0f); // outside hotspot radius

    /// <summary>An Active OilStep at the joint with default tunables (fill 0.55/s, drain 0).</summary>
    private static OilStep ActiveStep()
    {
        var step = new OilStep { JointPosition = Joint };
        step.Unlock();
        step.Press();
        return step;
    }

    [TestCase]
    public void UpdateCursor_WithinHotspot_IsOnTarget()
    {
        var step = ActiveStep();
        step.UpdateCursor(OnTarget);
        AssertBool(step.IsOnTarget).IsTrue();

        step.UpdateCursor(OffTarget);
        AssertBool(step.IsOnTarget).IsFalse();
    }

    [TestCase]
    public void Tick_HeldOnTarget_FillsProgress()
    {
        var step = ActiveStep();
        step.UpdateCursor(OnTarget);

        float prev = step.Progress;
        for (int i = 0; i < 5; i++)
        {
            step.Tick(0.1f);
            AssertFloat(step.Progress).IsGreater(prev); // strictly rising while pouring
            prev = step.Progress;
        }

        // 5 * 0.1s * 0.55/s = 0.275 progress accumulated.
        AssertFloat(step.Progress).IsEqualApprox(0.275f, 0.001f);
    }

    [TestCase]
    public void Tick_OffTargetDefaultDrainZero_Pauses()
    {
        var step = ActiveStep();

        // Fill a little on-target first.
        step.UpdateCursor(OnTarget);
        step.Tick(0.5f);
        float held = step.Progress;
        AssertFloat(held).IsGreater(0f);

        // Move off-target and keep ticking: with default OilDrainRatePerSec = 0 progress
        // must hold steady (pause, not drain).
        step.UpdateCursor(OffTarget);
        for (int i = 0; i < 10; i++) step.Tick(0.2f);

        AssertFloat(step.Progress).IsEqual(held);
    }

    [TestCase]
    public void Tick_OffTargetThenBackOn_ResumesFromSameProgress()
    {
        var step = ActiveStep();
        step.UpdateCursor(OnTarget);
        step.Tick(0.5f);
        float held = step.Progress;

        step.UpdateCursor(OffTarget);
        step.Tick(0.5f); // paused
        AssertFloat(step.Progress).IsEqual(held);

        step.UpdateCursor(OnTarget);
        step.Tick(0.5f); // resumes
        AssertFloat(step.Progress).IsGreater(held);
    }

    [TestCase]
    public void Release_OnTarget_PausesKeepsProgress()
    {
        var step = ActiveStep();
        step.UpdateCursor(OnTarget);
        step.Tick(0.5f);
        float held = step.Progress;
        AssertFloat(held).IsGreater(0f);

        step.Release(); // E1: releasing pauses, keeps progress, returns to Idle

        AssertObject(step.State).IsEqual(RepairStepState.Idle);
        AssertFloat(step.Progress).IsEqual(held);

        // Re-press and continue on-target: resumes monotonically from the held value.
        step.Press();
        step.UpdateCursor(OnTarget);
        step.Tick(0.5f);
        AssertFloat(step.Progress).IsGreater(held);
    }

    [TestCase]
    public void Tick_FilledOnTarget_CompletesAndLatches()
    {
        var step = ActiveStep();
        step.UpdateCursor(OnTarget);

        // Fill 0.55/s completes in ~1.8s; 2.5s of pour also clears the CompletionSettleTime
        // (0.45s), so the step settles through Completing to the latched terminal Done (E5).
        for (int i = 0; i < 25; i++) step.Tick(0.1f); // 2.5s of pour

        AssertFloat(step.Progress).IsEqual(1f);
        AssertObject(step.State).IsEqual(RepairStepState.Done);
    }

    [TestCase]
    public void Tick_OptionalDrainEnabledOffTarget_Drains()
    {
        // The single documented monotonic exception, OFF by default. Verify the opt-in path
        // so the tunable is covered (repair.md §7.3 / OQ4).
        var step = new OilStep { JointPosition = Joint, OilDrainRatePerSec = 0.5f };
        step.Unlock();
        step.Press();

        step.UpdateCursor(OnTarget);
        step.Tick(1.0f); // fill ~0.55
        float filled = step.Progress;
        AssertFloat(filled).IsGreater(0f);

        step.UpdateCursor(OffTarget);
        step.Tick(0.5f); // drains 0.25 while still held off-target

        AssertFloat(step.Progress).IsLess(filled);
    }
}
