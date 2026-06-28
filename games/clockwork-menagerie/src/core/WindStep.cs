using System;
using System.Numerics;

namespace ClockworkMenagerie.Core;

/// <summary>
/// Wind the mainspring (repair.md §5.1). While <c>interact</c> is held and the cursor is on
/// the key (between the inner dead-zone and outer ring about the pivot), accumulated signed
/// angular travel in the intended direction adds winding turns toward <see cref="TargetTurns"/>.
///
/// <para>
/// Monotonic by construction: counter-direction motion contributes 0 (never subtracts —
/// "no unwinding punishment"), and a single-frame delta is clamped to
/// <see cref="WindMaxDeltaPerFrameDeg"/> (anti-jump, E8). Releasing keeps progress
/// (<see cref="WindRetainOnRelease"/>), so Wind never regresses on release.
/// </para>
///
/// <para>
/// Driver contract: call <see cref="Press"/> on press, then <see cref="UpdateCursor"/> each
/// frame with the latest cursor position while held, then <see cref="Tick"/>, then
/// <see cref="Release"/> on release. The pivot is the spring's center in the same space as
/// the cursor positions.
/// </para>
/// </summary>
public sealed class WindStep : RepairStep
{
    private float _accumulatedDegrees;
    private bool _hasPrevAngle;
    private float _prevAngleDeg;

    /// <summary>Winding revolutions to complete (1 turn = 360° of accumulated travel). (repair.md §7.1)</summary>
    public float TargetTurns { get; set; } = 2.5f;

    /// <summary>Which rotational direction counts as winding. (repair.md §7.1)</summary>
    public bool WindDirectionClockwise { get; set; } = true;

    /// <summary>Max cursor distance from pivot for travel to count ("on the key"). Pixels. (repair.md §7.1)</summary>
    public float WindRingOuterRadius { get; set; } = 110f;

    /// <summary>Dead zone near the pivot; tiny circles must not over-count. Pixels. (repair.md §7.1)</summary>
    public float WindRingInnerRadius { get; set; } = 18f;

    /// <summary>Angular travel between tick SFX/visual notches. Degrees. Presentation tunable. (repair.md §7.1)</summary>
    public float WindTickDegrees { get; set; } = 30f;

    /// <summary>Clamp on a single-frame angular delta (anti-jump, E8). Degrees. (repair.md §7.1)</summary>
    public float WindMaxDeltaPerFrameDeg { get; set; } = 25f;

    /// <summary>Keep progress when <c>interact</c> is released (slice: true). (repair.md §7.1)</summary>
    public bool WindRetainOnRelease { get; set; } = true;

    /// <summary>Pivot the cursor circles around (spring center), in cursor space.</summary>
    public Vector2 Pivot { get; set; }

    /// <summary>Total signed winding travel accumulated so far, in degrees (≥ 0). Exposed for tick feedback.</summary>
    public float AccumulatedDegrees => _accumulatedDegrees;

    /// <summary>
    /// Feed the latest cursor position while the gesture is Active. Computes the signed
    /// angular delta about <see cref="Pivot"/> since the previous sample and, if the cursor
    /// is within the ring and moving in the winding direction, advances progress.
    /// Off-ring samples stop counting (E2) but preserve continuity by resetting the
    /// reference angle, so re-entering the ring does not register a phantom jump.
    /// </summary>
    public void UpdateCursor(Vector2 position)
    {
        if (State != RepairStepState.Active) return;

        Vector2 offset = position - Pivot;
        float dist = offset.Length();
        bool onRing = dist >= WindRingInnerRadius && dist <= WindRingOuterRadius;

        if (!onRing)
        {
            // Cursor left the ring: pause counting, drop the reference so the next on-ring
            // sample starts a fresh, gap-free delta (E2).
            _hasPrevAngle = false;
            return;
        }

        float angleDeg = MathF.Atan2(offset.Y, offset.X) * (180f / MathF.PI);

        if (!_hasPrevAngle)
        {
            _prevAngleDeg = angleDeg;
            _hasPrevAngle = true;
            return;
        }

        float delta = NormalizeDelta(angleDeg - _prevAngleDeg);
        _prevAngleDeg = angleDeg;

        // Clamp anti-jump (E8) on the raw signed delta.
        delta = Math.Clamp(delta, -WindMaxDeltaPerFrameDeg, WindMaxDeltaPerFrameDeg);

        // Atan2 grows counter-clockwise. Clockwise winding => negative delta is "winding".
        float windingDeg = WindDirectionClockwise ? -delta : delta;

        // Counter-direction contributes nothing (never subtract — repair.md §5.1).
        if (windingDeg <= 0f) return;

        _accumulatedDegrees += windingDeg;
        float target = MathF.Max(1e-4f, TargetTurns * 360f);
        // Re-derive progress from total travel and advance monotonically to it.
        CommitProgress(_accumulatedDegrees / target);
    }

    protected override void OnActivated()
    {
        // Begin a fresh angular reference each grab; accumulated travel persists across
        // releases when WindRetainOnRelease is true (default).
        _hasPrevAngle = false;
    }

    protected override void OnReleased()
    {
        if (!WindRetainOnRelease) _accumulatedDegrees = 0f;
        _hasPrevAngle = false;
        ReturnToIdle();
    }

    /// <summary>Wraps a raw angle difference into (-180, 180] degrees.</summary>
    private static float NormalizeDelta(float deg)
    {
        deg %= 360f;
        if (deg > 180f) deg -= 360f;
        else if (deg <= -180f) deg += 360f;
        return deg;
    }
}
