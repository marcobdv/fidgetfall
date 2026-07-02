using Godot;
using SampleClockwork.Core;

namespace SampleClockwork.Player;

/// <summary>
/// Thin node over pure logic (ADR-0004): movement lives in <see cref="PlayerMotor"/>,
/// health in <see cref="Core.Health"/> — both unit-tested without the scene tree.
/// This node only reads input, applies the motor's velocity, and plays feedback
/// (SFX, hit flash). See the godot-2d-platformer-kit skill.
/// </summary>
public partial class Player : CharacterBody2D
{
    [Export] public float Speed = 220f;
    [Export] public float Acceleration = 1800f;
    [Export] public float Friction = 2000f;
    [Export] public float JumpVelocity = -420f;
    [Export] public float Gravity = 1200f;
    [Export] public float CoyoteTime = 0.1f;
    [Export] public float JumpBuffer = 0.1f;
    [Export] public float JumpCutMultiplier = 0.5f;   // upward velocity kept on early jump release
    [Export] public int MaxHealth = 3;

    [Signal] public delegate void DiedEventHandler();

    private readonly PlayerMotor _motor = new();
    private Health? _health;
    private Vector2 _spawn;
    private AudioStreamPlayer? _jumpSfx;
    private AudioStreamPlayer? _hurtSfx;
    private ShaderMaterial? _flash;
    private Tween? _flashTween;

    public override void _Ready()
    {
        EnsureHealth();
        _spawn = GlobalPosition;
        _jumpSfx = GetNodeOrNull<AudioStreamPlayer>("JumpSfx");
        _hurtSfx = GetNodeOrNull<AudioStreamPlayer>("HurtSfx");
        _flash = GetNodeOrNull<Sprite2D>("Sprite2D")?.Material as ShaderMaterial;
    }

    /// <summary>
    /// Lazily create the health model, clamping the designer-set <see cref="MaxHealth"/> to a
    /// valid (&gt;= 1) value. This keeps a 0/negative export from throwing on scene load, and
    /// makes <see cref="TakeDamage"/> safe even if called before <c>_Ready</c> runs.
    /// </summary>
    private Health EnsureHealth()
    {
        if (_health is not null) return _health;
        int safe = SanitizeMaxHealth(MaxHealth);
        if (safe != MaxHealth)
        {
            GD.PushWarning($"{Name}: MaxHealth {MaxHealth} < 1; clamping to {safe}.");
            MaxHealth = safe;
        }
        return _health = new Health(MaxHealth);
    }

    /// <summary>Pure, engine-free clamp for a designer-set max health (must be &gt;= 1).
    /// Kept static so it is unit-testable without the scene tree.</summary>
    internal static int SanitizeMaxHealth(int value) => value < 1 ? 1 : value;

    public override void _PhysicsProcess(double delta)
    {
        SyncMotorTunables();
        (float x, float y) = _motor.Tick(
            (float)delta, Velocity.X, Velocity.Y,
            Input.GetAxis("move_left", "move_right"),
            Input.IsActionJustPressed("jump"),
            Input.IsActionJustReleased("jump"),
            IsOnFloor());
        Velocity = new Vector2(x, y);
        if (_motor.JumpedThisTick) _jumpSfx?.Play();
        MoveAndSlide();
    }

    // [Export] fields stay the inspector-facing source of truth; push them into the
    // pure motor each tick so live tuning works.
    private void SyncMotorTunables()
    {
        _motor.Speed = Speed;
        _motor.Acceleration = Acceleration;
        _motor.Friction = Friction;
        _motor.JumpVelocity = JumpVelocity;
        _motor.Gravity = Gravity;
        _motor.CoyoteTime = CoyoteTime;
        _motor.JumpBuffer = JumpBuffer;
        _motor.JumpCutMultiplier = JumpCutMultiplier;
    }

    /// <summary>Damage the player; emits <see cref="Died"/> exactly once, on the
    /// alive→dead transition (the edge lives in <see cref="Health.TakeDamage"/>).</summary>
    public void TakeDamage(int amount)
    {
        var health = EnsureHealth();
        int before = health.Current;
        bool died = health.TakeDamage(amount);
        if (health.Current < before)
        {
            _hurtSfx?.Play();
            Flash();
        }
        if (died) EmitSignal(SignalName.Died);
    }

    /// <summary>Back to the spawn point with full health. Main wires this to <see cref="Died"/>.</summary>
    public void Respawn()
    {
        EnsureHealth().SetCurrent(MaxHealth);
        GlobalPosition = _spawn;
        Velocity = Vector2.Zero;
    }

    private void Flash()
    {
        if (_flash is null) return;
        _flashTween?.Kill();
        _flash.SetShaderParameter("flash_amount", 1f);
        _flashTween = CreateTween();
        _flashTween.TweenProperty(_flash, "shader_parameter/flash_amount", 0f, 0.25f);
    }
}
