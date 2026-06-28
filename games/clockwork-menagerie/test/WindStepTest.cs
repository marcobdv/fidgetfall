using System.Numerics;
using ClockworkMenagerie.Core;
using GdUnit4;
using static GdUnit4.Assertions;

namespace ClockworkMenagerie.Tests;

/// <summary>
/// Unit tests for <see cref="WindStep"/> (docs/systems/repair.md §5.1, test notes #4, #7).
/// Pure logic — no scene tree. The pivot is the origin; cursor positions are placed on a
/// circle of radius <c>r</c> (inside the wind ring) at chosen angles.
///
/// Coordinate note: <c>UpdateCursor</c> derives angle via <c>Atan2(offset.Y, offset.X)</c>,
/// which grows counter-clockwise. With the default <c>WindDirectionClockwise = true</c>, a
/// DECREASING atan2 angle (clockwise on the math circle) is the winding direction. Each
/// single-frame delta is clamped to <see cref="WindStep.WindMaxDeltaPerFrameDeg"/> (default
/// 25°), and the first on-ring sample only seeds the reference angle, so accumulating travel
/// requires many small consecutive on-ring samples.
/// </summary>
[TestSuite]
public class WindStepTest
{
    private const float Radius = 80f; // between inner (18) and outer (110) ring radii

    /// <summary>Position on the wind ring at the given math angle (degrees, atan2 convention).</summary>
    private static Vector2 OnRing(float angleDeg)
    {
        float rad = angleDeg * (System.MathF.PI / 180f);
        return new Vector2(Radius * System.MathF.Cos(rad), Radius * System.MathF.Sin(rad));
    }

    /// <summary>Build an Active WindStep at the origin pivot, ready to receive cursor samples.</summary>
    private static WindStep ActiveStep(float targetTurns = 2.5f)
    {
        var step = new WindStep { Pivot = Vector2.Zero, TargetTurns = targetTurns };
        step.Unlock();
        step.Press();
        return step;
    }

    /// <summary>
    /// Drives the cursor clockwise (decreasing atan2 angle) from <paramref name="startDeg"/>
    /// in small steps of <paramref name="stepDeg"/> for <paramref name="count"/> samples.
    /// Step size stays at/under the anti-jump clamp so every degree counts.
    /// </summary>
    private static void WindClockwise(WindStep step, float startDeg, float stepDeg, int count)
    {
        step.UpdateCursor(OnRing(startDeg)); // first sample only seeds the reference angle
        float angle = startDeg;
        for (int i = 0; i < count; i++)
        {
            angle -= stepDeg; // clockwise on the atan2 circle
            step.UpdateCursor(OnRing(angle));
        }
    }

    [TestCase]
    public void UpdateCursor_WindingDirection_IncreasesProgressMonotonically()
    {
        var step = ActiveStep(targetTurns: 2.5f);

        float prev = step.Progress;
        float angle = 0f;
        step.UpdateCursor(OnRing(angle)); // seed
        for (int i = 0; i < 20; i++)
        {
            angle -= 20f; // 20° clockwise per sample (< 25° clamp)
            step.UpdateCursor(OnRing(angle));
            AssertFloat(step.Progress).IsGreaterEqual(prev); // never decreases
            prev = step.Progress;
        }

        AssertFloat(step.Progress).IsGreater(0f);
    }

    [TestCase]
    public void UpdateCursor_CounterDirection_DoesNotIncreaseProgress()
    {
        var step = ActiveStep();

        // Counter-clockwise = INCREASING atan2 angle = anti-winding (ignored, never subtracts).
        step.UpdateCursor(OnRing(0f)); // seed
        float angle = 0f;
        for (int i = 0; i < 20; i++)
        {
            angle += 20f; // counter-direction
            step.UpdateCursor(OnRing(angle));
        }

        AssertFloat(step.Progress).IsEqual(0f);
        AssertFloat(step.AccumulatedDegrees).IsEqual(0f);
    }

    [TestCase]
    public void UpdateCursor_CounterAfterWinding_DoesNotReduceProgress()
    {
        var step = ActiveStep();

        WindClockwise(step, 0f, 20f, 10); // accumulate some winding
        AssertFloat(step.Progress).IsGreater(0f);

        // Re-seat the angular reference, THEN capture the baseline: this seeding sample can
        // itself register a small in-direction delta, so the counter-motion baseline must be
        // taken AFTER it. What we assert is that subsequent counter motion changes nothing.
        step.UpdateCursor(OnRing(0f));
        float baseline = step.Progress;

        // Pure counter-direction (CCW = increasing atan2 angle) must add nothing (never subtract).
        float angle = 0f;
        for (int i = 0; i < 10; i++)
        {
            angle += 20f;
            step.UpdateCursor(OnRing(angle));
        }

        AssertFloat(step.Progress).IsEqual(baseline);
    }

    [TestCase]
    public void UpdateCursor_Progress_ClampsAtOne()
    {
        var step = ActiveStep(targetTurns: 1.0f); // 360° to complete

        // Drive far more than 360° of clockwise travel in legal-sized steps.
        WindClockwise(step, 0f, 20f, 60); // ~1200° of intended travel

        AssertFloat(step.Progress).IsEqual(1f);
    }

    [TestCase]
    public void UpdateCursor_ReachesTargetTurns_LatchesCompleting()
    {
        var step = ActiveStep(targetTurns: 1.0f);

        WindClockwise(step, 0f, 20f, 60);

        // At progress >= 1.0 the base class latches into Completing immediately (E5).
        AssertObject(step.State).IsEqual(RepairStepState.Completing);
    }

    [TestCase]
    public void UpdateCursor_SingleHugeJump_ClampedByAntiJump()
    {
        var step = ActiveStep(targetTurns: 1.0f);

        // One enormous clockwise jump (170°) in a single frame must add at most
        // WindMaxDeltaPerFrameDeg (25°) of winding, not the full jump (E8).
        step.UpdateCursor(OnRing(0f));     // seed
        step.UpdateCursor(OnRing(-170f));  // huge single-frame delta

        // 25° of 360° target = ~0.0694 progress max.
        AssertFloat(step.AccumulatedDegrees).IsLessEqual(25f + 0.01f);
        AssertFloat(step.Progress).IsLess(0.1f);
    }

    [TestCase]
    public void UpdateCursor_OffRing_DoesNotCount()
    {
        var step = ActiveStep();

        // Cursor far outside the outer ring (radius 110): travel must not accumulate.
        var far = new Vector2(500f, 0f);
        step.UpdateCursor(far);
        step.UpdateCursor(new Vector2(0f, 500f));
        step.UpdateCursor(new Vector2(-500f, 0f));

        AssertFloat(step.Progress).IsEqual(0f);
        AssertFloat(step.AccumulatedDegrees).IsEqual(0f);
    }

    [TestCase]
    public void Release_WithRetainOnRelease_KeepsProgress()
    {
        var step = ActiveStep();
        WindClockwise(step, 0f, 20f, 10);
        float wound = step.Progress;
        AssertFloat(wound).IsGreater(0f);

        step.Release(); // default WindRetainOnRelease = true

        AssertObject(step.State).IsEqual(RepairStepState.Idle);
        AssertFloat(step.Progress).IsEqual(wound); // no regression on release

        // Re-press and continue: progress resumes from where it was, still monotonic.
        step.Press();
        WindClockwise(step, 0f, 20f, 5);
        AssertFloat(step.Progress).IsGreaterEqual(wound);
    }

    [TestCase]
    public void UpdateCursor_WhenNotActive_IgnoresInput()
    {
        var step = new WindStep { Pivot = Vector2.Zero };
        step.Unlock(); // Idle, not Active

        WindClockwise(step, 0f, 20f, 10);

        AssertFloat(step.Progress).IsEqual(0f);
        AssertObject(step.State).IsEqual(RepairStepState.Idle);
    }
}
