---
name: godot-shaders
description: Write Godot 4 shaders (.gdshader) and wire ShaderMaterials from C# — canvas_item (2D) and spatial (3D), uniforms, common effects (hit-flash, dissolve, outline). Use for VFX, materials, and the art↔engine visual bridge.
---

# Godot 4 shaders (`.gdshader`)

Godot uses its own GLSL-like shading language. Shaders attach to a `ShaderMaterial`
on a node's `material` slot. The technical-artist owns these; gameplay drives their
uniforms from C#.

## A canvas_item (2D) shader — hit flash

```glsl
shader_type canvas_item;

// `source_color` is the Godot 4 hint (was `hint_color` in 3.x).
uniform vec4 flash_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float flash_amount : hint_range(0.0, 1.0) = 0.0;

void fragment() {
    vec4 tex = texture(TEXTURE, UV);
    COLOR = mix(tex, vec4(flash_color.rgb, tex.a), flash_amount * tex.a);
}
```

Verified importing on Godot 4.7. A worked copy lives at
`games/sample-clockwork/assets/shaders/hit_flash.gdshader`.

## Drive uniforms from C#

```csharp
// On a Sprite2D/CanvasItem whose material is a ShaderMaterial:
var mat = (ShaderMaterial)Sprite.Material;
mat.SetShaderParameter("flash_amount", 1.0f);     // flash on hit
// tween it back to 0 over ~0.1s for a blink (Animator/Tech Artist territory)
```

Wire the material in a `.tscn` (see `godot-scene-authoring`):
```ini
[sub_resource type="ShaderMaterial" id="ShaderMaterial_1"]
shader = ExtResource("1_shader")
shader_parameter/flash_amount = 0.0
```

## Key language notes (Godot 4)
- `shader_type canvas_item;` (2D) or `shader_type spatial;` (3D); pick one, first line.
- Entry points: `vertex()`, `fragment()`, `light()`. Builtins differ per type
  (`TEXTURE`, `UV`, `COLOR`, `SCREEN_UV` for canvas_item; `ALBEDO`, `NORMAL`,
  `EMISSION`, `ROUGHNESS` for spatial).
- Uniforms: `uniform float x : hint_range(0,1) = 0.5;`, `uniform sampler2D tex;`,
  colors need `: source_color`.
- `TIME` is a builtin for animation; avoid per-pixel branches on hot paths.

## Common effects to reach for
- **Hit flash / tint** (above), **dissolve** (noise threshold on `discard`/alpha),
  **outline** (sample neighbors in `SCREEN_UV`), **scroll/wave** (offset `UV` by
  `TIME`), **palette swap** (index into a gradient).

## Conventions
- `.gdshader` under `games/<slug>/assets/shaders/`; reusable `ShaderMaterial` `.tres`
  next to them. Keep uniforms named and ranged so designers can tune in the inspector.
- Mind the frame budget (tech-art owns this); document non-obvious shaders in
  `docs/art/tech-art.md`.
