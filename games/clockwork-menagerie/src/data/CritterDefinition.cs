using Godot;
using System.Collections.Generic;
using ClockworkMenagerie.Core;

namespace ClockworkMenagerie.Data;

/// <summary>
/// Designer-tunable resource describing one critter: its ordered repair-step definitions plus
/// the critter-level tunables (docs/systems/repair.md §7.4). The Node layer loads this from a
/// <c>.tres</c>, builds the pure-core <see cref="CritterRepair"/> via <see cref="BuildSteps"/>,
/// and copies the critter tunables onto it (architecture.md §3).
/// </summary>
[GlobalClass]
public partial class CritterDefinition : Resource
{
    /// <summary>Ordered repair-step definitions (wind → re-seat → oil for the slice).</summary>
    [Export] public RepairStepDefinition[] Steps { get; set; } = System.Array.Empty<RepairStepDefinition>();

    /// <summary>Steps must be completed in array order (slice: true). (repair.md §7.4)</summary>
    [Export] public bool FixedOrder { get; set; } = true;

    /// <summary>Beat between final Done and the wake animation starting. Seconds. (repair.md §7.4)</summary>
    [Export] public float ComeAliveDelay { get; set; } = 0.35f;

    /// <summary>Whether Alive offers a soft reset to a fresh critter. (repair.md §7.4)</summary>
    [Export] public bool AllowTinkerAgainReset { get; set; } = true;

    /// <summary>Build a fresh ordered list of pure-core steps from the definitions.</summary>
    public List<RepairStep> BuildSteps()
    {
        var built = new List<RepairStep>(Steps.Length);
        foreach (RepairStepDefinition def in Steps)
        {
            if (def is null) continue;
            built.Add(def.Build());
        }
        return built;
    }

    /// <summary>Build the pure-core critter driver with critter-level tunables applied.</summary>
    public CritterRepair BuildCritter()
    {
        var critter = new CritterRepair(BuildSteps(), FixedOrder)
        {
            ComeAliveDelay = ComeAliveDelay,
            AllowTinkerAgainReset = AllowTinkerAgainReset,
        };
        return critter;
    }
}
