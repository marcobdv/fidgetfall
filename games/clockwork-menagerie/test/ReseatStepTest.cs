using System.Numerics;
using ClockworkMenagerie.Core;
using GdUnit4;
using static GdUnit4.Assertions;

namespace ClockworkMenagerie.Tests;

/// <summary>
/// Unit tests for <see cref="ReseatStep"/> (docs/systems/repair.md §5.2, E7, test notes #3, #6).
/// Pure logic. Rest position and socket are placed far apart; the gear follows the cursor
/// while grabbed and seats on release within <see cref="ReseatStep.SnapRadius"/> (inclusive).
/// A miss returns to Idle with no progress penalty (retryable).
/// </summary>
[TestSuite]
public class ReseatStepTest
{
    private static readonly Vector2 Rest = new(0f, 0f);
    private static readonly Vector2 Socket = new(200f, 0f);

    /// <summary>An unlocked (Idle) ReseatStep with default tunables (SnapRadius 36, GrabFromDistance 60).</summary>
    private static ReseatStep IdleStep()
    {
        var step = new ReseatStep { RestPosition = Rest, SocketPosition = Socket };
        step.Unlock();
        return step;
    }

    [TestCase]
    public void TryGrab_WithinGrabDistance_StartsActive()
    {
        var step = IdleStep();

        bool grabbed = step.TryGrab(Rest); // exactly on the gear rest position

        AssertBool(grabbed).IsTrue();
        AssertBool(step.IsGrabbed).IsTrue();
        AssertObject(step.State).IsEqual(RepairStepState.Active);
    }

    [TestCase]
    public void TryGrab_OutsideGrabDistance_IsIgnored()
    {
        var step = IdleStep();

        // 100px from rest > GrabFromDistance (60): no grab, no state change.
        bool grabbed = step.TryGrab(new Vector2(100f, 0f));

        AssertBool(grabbed).IsFalse();
        AssertBool(step.IsGrabbed).IsFalse();
        AssertObject(step.State).IsEqual(RepairStepState.Idle);
    }

    [TestCase]
    public void Release_InsideSnapRadius_SeatsAndCompletes()
    {
        var step = IdleStep();
        step.TryGrab(Rest);

        // Drag the gear to within SnapRadius (36) of the socket — 20px away.
        step.UpdateCursor(Socket + new Vector2(20f, 0f));
        step.Release();

        // Seats: snaps exactly to socket, progress commits to 1.0, latches Completing.
        AssertFloat(step.Progress).IsEqual(1f);
        AssertObject(step.State).IsEqual(RepairStepState.Completing);
        AssertFloat(step.GearPosition.X).IsEqual(Socket.X); // snapped exactly to socket
        AssertFloat(step.GearPosition.Y).IsEqual(Socket.Y);
    }

    [TestCase]
    public void Release_ExactlyAtSnapRadiusBoundary_SeatsInclusive()
    {
        var step = IdleStep();
        step.TryGrab(Rest);

        // Release with center exactly SnapRadius (36) from the socket — inclusive (E7).
        step.UpdateCursor(Socket + new Vector2(36f, 0f));
        step.Release();

        AssertFloat(step.Progress).IsEqual(1f);
        AssertObject(step.State).IsEqual(RepairStepState.Completing);
    }

    [TestCase]
    public void Release_OutsideSnapRadius_ReturnsToRestNoProgress()
    {
        var step = IdleStep();
        step.TryGrab(Rest);

        // Release just outside SnapRadius (40px > 36): a miss.
        step.UpdateCursor(Socket + new Vector2(40f, 0f));
        step.Release();

        AssertObject(step.State).IsEqual(RepairStepState.Idle); // back to Idle, no fail
        AssertFloat(step.Progress).IsEqual(0f);                 // no progress penalty
        AssertFloat(step.GearPosition.X).IsEqual(Rest.X);       // snapped back to rest
        AssertFloat(step.GearPosition.Y).IsEqual(Rest.Y);
        AssertBool(step.IsGrabbed).IsFalse();
    }

    [TestCase]
    public void Release_AfterMiss_CanRetryAndSeat()
    {
        var step = IdleStep();

        // First attempt: miss.
        step.TryGrab(Rest);
        step.UpdateCursor(Socket + new Vector2(80f, 0f));
        step.Release();
        AssertObject(step.State).IsEqual(RepairStepState.Idle);
        AssertFloat(step.Progress).IsEqual(0f);

        // Second attempt from rest: this time seat it.
        bool grabbed = step.TryGrab(Rest);
        AssertBool(grabbed).IsTrue();
        step.UpdateCursor(Socket);
        step.Release();
        AssertFloat(step.Progress).IsEqual(1f);
        AssertObject(step.State).IsEqual(RepairStepState.Completing);
    }

    [TestCase]
    public void Cancel_DuringDrag_ReturnsToRestNoPenalty()
    {
        var step = IdleStep();
        step.TryGrab(Rest);
        step.UpdateCursor(new Vector2(120f, 50f)); // somewhere mid-drag, not near socket

        step.Cancel(); // E1: same as a missed release

        AssertObject(step.State).IsEqual(RepairStepState.Idle);
        AssertFloat(step.Progress).IsEqual(0f);
        AssertFloat(step.GearPosition.X).IsEqual(Rest.X);
        AssertFloat(step.GearPosition.Y).IsEqual(Rest.Y);
    }

    [TestCase]
    public void FeedbackProgress_NearSocket_IsHigherThanFarFromSocket()
    {
        var step = IdleStep();
        step.TryGrab(Rest);

        step.UpdateCursor(Socket + new Vector2(55f, 0f)); // far
        float far = step.FeedbackProgress;

        step.UpdateCursor(Socket + new Vector2(10f, 0f)); // near
        float near = step.FeedbackProgress;

        AssertFloat(near).IsGreater(far);
    }
}
