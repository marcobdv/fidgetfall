---
name: godot-csharp-node-scripting
description: Write C# scripts for Godot 4 nodes — lifecycle, exports, signals, node access, autoloads. Use whenever implementing behavior in C# on a Godot node.
---

# C# node scripting in Godot 4

Godot 4 C# API conventions. Scripts extend a Godot node type and override
lifecycle methods.

## Anatomy of a node script

```csharp
using Godot;

namespace Slug.Player;            // mirror folder path

public partial class Player : CharacterBody2D   // MUST be `partial`
{
    // Exported, designer-tunable fields show in the Inspector.
    [Export] public float Speed { get; set; } = 200f;
    [Export] public PackedScene? BulletScene { get; set; }

    // Cache node references in _Ready, not every frame.
    private AnimatedSprite2D _sprite = null!;

    public override void _Ready()
    {
        _sprite = GetNode<AnimatedSprite2D>("AnimatedSprite2D");
    }

    public override void _Process(double delta) { }          // per frame
    public override void _PhysicsProcess(double delta) { }   // fixed step
    public override void _Input(InputEvent @event) { }       // input events
}
```

Key rules:
- The class **must be `partial`** (Godot's source generators need it).
- Class name should match the file name; attach via the scene or `[GlobalClass]`.
- Use `double delta` (Godot 4), not `float`.

## Signals

Declare with a delegate named `<Name>EventHandler`; emit via `SignalName`:

```csharp
[Signal] public delegate void HealthChangedEventHandler(int current, int max);

EmitSignal(SignalName.HealthChanged, current, max);

// Connect in C#:
health.HealthChanged += OnHealthChanged;          // typed C# event
// or via code to a Callable:
button.Pressed += () => GD.Print("clicked");
```

## Accessing nodes
- `GetNode<T>("Path/To/Node")` — relative path; throws if missing.
- `GetNodeOrNull<T>(...)` — null instead of throwing.
- Prefer `[Export]` node references or unique names (`%Name`) over deep paths.
- `GetTree()`, `GetParent()`, groups: `AddToGroup("enemies")` / `GetTree().GetNodesInGroup(...)`.

## Autoloads (singletons)
Register a scene/script as an autoload in `project.godot`:

```ini
[autoload]
GameState="*res://src/core/GameState.cs"   # leading * = enabled
```

Access from anywhere: `GetNode<GameState>("/root/GameState")`, or expose a static
`Instance` set in `_Ready`.

## Gotchas
- `GD.Print(...)` for logging; `QueueFree()` to delete nodes safely.
- Instantiate scenes: `BulletScene.Instantiate<Bullet>()` then `AddChild(...)`.
- Avoid allocations in `_Process`/`_PhysicsProcess`; cache and pool.
- Keep heavy game logic in plain C# classes (testable) and let nodes be thin glue.
