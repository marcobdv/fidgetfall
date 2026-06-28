using Godot;
using ClockworkMenagerie.Core;

namespace ClockworkMenagerie.Data;

/// <summary>
/// Designer-tunable base resource mirroring the shared <see cref="RepairStep"/> tunables
/// (docs/systems/repair.md §7.0). Subclasses add per-type tunables and build the matching
/// pure-core step. The Node layer loads a <see cref="CritterDefinition"/> and calls
/// <see cref="Build"/> on each step definition, then copies the authored values onto the
/// core object via <see cref="ApplyBase"/> — realizing the "designer tunes the .tres, no
/// code change" flow (architecture.md §3).
/// </summary>
[GlobalClass]
public abstract partial class RepairStepDefinition : Resource
{
    /// <summary>Logical hotspot id so the Node layer can map this definition to its view/site. (e.g. "wind", "reseat", "oil")</summary>
    [Export] public string StepId { get; set; } = "";

    /// <summary>Duration of the Completing settle before Done. Seconds. (repair.md §7.0)</summary>
    [Export] public float CompletionSettleTime { get; set; } = 0.45f;

    /// <summary>Period of the Idle invite pulse. Seconds. (repair.md §7.0)</summary>
    [Export] public float HighlightPulsePeriod { get; set; } = 1.2f;

    /// <summary>Default pointer pickup radius for this step's hotspot. Pixels. (repair.md §7.0)</summary>
    [Export] public float HotspotBaseRadius { get; set; } = 48f;

    /// <summary>Build the matching pure-core <see cref="RepairStep"/> with all tunables copied on.</summary>
    public abstract RepairStep Build();

    /// <summary>Copy the shared base tunables onto a freshly built core step.</summary>
    protected void ApplyBase(RepairStep step)
    {
        step.CompletionSettleTime = CompletionSettleTime;
        step.HighlightPulsePeriod = HighlightPulsePeriod;
        step.HotspotBaseRadius = HotspotBaseRadius;
    }
}
