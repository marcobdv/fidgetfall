using Godot;
using System.Numerics;
using ClockworkMenagerie.Core;

namespace ClockworkMenagerie.View;

/// <summary>
/// Node-layer view for the Re-seat step. Shows the faint socket ghost (brightens within magnet
/// range), and a grabbable gear that follows the cursor while held and tweens back to rest on a
/// miss. Pure rules live in <see cref="ReseatStep"/>.
///
/// <para>Scene layout: <c>SocketSprite</c> at the socket bay, <c>GearSprite</c> at the gear's
/// rest position. This node sits at the body; the children's local positions define socket/rest
/// in global space.</para>
/// </summary>
public partial class ReseatStepView : Node2D, IStepView
{
    [Export] public NodePath SocketSpritePath { get; set; } = "SocketSprite";
    [Export] public NodePath GearSpritePath { get; set; } = "GearSprite";

    private Sprite2D _socket = null!;
    private Sprite2D _gear = null!;
    private ReseatStep _step = null!;
    private SoundManager? _sound;

    private Godot.Vector2 _restGlobal;
    private Godot.Vector2 _socketGlobal;
    private Godot.Vector2 _returnFrom;
    private float _returnTimer;
    private bool _returning;
    private bool _wasGrabbed;
    private bool _wasWithinHint;
    private float _pulse;
    private RepairStepState _prevState = RepairStepState.Locked;

    private static readonly Color SocketDim = new(1, 1, 1, 0.45f);
    private static readonly Color SocketBright = new(1f, 0.95f, 0.7f, 1f);

    public override void _Ready()
    {
        _socket = GetNode<Sprite2D>(SocketSpritePath);
        _gear = GetNode<Sprite2D>(GearSpritePath);
        _restGlobal = _gear.GlobalPosition;
        _socketGlobal = _socket.GlobalPosition;
    }

    public void Bind(RepairStep step, SoundManager? sound)
    {
        _step = (ReseatStep)step;
        _sound = sound;
        _step.RestPosition = ToSysVec(_restGlobal);
        _step.SocketPosition = ToSysVec(_socketGlobal);
    }

    public RepairStep Step => _step;

    /// <summary>Hotspot test: cursor within grab distance of the gear's current/rest position.</summary>
    public bool ContainsCursor(Godot.Vector2 globalCursor)
    {
        Godot.Vector2 gearPos = _step.IsGrabbed ? ToGodotVec(_step.GearPosition) : _restGlobal;
        return gearPos.DistanceTo(globalCursor) <= _step.GrabFromDistance;
    }

    public void OnPress(Godot.Vector2 globalCursor)
    {
        if (_step.TryGrab(ToSysVec(globalCursor)))
        {
            _returning = false;
            _sound?.Play("gear_pickup");
        }
    }

    public void OnRelease() => _step.Release();
    public void OnCancel() => _step.Cancel();

    public void OnCursor(Godot.Vector2 globalCursor)
    {
        _step.UpdateCursor(ToSysVec(globalCursor));
    }

    public override void _Process(double delta)
    {
        float dt = (float)delta;
        _pulse += dt;

        // Seat chime on Active → Completing (the gear snaps home).
        if (_prevState == RepairStepState.Active && _step.State == RepairStepState.Completing)
            _sound?.Play("gear_seat");
        _prevState = _step.State;

        bool grabbed = _step.IsGrabbed;

        // Detect a miss this frame (was grabbed, now not, and not seated) to start the return tween.
        if (_wasGrabbed && !grabbed && _step.State != RepairStepState.Completing && _step.State != RepairStepState.Done)
        {
            _returning = true;
            _returnTimer = 0f;
            _returnFrom = _gear.GlobalPosition;
        }
        _wasGrabbed = grabbed;

        // Magnet-hint edge: play the seat-ready cue once when entering range (reuse pickup soft).
        bool withinHint = _step.IsWithinMagnetHint;
        if (withinHint && !_wasWithinHint) _sound?.Play("gear_pickup", 1.3f, -6f);
        _wasWithinHint = withinHint;

        // Position the gear.
        if (grabbed)
        {
            // Follow the cursor target, lagged by GearFollowLerp for weight.
            Godot.Vector2 target = ToGodotVec(_step.GearPosition);
            _gear.GlobalPosition = _gear.GlobalPosition.Lerp(target, Mathf.Clamp(_step.GearFollowLerp, 0.05f, 1f));
        }
        else if (_returning)
        {
            _returnTimer += dt;
            float t = _step.GearReturnTime > 0f ? Mathf.Clamp(_returnTimer / _step.GearReturnTime, 0f, 1f) : 1f;
            _gear.GlobalPosition = _returnFrom.Lerp(_restGlobal, Mathf.SmoothStep(0f, 1f, t));
            if (t >= 1f) _returning = false;
        }
        else if (_step.State == RepairStepState.Completing || _step.State == RepairStepState.Done)
        {
            // Seated: rest exactly on the socket.
            _gear.GlobalPosition = _socketGlobal;
        }

        // Socket ghost: brighten within magnet hint range.
        if (_step.State == RepairStepState.Done || _step.State == RepairStepState.Completing)
        {
            _socket.Modulate = new Color(1, 1, 1, 0f); // hidden once filled
        }
        else if (withinHint)
        {
            _socket.Modulate = SocketBright;
        }
        else if (_step.State == RepairStepState.Idle || _step.State == RepairStepState.Active)
        {
            float a = 0.45f + 0.25f * Mathf.Sin(_pulse * Mathf.Tau / Mathf.Max(0.1f, _step.HighlightPulsePeriod));
            _socket.Modulate = new Color(1, 1, 1, a);
        }
        else
        {
            _socket.Modulate = SocketDim;
        }

        // Gear brightness: dim while locked, full while available/grabbed.
        _gear.Modulate = _step.State == RepairStepState.Locked
            ? new Color(1, 1, 1, 0.5f)
            : Colors.White;
    }

    private static System.Numerics.Vector2 ToSysVec(Godot.Vector2 v) => new(v.X, v.Y);
    private static Godot.Vector2 ToGodotVec(System.Numerics.Vector2 v) => new(v.X, v.Y);
}
