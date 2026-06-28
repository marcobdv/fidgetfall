---
name: godot-2d-platformer-kit
description: Common Godot 4 C# 2D gameplay patterns — CharacterBody2D movement, jump with coyote/buffer, tilemaps, areas/hitboxes, camera. Use when building 2D player controllers or core-loop prototypes.
---

# 2D gameplay kit (Godot 4, C#)

Battle-tested patterns for a 2D core loop. Tune values via `[Export]`.

## CharacterBody2D movement (run + jump with game feel)

```csharp
using Godot;

namespace Slug.Player;

public partial class Player : CharacterBody2D
{
    [Export] public float Speed = 220f;
    [Export] public float Acceleration = 1800f;
    [Export] public float Friction = 2000f;
    [Export] public float JumpVelocity = -420f;
    [Export] public float Gravity = 1200f;
    [Export] public float CoyoteTime = 0.1f;     // grace after leaving ground
    [Export] public float JumpBuffer = 0.1f;     // grace before landing

    private float _coyote;
    private float _buffer;

    public override void _PhysicsProcess(double delta)
    {
        float dt = (float)delta;
        Vector2 v = Velocity;

        // Horizontal: accelerate toward input, else apply friction.
        float input = Input.GetAxis("move_left", "move_right");
        if (input != 0)
            v.X = Mathf.MoveToward(v.X, input * Speed, Acceleration * dt);
        else
            v.X = Mathf.MoveToward(v.X, 0, Friction * dt);

        // Gravity.
        if (!IsOnFloor()) v.Y += Gravity * dt;

        // Coyote + buffered jump.
        _coyote = IsOnFloor() ? CoyoteTime : Mathf.Max(0, _coyote - dt);
        if (Input.IsActionJustPressed("jump")) _buffer = JumpBuffer;
        else _buffer = Mathf.Max(0, _buffer - dt);

        if (_buffer > 0 && _coyote > 0)
        {
            v.Y = JumpVelocity;
            _buffer = 0; _coyote = 0;
        }
        // Variable jump height: cut upward velocity on early release.
        if (Input.IsActionJustReleased("jump") && v.Y < 0)
            v.Y *= 0.5f;

        Velocity = v;
        MoveAndSlide();
    }
}
```

## Hitboxes / hurtboxes with Area2D

```csharp
public partial class Hitbox : Area2D
{
    [Export] public int Damage = 1;
}

public partial class Hurtbox : Area2D
{
    [Signal] public delegate void HitEventHandler(int damage);

    public override void _Ready() => AreaEntered += OnAreaEntered;

    private void OnAreaEntered(Area2D area)
    {
        if (area is Hitbox hb) EmitSignal(SignalName.Hit, hb.Damage);
    }
}
```

- Put attacker on a `Hitbox : Area2D` with a `Damage` export; victim on a
  `Hurtbox`. Use collision **layers/masks** so they only see each other.

## TileMaps & collision
- Use `TileMapLayer` (Godot 4.3+). Paint collision polygons in the TileSet so the
  world is solid for `CharacterBody2D`.

## Camera
- Add a `Camera2D` as a child of the player; enable position smoothing for feel.
  For rooms, set `LimitLeft/Right/Top/Bottom` or use a follow script with bounds.

## Feel checklist (coordinate with Animator/Designer)
- Coyote time + jump buffer (above), variable jump height.
- Acceleration/friction (not instant velocity).
- Squash/stretch & landing dust (Animator + Tech Artist), screenshake, hitstop.
