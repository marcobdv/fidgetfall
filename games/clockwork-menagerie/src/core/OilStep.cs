using System;
using System.Numerics;

namespace ClockworkMenagerie.Core;

/// <summary>
/// Oil the stuck leg joint (repair.md §5.3). While <c>interact</c> is held AND the cursor is
/// within <see cref="OilHotspotRadius"/> of the joint, the oil meter fills at
/// <see cref="OilFillRatePerSec"/> per second. Moving off-target or releasing PAUSES the fill
/// (calm, no punishment); with the default <see cref="OilDrainRatePerSec"/> of 0 it never
/// drains, so progress is monotonic.
///
/// <para>
/// Driver contract: <see cref="Press"/> on press, <see cref="UpdateCursor"/> whenever the
/// cursor moves (sets on/off-target), <see cref="RepairStep.Tick"/> every frame (accumulates
/// fill while held + on-target), <see cref="Release"/> on release.
/// </para>
/// </summary>
public sealed class OilStep : RepairStep
{
    private bool _onTarget;
    private float _holdElapsed;

    /// <summary>Progress added per second while pouring on-target. 1/s. (repair.md §7.3)</summary>
    public float OilFillRatePerSec { get; set; } = 0.55f;

    /// <summary>Progress lost per second when off-target/released (slice: 0 = pause, no drain). 1/s. (repair.md §7.3)</summary>
    public float OilDrainRatePerSec { get; set; } = 0.0f;

    /// <summary>Cursor distance to the joint within which pouring counts. Pixels. (repair.md §7.3)</summary>
    public float OilHotspotRadius { get; set; } = 44f;

    /// <summary>Optional hold before fill begins (slice: 0 = instant). Seconds. (repair.md §7.3)</summary>
    public float OilMinHoldToStart { get; set; } = 0.0f;

    /// <summary>The joint center the oiler must be over, in cursor space.</summary>
    public Vector2 JointPosition { get; set; }

    /// <summary>True while the cursor is within the hotspot. Set by <see cref="UpdateCursor"/>.</summary>
    public bool IsOnTarget => _onTarget;

    /// <summary>Update on/off-target state from the latest cursor position.</summary>
    public void UpdateCursor(Vector2 position)
    {
        _onTarget = (position - JointPosition).Length() <= OilHotspotRadius;
    }

    protected override void OnActivated()
    {
        // Fresh hold timer each pour; accumulated fill is retained across pauses/releases.
        _holdElapsed = 0f;
    }

    protected override void OnActiveTick(float dt)
    {
        if (_onTarget)
        {
            _holdElapsed += dt;
            if (_holdElapsed >= OilMinHoldToStart)
            {
                AdvanceProgress(OilFillRatePerSec * dt);   // monotonic fill
            }
        }
        else if (OilDrainRatePerSec > 0f)
        {
            // Optional "active care" feel — exposed but defaults to 0 (calm, pause-not-drain).
            DrainProgress(OilDrainRatePerSec * dt);
        }
    }

    protected override void OnReleased()
    {
        // Releasing pauses (keeps progress); no drain. Optional drain happens off-target while
        // still held, per the tunable. Return to Idle so the player can re-hold to resume.
        _holdElapsed = 0f;
        ReturnToIdle();
    }
}
