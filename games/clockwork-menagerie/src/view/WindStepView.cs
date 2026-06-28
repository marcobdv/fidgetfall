using Godot;
using System.Numerics;
using ClockworkMenagerie.Core;

namespace ClockworkMenagerie.View;

/// <summary>
/// Node-layer view for the Wind step. Renders the wind key over the mainspring stub, spins it
/// with accumulated winding, plays a soft tick every <c>WindTickDegrees</c> of travel, and
/// brightens while active. Pure rules live in <see cref="WindStep"/>; this is thin glue.
///
/// <para>The view's own <c>Position</c> (set in the scene) is the spring pivot. Child
/// <c>KeySprite</c> is the wind key that the player turns.</para>
/// </summary>
public partial class WindStepView : Node2D, IStepView
{
    [Export] public NodePath KeySpritePath { get; set; } = "KeySprite";

    private Sprite2D _key = null!;
    private WindStep _step = null!;
    private SoundManager? _sound;
    private float _lastTickDegrees;
    private float _pulse;

    private static readonly Color Locked = new(1, 1, 1, 0.35f);
    private static readonly Color Idle = new(1, 1, 1, 0.75f);
    private static readonly Color ActiveTint = new(1f, 0.96f, 0.8f, 1f);
    private static readonly Color DoneTint = new(0.8f, 0.85f, 0.8f, 0.6f);

    public override void _Ready()
    {
        _key = GetNode<Sprite2D>(KeySpritePath);
    }

    /// <summary>Wire the built core step and shared sound hub. Called by the controller after build.</summary>
    public void Bind(RepairStep step, SoundManager? sound)
    {
        _step = (WindStep)step;
        _sound = sound;
        // Pivot is this node's global position in cursor space.
        _step.Pivot = ToSysVec(GlobalPosition);
        _lastTickDegrees = 0f;
    }

    public RepairStep Step => _step;

    /// <summary>Hotspot test: cursor is "on the key" within the outer ring (excl. dead zone).</summary>
    public bool ContainsCursor(Godot.Vector2 globalCursor)
    {
        float d = GlobalPosition.DistanceTo(globalCursor);
        return d >= _step.WindRingInnerRadius && d <= _step.WindRingOuterRadius;
    }

    public void OnPress(Godot.Vector2 globalCursor) => _step.Press();
    public void OnRelease() => _step.Release();
    public void OnCancel() => _step.Release();

    public void OnCursor(Godot.Vector2 globalCursor)
    {
        _step.UpdateCursor(ToSysVec(globalCursor));
    }

    public override void _Process(double delta)
    {
        _pulse += (float)delta;

        // Spin the key with accumulated winding (degrees → radians; sign per direction).
        float sign = _step.WindDirectionClockwise ? 1f : -1f;
        _key.RotationDegrees = sign * _step.AccumulatedDegrees;

        // Tick SFX every WindTickDegrees of travel.
        if (_step.State == RepairStepState.Active && _step.WindTickDegrees > 0f)
        {
            while (_step.AccumulatedDegrees - _lastTickDegrees >= _step.WindTickDegrees)
            {
                _lastTickDegrees += _step.WindTickDegrees;
                // Pitch rises with progress for life (audio notes §5.1).
                float pitch = 1f + 0.4f * _step.Progress;
                _sound?.PlayJittered("wind_tick", pitch, 0.04f);
            }
        }

        // Reflect state via modulate.
        switch (_step.State)
        {
            case RepairStepState.Locked:
                Modulate = Locked;
                break;
            case RepairStepState.Idle:
                float pulse = 0.75f + 0.2f * Mathf.Sin(_pulse * Mathf.Tau / Mathf.Max(0.1f, _step.HighlightPulsePeriod));
                Modulate = new Color(1, 1, 1, pulse);
                break;
            case RepairStepState.Active:
                Modulate = ActiveTint;
                break;
            case RepairStepState.Completing:
            case RepairStepState.Done:
                Modulate = DoneTint;
                break;
        }
    }

    private static System.Numerics.Vector2 ToSysVec(Godot.Vector2 v) => new(v.X, v.Y);
}
