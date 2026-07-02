# Asset status — sample-clockwork

Tracks what's final vs placeholder vs to-be-sourced (ADR-0007). Placeholders are
prefixed `placeholder_`; "Tier 1 final" means the procedural asset *is* the final
asset for this art direction (flat vector).

| Asset | Tier | Status | Used by |
|---|---|---|---|
| `assets/sprites/clockwork_critter.svg` | 1 (final) | ✅ in use | `scenes/Player.tscn` Sprite2D |
| `assets/sprites/placeholder_player.svg` | placeholder | retired | kept as an example of placeholder style |
| `assets/audio/sfx/jump.wav` | 1 (final, `synth-sfx.mjs`) | ✅ wired | Player JumpSfx (plays on jump) |
| `assets/audio/sfx/hurt.wav` | 1 (final, `synth-sfx.mjs`) | ✅ wired | Player HurtSfx (plays on damage) |
| `assets/audio/sfx/coin.wav` | 1 (final, `synth-sfx.mjs`) | ⏳ unwired | reserved for a pickup demo |
| `assets/shaders/hit_flash.gdshader` | 1 (final) | ✅ wired | Player Sprite2D material (flashes on damage) |

## Shopping list (needs sourcing / Tier 2 / human)

*(empty — the template is intentionally self-sufficient at Tier 1.)*
