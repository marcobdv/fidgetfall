namespace SampleClockwork.Core;

/// <summary>
/// Pure, scene-tree-free movement logic: acceleration/friction, gravity, coyote
/// time, jump buffering, and jump cut. The <c>Player</c> node feeds it input and
/// applies the returned velocity — see docs/conventions.md and ADR-0004 for why
/// the interesting logic lives outside the node (it's unit-testable here).
/// </summary>
public sealed class PlayerMotor
{
    // Tunables — synced from the node's [Export] fields every tick so they stay
    // live-editable in the inspector.
    public float Speed = 220f;
    public float Acceleration = 1800f;
    public float Friction = 2000f;
    public float JumpVelocity = -420f;
    public float Gravity = 1200f;
    public float CoyoteTime = 0.1f;
    public float JumpBuffer = 0.1f;
    public float JumpCutMultiplier = 0.5f;   // upward velocity kept on early jump release

    private float _coyote;
    private float _buffer;

    /// <summary>True when the last <see cref="Tick"/> started a jump (SFX/VFX hook).</summary>
    public bool JumpedThisTick { get; private set; }

    /// <summary>
    /// Advance one physics tick. Inputs are engine-agnostic: the horizontal axis in
    /// [-1, 1], edge-triggered jump pressed/released, and whether the body is on the
    /// floor. Returns the new velocity as plain floats.
    /// </summary>
    public (float X, float Y) Tick(
        float dt, float vx, float vy,
        float axis, bool jumpPressed, bool jumpReleased, bool onFloor)
    {
        JumpedThisTick = false;

        vx = axis != 0f
            ? MoveToward(vx, axis * Speed, Acceleration * dt)
            : MoveToward(vx, 0f, Friction * dt);

        if (!onFloor) vy += Gravity * dt;

        _coyote = onFloor ? CoyoteTime : System.Math.Max(0f, _coyote - dt);
        _buffer = jumpPressed ? JumpBuffer : System.Math.Max(0f, _buffer - dt);

        if (_buffer > 0f && _coyote > 0f)
        {
            vy = JumpVelocity;
            _buffer = 0f;
            _coyote = 0f;
            JumpedThisTick = true;
        }
        if (jumpReleased && vy < 0f) vy *= JumpCutMultiplier;

        return (vx, vy);
    }

    // Engine-free equivalent of Godot's Mathf.MoveToward.
    internal static float MoveToward(float from, float to, float delta) =>
        System.Math.Abs(to - from) <= delta ? to : from + System.Math.Sign(to - from) * delta;
}
