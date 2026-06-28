using System;
using System.Numerics;

namespace ClockworkMenagerie.Core;

/// <summary>
/// Re-seat the bent gear (repair.md §5.2). Press <c>interact</c> while the cursor is within
/// <see cref="GrabFromDistance"/> of the gear to grab it; drag; release. On release within
/// <see cref="SnapRadius"/> of the socket (inclusive, E7) the gear snaps home and the step
/// completes. A miss glides the gear back to its rest position with NO progress penalty
/// (repair.md §5.2 "no failure"); the step simply returns to Idle to be re-grabbed.
///
/// <para>
/// <see cref="FeedbackProgress"/> is the continuous 0..1 value for visuals (proximity to the
/// socket) and may fall as the player drags away — it is deliberately separate from the
/// canonical monotonic <see cref="RepairStep.Progress"/>, which only commits to 1.0 on a
/// successful seat. That keeps the "a completed step never regresses" invariant intact.
/// </para>
///
/// <para>
/// Driver contract: <see cref="Press"/> (records grab if in range), <see cref="UpdateCursor"/>
/// each frame while held (updates <see cref="GearPosition"/> and feedback), then
/// <see cref="Release"/> / <see cref="Cancel"/>. The Node layer handles the visual return-to-rest
/// tween over <see cref="GearReturnTime"/>; the logic snaps <see cref="GearPosition"/> to rest
/// immediately on a miss and lets the view interpolate.
/// </para>
/// </summary>
public sealed class ReseatStep : RepairStep
{
    private bool _grabbed;

    /// <summary>Release distance to the socket that counts as seated (inclusive, E7). Pixels. (repair.md §7.2)</summary>
    public float SnapRadius { get; set; } = 36f;

    /// <summary>Cursor distance to the gear within which a press grabs it (also normalizes feedback). Pixels. (repair.md §7.2)</summary>
    public float GrabFromDistance { get; set; } = 60f;

    /// <summary>Drag follow smoothing (1 = rigid, lower = weighty). Used by the Node layer. (repair.md §7.2)</summary>
    public float GearFollowLerp { get; set; } = 0.6f;

    /// <summary>Time for a missed gear to glide back to rest. Seconds. View-side. (repair.md §7.2)</summary>
    public float GearReturnTime { get; set; } = 0.30f;

    /// <summary>Whether rotation must also align to seat (slice: false). (repair.md §7.2)</summary>
    public bool RequireAngleMatch { get; set; } = false;

    /// <summary>If <see cref="RequireAngleMatch"/>, allowed angular error at seat. Degrees. (repair.md §7.2)</summary>
    public float SnapAngleTolerance { get; set; } = 20f;

    /// <summary>Distance at which the socket ghost brightens + hum plays (≥ SnapRadius). Pixels. (repair.md §7.2)</summary>
    public float MagnetHintRadius { get; set; } = 48f;

    /// <summary>The gear's rest (start) position, in cursor space.</summary>
    public Vector2 RestPosition { get; set; }

    /// <summary>The socket the gear seats into, in cursor space.</summary>
    public Vector2 SocketPosition { get; set; }

    /// <summary>The socket's target seat angle. Degrees. Only consulted when <see cref="RequireAngleMatch"/>.</summary>
    public float SocketAngleDeg { get; set; }

    /// <summary>Current gear center, in cursor space. Tracks the cursor while grabbed; snaps to socket on seat or to rest on miss.</summary>
    public Vector2 GearPosition { get; private set; }

    /// <summary>Current gear rotation. Degrees. Driven by the Node layer when angle-matching is on.</summary>
    public float GearAngleDeg { get; set; }

    /// <summary>True while the player holds the gear.</summary>
    public bool IsGrabbed => _grabbed;

    /// <summary>Continuous 0..1 closeness-to-socket value for feedback only. NOT monotonic.</summary>
    public float FeedbackProgress { get; private set; }

    /// <summary>True when the gear is close enough to show the magnetic "let go here" hint.</summary>
    public bool IsWithinMagnetHint =>
        _grabbed && (GearPosition - SocketPosition).Length() <= MagnetHintRadius;

    /// <summary>
    /// Feed the latest cursor position while Active. If a grab is in progress the gear follows
    /// the cursor and the feedback value updates from socket proximity. (The optional
    /// <see cref="GearFollowLerp"/> weighting is a view concern; logic tracks the raw target.)
    /// </summary>
    public void UpdateCursor(Vector2 position)
    {
        if (State != RepairStepState.Active || !_grabbed) return;
        GearPosition = position;
        UpdateFeedback();
    }

    /// <summary><c>cancel</c> / Esc during a drag: same as a missed release — return the gear to rest, no penalty (E1).</summary>
    public void Cancel() => Release();

    protected override void OnActivated()
    {
        // A press only grabs if the cursor started within reach of the gear. The driver
        // sets GearPosition (via the first UpdateCursor) but we decide grab eligibility from
        // the gear's current position relative to where the press landed: the Node layer
        // passes the press position by calling TryGrab. Default Press() assumes in-range; see
        // TryGrab for the gated path.
        _grabbed = true;
        UpdateFeedback();
    }

    /// <summary>
    /// Gated grab: starts the gesture only if <paramref name="cursorPosition"/> is within
    /// <see cref="GrabFromDistance"/> of the gear's rest position (repair.md §5.2). Clicks
    /// outside reach are ignored (no state change). Prefer this over bare <see cref="Press"/>.
    /// </summary>
    /// <returns>True if the gear was grabbed.</returns>
    public bool TryGrab(Vector2 cursorPosition)
    {
        if (State != RepairStepState.Idle) return false;
        if ((cursorPosition - RestPosition).Length() > GrabFromDistance) return false;
        Press();                 // Idle → Active, sets _grabbed via OnActivated
        GearPosition = cursorPosition;
        UpdateFeedback();
        return true;
    }

    protected override void OnReleased()
    {
        _grabbed = false;
        float dist = (GearPosition - SocketPosition).Length();
        bool angleOk = !RequireAngleMatch ||
                       Math.Abs(NormalizeSigned(GearAngleDeg - SocketAngleDeg)) <= SnapAngleTolerance;

        if (dist <= SnapRadius && angleOk)
        {
            // Seat: snap exactly home and commit to complete.
            GearPosition = SocketPosition;
            if (RequireAngleMatch) GearAngleDeg = SocketAngleDeg;
            FeedbackProgress = 1f;
            CommitProgress(1f);   // → Completing
        }
        else
        {
            // Miss: return to rest, no penalty, back to Idle (E1). View tweens over GearReturnTime.
            GearPosition = RestPosition;
            FeedbackProgress = 0f;
            ReturnToIdle();
        }
    }

    private void UpdateFeedback()
    {
        float dist = (GearPosition - SocketPosition).Length();
        float reach = MathF.Max(1e-4f, GrabFromDistance);
        FeedbackProgress = Math.Clamp(1f - dist / reach, 0f, 1f);
    }

    private static float NormalizeSigned(float deg)
    {
        deg %= 360f;
        if (deg > 180f) deg -= 360f;
        else if (deg < -180f) deg += 360f;
        return deg;
    }
}
