using System;

namespace ClockworkMenagerie.Core;

/// <summary>
/// Abstract base for a single repair gesture (Wind / Re-seat / Oil). Pure C# — NO Godot
/// types — so the whole repair heart is unit-testable without the scene tree
/// (docs/conventions.md "logic testable without the editor").
///
/// <para>
/// Implements the shared per-step state machine from docs/systems/repair.md §4:
/// <c>Locked → Idle → Active → Completing → Done</c>. Subclasses supply the gesture-
/// specific progress accumulation by calling <see cref="AdvanceProgress"/>, which is the
/// single monotonic, clamped entry point for the canonical <see cref="Progress"/> value
/// (repair.md §1: "Progress is monotonic").
/// </para>
///
/// <para>
/// Tunables are plain settable properties seeded with the spec defaults (§7.0). The Godot
/// layer mirrors these onto <c>RepairStepDefinition</c> <c>[Export]</c> fields and copies
/// the authored <c>.tres</c> values in before driving the step.
/// </para>
/// </summary>
public abstract class RepairStep
{
    private float _progress;
    private float _completingElapsed;

    /// <summary>Duration of <see cref="RepairStepState.Completing"/> before <see cref="RepairStepState.Done"/>. Seconds. (repair.md §7.0)</summary>
    public float CompletionSettleTime { get; set; } = 0.45f;

    /// <summary>Period of the Idle invite pulse. Seconds. Presentation-only tunable carried for the Node layer. (repair.md §7.0)</summary>
    public float HighlightPulsePeriod { get; set; } = 1.2f;

    /// <summary>Default pointer pickup radius for this step's hotspot. Pixels. (repair.md §7.0)</summary>
    public float HotspotBaseRadius { get; set; } = 48f;

    /// <summary>Current state in the per-step machine.</summary>
    public RepairStepState State { get; private set; } = RepairStepState.Locked;

    /// <summary>
    /// Canonical normalized progress, 0.0 → 1.0. Monotonic: it only ever moves toward the
    /// target via <see cref="AdvanceProgress"/> and is clamped to [0, 1].
    /// </summary>
    public float Progress => _progress;

    /// <summary>True once the step has fully settled (<see cref="RepairStepState.Done"/>).</summary>
    public bool IsComplete => State == RepairStepState.Done;

    /// <summary>
    /// Monotonic, clamped progress advance — the only way <see cref="Progress"/> changes.
    /// A non-positive <paramref name="amount"/> is ignored (never decreases). On reaching
    /// 1.0 the step latches into <see cref="RepairStepState.Completing"/> immediately
    /// (repair.md E5) and ignores further input.
    /// </summary>
    /// <returns>The new <see cref="Progress"/> value after clamping.</returns>
    protected float AdvanceProgress(float amount)
    {
        if (State != RepairStepState.Active) return _progress;
        if (amount > 0f)
        {
            _progress = Math.Clamp(_progress + amount, 0f, 1f);
            if (_progress >= 1f) EnterCompleting();
        }
        return _progress;
    }

    /// <summary>
    /// Sets <see cref="Progress"/> directly while clamped — used by gestures whose target is
    /// reached atomically rather than accumulated (e.g. a successful re-seat snap). Still
    /// monotonic: a value below the current progress is ignored.
    /// </summary>
    protected float CommitProgress(float value)
    {
        if (State != RepairStepState.Active) return _progress;
        float clamped = Math.Clamp(value, 0f, 1f);
        if (clamped > _progress)
        {
            _progress = clamped;
            if (_progress >= 1f) EnterCompleting();
        }
        return _progress;
    }

    /// <summary>
    /// Promotes this step from <see cref="RepairStepState.Locked"/> to
    /// <see cref="RepairStepState.Idle"/> when it becomes the current step (FixedOrder), or
    /// when all steps unlock (FixedOrder = false). Idempotent if already past Locked.
    /// </summary>
    public void Unlock()
    {
        if (State == RepairStepState.Locked) State = RepairStepState.Idle;
    }

    /// <summary>
    /// Player pressed <c>interact</c> on the hotspot. Starts the gesture from
    /// <see cref="RepairStepState.Idle"/>. Idempotent / debounced by state (repair.md E6):
    /// presses in any other state are ignored.
    /// </summary>
    public void Press()
    {
        if (State == RepairStepState.Idle)
        {
            State = RepairStepState.Active;
            OnActivated();
        }
    }

    /// <summary>
    /// Player released <c>interact</c> (or <c>cancel</c>, or focus loss — repair.md E1/E10).
    /// Delegates the per-type behavior to <see cref="OnReleased"/>. Idempotent if not Active.
    /// </summary>
    public void Release()
    {
        if (State == RepairStepState.Active) OnReleased();
    }

    /// <summary>
    /// Advances time. Only meaningful while <see cref="RepairStepState.Completing"/>, where
    /// it counts down the settle timer before transitioning to <see cref="RepairStepState.Done"/>.
    /// Subclasses may also use elapsed time during Active (e.g. Oil fill) via
    /// <see cref="OnActiveTick"/>.
    /// </summary>
    /// <param name="dt">Delta time in seconds.</param>
    public void Tick(float dt)
    {
        if (dt <= 0f) return;
        switch (State)
        {
            case RepairStepState.Active:
                OnActiveTick(dt);
                break;
            case RepairStepState.Completing:
                _completingElapsed += dt;
                if (_completingElapsed >= CompletionSettleTime) State = RepairStepState.Done;
                break;
        }
    }

    /// <summary>
    /// Optional, opt-in progress drain — the single documented exception to the monotonic
    /// rule, exposed only for tunables that default to OFF (e.g. <c>OilDrainRatePerSec = 0</c>,
    /// repair.md §7.3 / OQ4). On the slice's default settings this is never called, so
    /// <see cref="Progress"/> stays monotonic. Clamps at 0 and never below; ignored unless Active.
    /// </summary>
    protected float DrainProgress(float amount)
    {
        if (State != RepairStepState.Active || amount <= 0f) return _progress;
        _progress = Math.Max(0f, _progress - amount);
        return _progress;
    }

    /// <summary>Returns the step to <see cref="RepairStepState.Active"/>-less Idle without losing any latched progress. Used by re-seat misses and explicit cancels (repair.md E1).</summary>
    protected void ReturnToIdle()
    {
        if (State == RepairStepState.Active) State = RepairStepState.Idle;
    }

    private void EnterCompleting()
    {
        State = RepairStepState.Completing;
        _completingElapsed = 0f;
        OnCompleting();
    }

    // ---- Subclass extension points (seams for the gesture-specific logic) ----

    /// <summary>Called when the step transitions Idle → Active (press accepted). Reset per-gesture scratch state here.</summary>
    protected virtual void OnActivated() { }

    /// <summary>Called each tick while Active. Time-driven gestures (Oil) accumulate here.</summary>
    protected virtual void OnActiveTick(float dt) { }

    /// <summary>Called when <c>interact</c>/<c>cancel</c> is released while Active. Default: keep progress, return to Idle (Wind-like). Override for re-seat (return gear) etc.</summary>
    protected virtual void OnReleased() => ReturnToIdle();

    /// <summary>Called once when the step latches into Completing (progress reached 1.0).</summary>
    protected virtual void OnCompleting() { }
}
