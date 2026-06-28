namespace ClockworkMenagerie.Core;

/// <summary>
/// The four (+ Locked) states every <see cref="RepairStep"/> moves through, per the
/// per-step state machine in docs/systems/repair.md §4. There is no failure state —
/// the worst outcome is returning to <see cref="Idle"/>.
/// </summary>
public enum RepairStepState
{
    /// <summary>Not yet this step's turn (FixedOrder). Inert, no affordance, ignores input.</summary>
    Locked,

    /// <summary>Current step, awaiting the player. A press starts it; hover highlights.</summary>
    Idle,

    /// <summary>Gesture in progress; drives <see cref="RepairStep.Progress"/>.</summary>
    Active,

    /// <summary>Target reached; settle + chime playing. Input is locked out.</summary>
    Completing,

    /// <summary>Finished. Terminal and inert.</summary>
    Done,
}
