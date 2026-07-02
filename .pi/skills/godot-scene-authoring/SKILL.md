---
name: godot-scene-authoring
description: Author or edit Godot 4 .tscn scene files by hand — node tree, ext/sub resources, properties, script attachment. Use when creating/modifying scenes without the editor.
---

# Authoring Godot 4 scenes (`.tscn`) by hand

`.tscn` is a text format you can write directly. Godot regenerates UIDs and
re-imports on open, so hand-authoring is safe for scaffolding.

## File structure

```ini
[gd_scene load_steps=4 format=3 uid="uid://bxyz123"]

[ext_resource type="Script" path="res://src/player/Player.cs" id="1_player"]
[ext_resource type="Texture2D" path="res://assets/sprites/player.png" id="2_tex"]

[sub_resource type="RectangleShape2D" id="RectangleShape2D_1"]
size = Vector2(16, 32)

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1_player")
Speed = 220.0

[node name="Sprite2D" type="Sprite2D" parent="."]
texture = ExtResource("2_tex")

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]
shape = SubResource("RectangleShape2D_1")
```

`Speed = 220.0` sets the `[Export]` property on the attached script. Note that
`.tscn` has **no comment syntax** — never write `#` or `;` comments inside one.

## Rules
- **Header:** `load_steps` = count of ext+sub resources + 1; `format=3` for Godot 4.
- **`[ext_resource]`** references external files (scripts, textures, other scenes,
  resources). Each gets an `id` you reference via `ExtResource("id")`.
- **`[sub_resource]`** defines inline resources (shapes, materials, animations),
  referenced via `SubResource("id")`.
- **`[node]`** lines: `name`, `type`, and `parent` (`.` = root, `"Player"` = child
  of Player, `"Player/Sprite2D"` for nesting). Root node omits `parent`.
- Property lines under a node set values using Godot variant syntax:
  `Vector2(x, y)`, `Color(r,g,b,a)`, `true/false`, `&"StringName"`, arrays as
  `[...]`, `PackedStringArray("a","b")`.
- Attach a script with `script = ExtResource("...")`; set `[Export]` props by name.

## Instancing another scene as a child

```ini
[ext_resource type="PackedScene" path="res://scenes/Enemy.tscn" id="3_enemy"]

[node name="Enemy" parent="." instance=ExtResource("3_enemy")]
position = Vector2(400, 100)
```

## Tips
- Don't invent `uid://` values for ext_resources you don't control — use the real
  path; Godot resolves/repairs UIDs on import. For the scene's own header `uid`,
  any unique `uid://...` is fine (Godot may rewrite it).
- Godot 4.4+ logs a warning for `ext_resource` entries without `uid=` and adds
  them on the next editor save. That warning is expected for hand-authored
  scenes — don't chase it as an error; the resulting diff noise on first editor
  open is normal.
- After authoring, run `godot --headless --path . --quit` to import and catch errors.
- For complex visual work, scaffold the tree by hand, then let a human/editor refine.
