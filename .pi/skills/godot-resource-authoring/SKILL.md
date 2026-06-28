---
name: godot-resource-authoring
description: Create custom Godot 4 Resource types in C# and author .tres data files for tunable, data-driven design (stats, items, configs, themes). Use for data-driven content and designer tunables.
---

# Custom Resources & `.tres` data in Godot 4

`Resource` is Godot's serializable data container. Define types in C#, then author
`.tres` instances designers can edit — the backbone of data-driven design.

## 1. Define a Resource type in C#

```csharp
using Godot;

namespace Slug.Data;

[GlobalClass]                          // makes it creatable in the editor
public partial class EnemyStats : Resource
{
    [Export] public string DisplayName { get; set; } = "Enemy";
    [Export] public int MaxHealth { get; set; } = 10;
    [Export] public float MoveSpeed { get; set; } = 80f;
    [Export] public int Damage { get; set; } = 1;
    [Export] public PackedScene? DeathVfx { get; set; }
}
```

- `[GlobalClass]` registers it so it appears in the "New Resource" dialog and as an
  `[Export]` type.
- Use `[Export]` on every field that should be editable/serialized.

## 2. Author a `.tres` instance

```ini
[gd_resource type="Resource" script_class="EnemyStats" load_steps=2 format=3 uid="uid://abc123"]

[ext_resource type="Script" path="res://src/data/EnemyStats.cs" id="1_stats"]

[resource]
script = ExtResource("1_stats")
DisplayName = "Clockwork Beetle"
MaxHealth = 6
MoveSpeed = 60.0
Damage = 1
```

## 3. Consume it in code

```csharp
[Export] public EnemyStats Stats { get; set; } = null!;

public override void _Ready()
{
    _health = Stats.MaxHealth;
    _speed = Stats.MoveSpeed;
}

// Or load explicitly:
var stats = GD.Load<EnemyStats>("res://data/enemies/beetle.tres");
```

## Patterns
- **Tunables live in Resources**, not hardcoded — the Game Designer edits `.tres`,
  not C#.
- Group data files under `games/<slug>/data/<category>/*.tres`.
- Themes for UI are Resources too (`Theme`, `StyleBox`) — author/share a
  `theme.tres`.
- The Tools Programmer can generate `.tres` from CSV/JSON for bulk content.
- Keep Resource classes pure data; put behavior in nodes/systems that read them.
