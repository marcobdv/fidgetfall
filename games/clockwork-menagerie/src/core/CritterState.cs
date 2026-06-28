namespace ClockworkMenagerie.Core;

/// <summary>
/// The critter-level state machine (docs/systems/repair.md §3). There is no failure path.
/// </summary>
public enum CritterState
{
    /// <summary>Exactly one step Active (FixedOrder) or all not-Done steps available (free order).</summary>
    Repairing,

    /// <summary>All steps Done. Playing wake animation + chime + personality beat. Input ignored.</summary>
    ComingAlive,

    /// <summary>Terminal for the slice. The critter is alive (optional reset returns to Repairing).</summary>
    Alive,
}
