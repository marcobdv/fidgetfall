---
name: godot-input-map
description: Define and use Godot 4 input actions — input map in project.godot and reading them in C#. Use when adding controls, remapping, or wiring player input.
---

# Input actions in Godot 4

Define named **actions** (e.g. `move_left`, `jump`) decoupled from physical keys,
then read them in C#. This enables remapping and multi-device support.

## 1. Declare actions in `project.godot`

```ini
[input]

move_left={
"deadzone": 0.5,
"events": [Object(InputEventKey,"physical_keycode":4194319,"unicode":0)
, Object(InputEventJoypadMotion,"axis":0,"axis_value":-1.0)
]
}
jump={
"deadzone": 0.5,
"events": [Object(InputEventKey,"physical_keycode":32)
, Object(InputEventJoypadButton,"button_index":0)
]
}
```

> Hand-writing `physical_keycode` integers is error-prone. Prefer to declare the
> action names in `project.godot` (even with empty `events`) and bind keys in the
> editor's **Project Settings → Input Map**, or add events at runtime (below).
> Common codes: Space = 32, Enter = 4194309, arrows = 4194319–4194322.

## 2. Read actions in C#

```csharp
// Discrete:
if (Input.IsActionJustPressed("jump")) Jump();
if (Input.IsActionPressed("fire"))     Fire();
if (Input.IsActionJustReleased("jump")) CutJump();

// Analog axis / vector (great for movement):
float x = Input.GetAxis("move_left", "move_right");          // -1..1
Vector2 dir = Input.GetVector("move_left", "move_right",
                              "move_up", "move_down");        // normalized
```

## 3. Add or remap bindings at runtime (for accessibility/settings)

```csharp
InputMap.ActionEraseEvents("jump");
var ev = new InputEventKey { PhysicalKeycode = Key.Z };
InputMap.ActionAddEvent("jump", ev);
```

## Conventions
- Name actions by **intent** (`interact`, `pause`) not key (`e_key`).
- Always provide keyboard **and** gamepad events for core actions.
- Expose remapping in the settings UI (owned by the UX/UI Designer) and persist it.
- Use `GetVector`/`GetAxis` for movement so deadzones and analog input "just work".
