using Godot;
using System.Collections.Generic;
using ClockworkMenagerie.Core;
using ClockworkMenagerie.Data;

namespace ClockworkMenagerie.View;

/// <summary>
/// The Node-layer heart of the beetle (architecture.md §4). Loads a <see cref="CritterDefinition"/>
/// <c>.tres</c>, builds the pure-core <see cref="CritterRepair"/> and its steps with all designer
/// tunables copied on, binds each step to its <see cref="IStepView"/>, routes <c>interact</c> /
/// <c>cancel</c> / cursor to the active step each physics frame, ticks the core, and on the
/// <see cref="CritterRepair.ComeAlive"/> event plays the come-to-life payoff (chime + spark +
/// toddle). No game rules live here — this is glue.
/// </summary>
public partial class CritterController : Node2D
{
    [Export] public CritterDefinition? Definition { get; set; }

    /// <summary>Step views in authored order (wind, re-seat, oil). Matched by index to Definition.Steps.</summary>
    [Export] public NodePath[] StepViewPaths { get; set; } = System.Array.Empty<NodePath>();

    /// <summary>Optional shared SFX hub. If unset, the controller searches for a sibling SoundManager.</summary>
    [Export] public NodePath SoundManagerPath { get; set; } = "";

    /// <summary>Spark sprite to flash on come-alive (optional).</summary>
    [Export] public NodePath SparkPath { get; set; } = "";

    private CritterRepair _critter = null!;
    private readonly List<IStepView> _views = new();
    private SoundManager? _sound;
    private Node2D? _spark;

    private RepairStepState[] _prevStepStates = System.Array.Empty<RepairStepState>();
    private bool _aliveStarted;
    private float _toddleTime = -1f;
    private Godot.Vector2 _homePos;

    public override void _Ready()
    {
        _homePos = Position;

        _sound = ResolveSound();
        if (SparkPath != "" && HasNode(SparkPath)) _spark = GetNodeOrNull<Node2D>(SparkPath);

        if (Definition is null)
        {
            GD.PushError("CritterController: no CritterDefinition assigned.");
            return;
        }

        // Build the pure core with all tunables copied from the .tres (architecture.md §3).
        _critter = Definition.BuildCritter();
        _critter.ComeAlive += OnComeAlive;

        // Bind each built step to its view (by index, authored order).
        IReadOnlyList<RepairStep> steps = _critter.Steps;
        for (int i = 0; i < StepViewPaths.Length && i < steps.Count; i++)
        {
            var view = GetNodeOrNull<Node>(StepViewPaths[i]) as IStepView;
            if (view is null)
            {
                GD.PushError($"CritterController: step view {i} at '{StepViewPaths[i]}' is not an IStepView.");
                continue;
            }
            view.Bind(steps[i], _sound);
            _views.Add(view);
        }

        _prevStepStates = new RepairStepState[steps.Count];
        for (int i = 0; i < steps.Count; i++) _prevStepStates[i] = steps[i].State;
    }

    private SoundManager? ResolveSound()
    {
        if (SoundManagerPath != "" && HasNode(SoundManagerPath))
            return GetNodeOrNull<SoundManager>(SoundManagerPath);
        // Fall back to a SoundManager anywhere in the tree.
        foreach (Node n in GetTree().Root.GetChildren())
        {
            var found = FindSound(n);
            if (found is not null) return found;
        }
        return null;
    }

    private static SoundManager? FindSound(Node node)
    {
        if (node is SoundManager sm) return sm;
        foreach (Node c in node.GetChildren())
        {
            var f = FindSound(c);
            if (f is not null) return f;
        }
        return null;
    }

    public override void _PhysicsProcess(double delta)
    {
        if (_critter is null) return;
        float dt = (float)delta;

        if (_critter.State == CritterState.Repairing)
            RouteInput();

        _critter.Tick(dt);

        DetectStepCompletions();
    }

    /// <summary>Translate input map + cursor into core calls on the active step(s).</summary>
    private void RouteInput()
    {
        Godot.Vector2 cursor = GetGlobalMousePosition();
        bool pressed = Input.IsActionJustPressed("interact");
        bool released = Input.IsActionJustReleased("interact");
        bool cancel = Input.IsActionJustPressed("cancel");

        foreach (IStepView view in _views)
        {
            RepairStepState s = view.Step.State;
            if (s != RepairStepState.Idle && s != RepairStepState.Active) continue;

            // Cursor always forwarded so active gestures (wind/reseat/oil) track motion.
            view.OnCursor(cursor);

            if (pressed && view.ContainsCursor(cursor))
                view.OnPress(cursor);

            if (released)
                view.OnRelease();

            if (cancel)
                view.OnCancel();
        }
    }

    /// <summary>Fire the shared step-done chime once when any step latches into Completing.</summary>
    private void DetectStepCompletions()
    {
        IReadOnlyList<RepairStep> steps = _critter.Steps;
        for (int i = 0; i < steps.Count && i < _prevStepStates.Length; i++)
        {
            RepairStepState now = steps[i].State;
            if (_prevStepStates[i] != RepairStepState.Completing &&
                _prevStepStates[i] != RepairStepState.Done &&
                now == RepairStepState.Completing)
            {
                _sound?.Play("step_done", 1f, -2f);
            }
            _prevStepStates[i] = now;
        }
    }

    private void OnComeAlive()
    {
        _aliveStarted = true;
        _sound?.Play("come_alive");
        PlaySpark();
        _toddleTime = 0f;   // begin the toddle-across-the-desk beat
    }

    private void PlaySpark()
    {
        if (_spark is null) return;
        _spark.Visible = true;
        _spark.Scale = Godot.Vector2.One * 0.2f;
        _spark.Modulate = Colors.White;
        var tween = CreateTween();
        tween.SetParallel(true);
        tween.TweenProperty(_spark, "scale", Godot.Vector2.One * 1.8f, 0.6f).SetTrans(Tween.TransitionType.Back).SetEase(Tween.EaseType.Out);
        tween.TweenProperty(_spark, "modulate:a", 0f, 0.6f);
    }

    public override void _Process(double delta)
    {
        if (!_aliveStarted || _toddleTime < 0f) return;

        // Personality beat + toddle: a little head-tilt bob, then walk to the right.
        float dt = (float)delta;
        _toddleTime += dt;

        // First 0.5s: happy bob/tilt in place.
        if (_toddleTime < 0.5f)
        {
            float bob = Mathf.Sin(_toddleTime * 18f) * (1f - _toddleTime / 0.5f);
            RotationDegrees = bob * 5f;
            Position = _homePos + new Godot.Vector2(0, -Mathf.Abs(bob) * 4f);
        }
        else
        {
            // Then toddle to the right with a gentle waddle.
            RotationDegrees = Mathf.Sin(_toddleTime * 12f) * 3f;
            float walkT = _toddleTime - 0.5f;
            float waddle = Mathf.Abs(Mathf.Sin(_toddleTime * 12f)) * 3f;
            Position = _homePos + new Godot.Vector2(walkT * 55f, -waddle);
        }
    }
}
