using Godot;
using ClockworkMenagerie.Core;

namespace ClockworkMenagerie.Data;

/// <summary>
/// Designer-tunable resource for the Oil step (docs/systems/repair.md §7.3). Mirrors the
/// pure-core <see cref="OilStep"/> tunables as <c>[Export]</c> fields.
/// </summary>
[GlobalClass]
public partial class OilStepDefinition : RepairStepDefinition
{
    /// <summary>Progress added per second while pouring on-target. 1/s. (repair.md §7.3)</summary>
    [Export] public float OilFillRatePerSec { get; set; } = 0.55f;

    /// <summary>Progress lost per second when off-target/released (slice: 0 = pause). 1/s. (repair.md §7.3)</summary>
    [Export] public float OilDrainRatePerSec { get; set; } = 0.0f;

    /// <summary>Cursor distance to joint within which pouring counts. Pixels. (repair.md §7.3)</summary>
    [Export] public float OilHotspotRadius { get; set; } = 44f;

    /// <summary>Optional hold before fill begins (slice: 0 = instant). Seconds. (repair.md §7.3)</summary>
    [Export] public float OilMinHoldToStart { get; set; } = 0.0f;

    public override RepairStep Build()
    {
        var step = new OilStep
        {
            OilFillRatePerSec = OilFillRatePerSec,
            OilDrainRatePerSec = OilDrainRatePerSec,
            OilHotspotRadius = OilHotspotRadius,
            OilMinHoldToStart = OilMinHoldToStart,
        };
        ApplyBase(step);
        return step;
    }
}
