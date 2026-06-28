using Godot;
using SampleClockwork.Core;

namespace SampleClockwork.Player;

/// <summary>
/// Minimal 2D character controller demonstrating the studio's gameplay patterns:
/// exported tunables, coyote time + jump buffering, and thin-node-over-pure-logic
/// (delegates health to <see cref="Core.Health"/>). See the godot-2d-platformer-kit skill.
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

    private Health? _health;
    private float _coyote;
    private float _buffer;

    public override void _Ready() => EnsureHealth();

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
        float dt = (float)delta;
        Vector2 v = Velocity;

        float input = Input.GetAxis("move_left", "move_right");
        v.X = input != 0
            ? Mathf.MoveToward(v.X, input * Speed, Acceleration * dt)
            : Mathf.MoveToward(v.X, 0f, Friction * dt);

        bool onFloor = IsOnFloor();
        if (!onFloor) v.Y += Gravity * dt;

        _coyote = onFloor ? CoyoteTime : Mathf.Max(0f, _coyote - dt);
        _buffer = Input.IsActionJustPressed("jump") ? JumpBuffer : Mathf.Max(0f, _buffer - dt);

        if (_buffer > 0f && _coyote > 0f)
        {
            v.Y = JumpVelocity;
            _buffer = 0f;
            _coyote = 0f;
        }
        if (Input.IsActionJustReleased("jump") && v.Y < 0f) v.Y *= JumpCutMultiplier;

        Velocity = v;
        MoveAndSlide();
    }

    /// <summary>Damage the player; emits <see cref="Died"/> when health reaches zero.</summary>
    public void TakeDamage(int amount)
    {
        var health = EnsureHealth();
        health.TakeDamage(amount);
        if (health.IsDead) EmitSignal(SignalName.Died);
    }
}
