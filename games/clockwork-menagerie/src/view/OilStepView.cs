using Godot;
using System.Numerics;
using ClockworkMenagerie.Core;

namespace ClockworkMenagerie.View;

/// <summary>
/// Node-layer view for the Oil step. Shows an oil-fill sheen over the joint that rises with
/// progress, plays a soft looping drip while pouring on-target (faded out the instant pouring
/// pauses — Oil never punishes), and gives a little relieved wiggle on completion. Pure rules
/// live in <see cref="OilStep"/>.
///
/// <para>This node sits at the joint center (its global position is the joint). Children:
/// <c>SheenSprite</c> (the fill overlay, scaled by progress) and <c>CanSprite</c> (the oil can
/// shown near the cursor while pouring).</para>
/// </summary>
public partial class OilStepView : Node2D, IStepView
{
    [Export] public NodePath SheenSpritePath { get; set; } = "SheenSprite";
    [Export] public NodePath CanSpritePath { get; set; } = "CanSprite";
    [Export] public float DripInterval { get; set; } = 0.16f;

    private Sprite2D _sheen = null!;
    private Sprite2D _can = null!;
    private OilStep _step = null!;
    private SoundManager? _sound;

    private float _dripTimer;
    private float _wiggleTime = -1f;
    private float _pulse;
    private RepairStepState _prevState = RepairStepState.Locked;

    public override void _Ready()
    {
        _sheen = GetNode<Sprite2D>(SheenSpritePath);
        _can = GetNode<Sprite2D>(CanSpritePath);
        _can.Visible = false;
    }

    public void Bind(RepairStep step, SoundManager? sound)
    {
        _step = (OilStep)step;
        _sound = sound;
        _step.JointPosition = ToSysVec(GlobalPosition);
    }

    public RepairStep Step => _step;

    public bool ContainsCursor(Godot.Vector2 globalCursor)
        => GlobalPosition.DistanceTo(globalCursor) <= _step.OilHotspotRadius;

    public void OnPress(Godot.Vector2 globalCursor) => _step.Press();
    public void OnRelease() => _step.Release();
    public void OnCancel() => _step.Release();

    public void OnCursor(Godot.Vector2 globalCursor)
    {
        _step.UpdateCursor(ToSysVec(globalCursor));
        // Show the oil can at the cursor while this step is the active one.
        if (_step.State == RepairStepState.Idle || _step.State == RepairStepState.Active)
        {
            _can.Visible = true;
            _can.GlobalPosition = globalCursor + new Godot.Vector2(14, -14);
        }
    }

    public override void _Process(double delta)
    {
        float dt = (float)delta;
        _pulse += dt;

        // Completion wiggle on Active → Completing.
        if (_prevState == RepairStepState.Active && _step.State == RepairStepState.Completing)
            _wiggleTime = 0f;
        _prevState = _step.State;

        bool pouring = _step.State == RepairStepState.Active && _step.IsOnTarget && _step.Progress < 1f;

        // Drip SFX while pouring; silence the moment it pauses.
        if (pouring)
        {
            _dripTimer += dt;
            if (_dripTimer >= DripInterval)
            {
                _dripTimer = 0f;
                float pitch = 0.9f + 0.3f * _step.Progress;
                _sound?.PlayJittered("oil_drip", pitch, 0.08f, -2f);
            }
        }
        else
        {
            _dripTimer = DripInterval; // ready to drip immediately on resume
        }

        // Oil sheen rises with progress (alpha + a little vertical fill via scale).
        float p = _step.Progress;
        _sheen.Modulate = new Color(0.45f, 0.35f, 0.15f, 0.15f + 0.65f * p);
        _sheen.Scale = new Godot.Vector2(1f, 0.4f + 0.6f * p);

        // Relieved leg wiggle on completion.
        if (_wiggleTime >= 0f)
        {
            _wiggleTime += dt;
            float w = Mathf.Sin(_wiggleTime * 22f) * Mathf.Max(0f, 1f - _wiggleTime / 0.5f);
            RotationDegrees = w * 6f;
            if (_wiggleTime > 0.5f) { _wiggleTime = -1f; RotationDegrees = 0f; }
        }

        // Visibility of the can outside active use.
        if (_step.State == RepairStepState.Locked || _step.State == RepairStepState.Done)
            _can.Visible = false;

        // Joint hotspot pulse while idle/active for affordance.
        switch (_step.State)
        {
            case RepairStepState.Locked:
                _sheen.Visible = false;
                break;
            default:
                _sheen.Visible = true;
                break;
        }
    }

    private static System.Numerics.Vector2 ToSysVec(Godot.Vector2 v) => new(v.X, v.Y);
}
