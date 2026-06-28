using Godot;
using ClockworkMenagerie.Core;

namespace ClockworkMenagerie.Data;

/// <summary>
/// Designer-tunable resource for the Wind step (docs/systems/repair.md §7.1). Mirrors the
/// pure-core <see cref="WindStep"/> tunables as <c>[Export]</c> fields.
/// </summary>
[GlobalClass]
public partial class WindStepDefinition : RepairStepDefinition
{
    /// <summary>Winding revolutions to complete (1 turn = 360°). (repair.md §7.1)</summary>
    [Export] public float TargetTurns { get; set; } = 2.5f;

    /// <summary>Which rotational direction counts as winding. (repair.md §7.1)</summary>
    [Export] public bool WindDirectionClockwise { get; set; } = true;

    /// <summary>Max cursor distance from pivot for travel to count. Pixels. (repair.md §7.1)</summary>
    [Export] public float WindRingOuterRadius { get; set; } = 110f;

    /// <summary>Dead zone near the pivot. Pixels. (repair.md §7.1)</summary>
    [Export] public float WindRingInnerRadius { get; set; } = 18f;

    /// <summary>Angular travel between tick SFX/visual notches. Degrees. (repair.md §7.1)</summary>
    [Export] public float WindTickDegrees { get; set; } = 30f;

    /// <summary>Clamp on a single-frame angular delta (anti-jump E8). Degrees. (repair.md §7.1)</summary>
    [Export] public float WindMaxDeltaPerFrameDeg { get; set; } = 25f;

    /// <summary>Keep progress when interact is released (slice: true). (repair.md §7.1)</summary>
    [Export] public bool WindRetainOnRelease { get; set; } = true;

    public override RepairStep Build()
    {
        var step = new WindStep
        {
            TargetTurns = TargetTurns,
            WindDirectionClockwise = WindDirectionClockwise,
            WindRingOuterRadius = WindRingOuterRadius,
            WindRingInnerRadius = WindRingInnerRadius,
            WindTickDegrees = WindTickDegrees,
            WindMaxDeltaPerFrameDeg = WindMaxDeltaPerFrameDeg,
            WindRetainOnRelease = WindRetainOnRelease,
        };
        ApplyBase(step);
        return step;
    }
}
