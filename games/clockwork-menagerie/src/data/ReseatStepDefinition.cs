using Godot;
using ClockworkMenagerie.Core;

namespace ClockworkMenagerie.Data;

/// <summary>
/// Designer-tunable resource for the Re-seat step (docs/systems/repair.md §7.2). Mirrors the
/// pure-core <see cref="ReseatStep"/> tunables as <c>[Export]</c> fields.
/// </summary>
[GlobalClass]
public partial class ReseatStepDefinition : RepairStepDefinition
{
    /// <summary>Release distance to socket that counts as seated (inclusive E7). Pixels. (repair.md §7.2)</summary>
    [Export] public float SnapRadius { get; set; } = 36f;

    /// <summary>Cursor distance to gear within which a press grabs it. Pixels. (repair.md §7.2)</summary>
    [Export] public float GrabFromDistance { get; set; } = 60f;

    /// <summary>Drag follow smoothing (1 = rigid). (repair.md §7.2)</summary>
    [Export] public float GearFollowLerp { get; set; } = 0.6f;

    /// <summary>Time for a missed gear to glide back to rest. Seconds. (repair.md §7.2)</summary>
    [Export] public float GearReturnTime { get; set; } = 0.30f;

    /// <summary>Whether rotation must align to seat (slice: false). (repair.md §7.2)</summary>
    [Export] public bool RequireAngleMatch { get; set; } = false;

    /// <summary>Allowed angular error at seat if RequireAngleMatch. Degrees. (repair.md §7.2)</summary>
    [Export] public float SnapAngleTolerance { get; set; } = 20f;

    /// <summary>Distance at which the socket ghost brightens + hum plays (≥ SnapRadius). Pixels. (repair.md §7.2)</summary>
    [Export] public float MagnetHintRadius { get; set; } = 48f;

    public override RepairStep Build()
    {
        var step = new ReseatStep
        {
            SnapRadius = SnapRadius,
            GrabFromDistance = GrabFromDistance,
            GearFollowLerp = GearFollowLerp,
            GearReturnTime = GearReturnTime,
            RequireAngleMatch = RequireAngleMatch,
            SnapAngleTolerance = SnapAngleTolerance,
            MagnetHintRadius = MagnetHintRadius,
        };
        ApplyBase(step);
        return step;
    }
}
