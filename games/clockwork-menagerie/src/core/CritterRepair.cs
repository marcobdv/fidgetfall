using System;
using System.Collections.Generic;

namespace ClockworkMenagerie.Core;

/// <summary>
/// Drives an ordered list of <see cref="RepairStep"/>s for one critter and owns the
/// critter-level state machine (docs/systems/repair.md §3). Pure C# — testable without the
/// scene tree. The Godot layer (a <c>Node</c>) owns visuals/audio/input and simply forwards
/// presses/cursor/ticks to the <see cref="ActiveSteps"/> and listens for <see cref="ComeAlive"/>.
///
/// <para>
/// <b>FixedOrder = true</b> (slice): only the first not-Done step is Active; earlier steps are
/// Done, later steps Locked. When the active step reaches Done, the next unlocks and becomes
/// Active. <b>FixedOrder = false</b> (future critters): all not-Done steps are Active at once;
/// payoff still requires every step Done (repair.md E12). The code never assumes single-active.
/// </para>
/// </summary>
public sealed class CritterRepair
{
    private readonly List<RepairStep> _steps;
    private float _comeAliveElapsed;
    private bool _comeAliveFired;

    /// <summary>Steps must be completed in array order (slice: true). (repair.md §7.4)</summary>
    public bool FixedOrder { get; }

    /// <summary>Beat between final Done and the wake animation starting. Seconds. (repair.md §7.4)</summary>
    public float ComeAliveDelay { get; set; } = 0.35f;

    /// <summary>Whether <see cref="CritterState.Alive"/> offers a soft reset to a fresh critter (GDD open Q2). (repair.md §7.4)</summary>
    public bool AllowTinkerAgainReset { get; set; } = true;

    /// <summary>Current critter-level state.</summary>
    public CritterState State { get; private set; } = CritterState.Repairing;

    /// <summary>The ordered steps (read-only view).</summary>
    public IReadOnlyList<RepairStep> Steps => _steps;

    /// <summary>
    /// Fired exactly once, after <see cref="ComeAliveDelay"/> elapses past the final step
    /// reaching Done — the come-to-life payoff trigger (repair.md §3 / GDD §3). The Node layer
    /// subscribes to start the wake animation, chime, personality beat, and walk.
    /// </summary>
    public event Action? ComeAlive;

    /// <summary>
    /// Constructs the critter driver over an ordered set of steps.
    /// </summary>
    /// <param name="steps">The repair steps in their authored order (wind → re-seat → oil for the slice).</param>
    /// <param name="fixedOrder">True to enforce array order; false to make all steps available at once.</param>
    public CritterRepair(IEnumerable<RepairStep> steps, bool fixedOrder = true)
    {
        if (steps is null) throw new ArgumentNullException(nameof(steps));
        _steps = new List<RepairStep>(steps);
        if (_steps.Count == 0) throw new ArgumentException("A critter needs at least one repair step.", nameof(steps));
        FixedOrder = fixedOrder;
        UnlockAvailableSteps();
    }

    /// <summary>
    /// Overall repair progress as the mean of the per-step progress, 0..1. Convenience for a
    /// HUD-less diegetic readout or tests; the game itself shows progress diegetically.
    /// </summary>
    public float OverallProgress
    {
        get
        {
            float sum = 0f;
            foreach (RepairStep s in _steps) sum += s.Progress;
            return sum / _steps.Count;
        }
    }

    /// <summary>True once every step is Done.</summary>
    public bool AllStepsDone
    {
        get
        {
            foreach (RepairStep s in _steps)
                if (!s.IsComplete) return false;
            return true;
        }
    }

    /// <summary>
    /// The steps that currently accept input. FixedOrder: the single first not-Done step (once
    /// it has been unlocked past Locked). Free order: every not-Done step. Steps still Locked or
    /// Completing/Done are excluded.
    /// </summary>
    public IEnumerable<RepairStep> ActiveSteps
    {
        get
        {
            foreach (RepairStep s in _steps)
            {
                if (s.State == RepairStepState.Idle || s.State == RepairStepState.Active)
                    yield return s;
            }
        }
    }

    /// <summary>
    /// Advance all driven steps and the critter-level machine by <paramref name="dt"/> seconds.
    /// Call once per frame. While <see cref="CritterState.ComingAlive"/>/<see cref="CritterState.Alive"/>
    /// input is ignored (repair.md E9), but step ticks still run so settle timers finish.
    /// </summary>
    public void Tick(float dt)
    {
        if (dt <= 0f) return;

        foreach (RepairStep s in _steps) s.Tick(dt);

        if (State == CritterState.Repairing)
        {
            UnlockAvailableSteps();
            if (AllStepsDone)
            {
                State = CritterState.ComingAlive;
                _comeAliveElapsed = 0f;
            }
        }
        else if (State == CritterState.ComingAlive)
        {
            _comeAliveElapsed += dt;
            if (!_comeAliveFired && _comeAliveElapsed >= ComeAliveDelay)
            {
                _comeAliveFired = true;
                ComeAlive?.Invoke();
                State = CritterState.Alive;
            }
        }
    }

    /// <summary>
    /// Soft "tinker again" reset (GDD open Q2). Only valid in <see cref="CritterState.Alive"/>
    /// and only when <see cref="AllowTinkerAgainReset"/>. The caller supplies fresh steps (the
    /// Node layer rebuilds them from the <c>CritterDefinition</c>) since steps are single-use.
    /// </summary>
    public void TinkerAgain(IEnumerable<RepairStep> freshSteps)
    {
        if (State != CritterState.Alive || !AllowTinkerAgainReset) return;
        if (freshSteps is null) throw new ArgumentNullException(nameof(freshSteps));
        _steps.Clear();
        _steps.AddRange(freshSteps);
        if (_steps.Count == 0) throw new ArgumentException("Reset needs at least one repair step.", nameof(freshSteps));
        _comeAliveElapsed = 0f;
        _comeAliveFired = false;
        State = CritterState.Repairing;
        UnlockAvailableSteps();
    }

    /// <summary>
    /// Promotes steps from Locked to Idle as they become available. FixedOrder: unlock the first
    /// not-Done step only. Free order: unlock all not-Done steps. Idempotent.
    /// </summary>
    private void UnlockAvailableSteps()
    {
        if (FixedOrder)
        {
            foreach (RepairStep s in _steps)
            {
                if (!s.IsComplete)
                {
                    s.Unlock();   // first not-Done step becomes the active one
                    return;       // all later steps stay Locked
                }
            }
        }
        else
        {
            foreach (RepairStep s in _steps)
                if (!s.IsComplete) s.Unlock();
        }
    }
}
