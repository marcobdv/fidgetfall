shader_type canvas_item;

// Tints a sprite toward flash_color (used for hit feedback). Drive flash_amount
// from C# via (material as ShaderMaterial).SetShaderParameter("flash_amount", x).
uniform vec4 flash_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float flash_amount : hint_range(0.0, 1.0) = 0.0;

void fragment() {
    vec4 tex = texture(TEXTURE, UV);
    COLOR = mix(tex, vec4(flash_color.rgb, tex.a), flash_amount * tex.a);
}
