---
name: procedural-asset-generation
description: TIER 1 — generate real art & audio assets from code/text alone (SVG vector art, code-rendered raster, in-engine procedural textures, synthesized SFX, chiptune music). No external tools. Use to produce placeholders OR final assets for flat/geometric/pixel/chiptune art directions.
---

# Tier 1 — procedural asset generation (in-harness, no external tools)

The studio can generate **real, importable art and audio with nothing but code and
text**. For the right art direction these are *final*, not just placeholders.

| Art direction | Can Tier 1 deliver final assets? |
|---|---|
| Flat vector / geometric / minimalist | ✅ yes (SVG) |
| Pixel art / low-res | ✅ mostly (code-rendered PNG / `_Draw`) |
| Chiptune / retro SFX & music | ✅ yes (synthesized WAV/OGG) |
| Painterly / photoreal / 3D / orchestral / voice | ❌ → use Tier 2 (`external-asset-generation`) or a human |

> Decide the art direction *first* (Creative Director + Concept Artist). If it's a
> Tier-1-friendly style, the studio is self-sufficient for art & audio.

## Art

### Vector art — author SVG directly (Godot 4 imports `.svg` natively)
Write the SVG as text; set the import `scale` in Godot for target pixel size.
Good for sprites, icons, UI, tilesets. See `assets/sprites/clockwork_critter.svg`
in the sample for a worked example (body, wind-up key, gear, eyes — not a box).

### Raster / pixel art — render with code
Generate PNGs programmatically (Node `pngjs`/`sharp`, Python `Pillow`, C#
`SkiaSharp`/`System.Drawing`): flat palettes, readable silhouettes, tilesets,
sprite sheets. Commit the generator script so it's reproducible.

### In-engine procedural (no file at all)
`GradientTexture2D`, `NoiseTexture2D` (FastNoiseLite), `_Draw()` overrides,
`Polygon2D`, and shaders (see `technical-artist` + the scene/resource skills).

## Audio

### SFX — use the committed synthesizer
`scripts/synth-sfx.mjs` generates real WAVs (square/sine/saw/noise + glide +
decay envelope) with game-ready presets:

```bash
node .pi/skills/procedural-asset-generation/scripts/synth-sfx.mjs \
     games/<slug>/assets/audio/sfx/jump.wav --type jump
# presets: jump | pickup | blip | hit | explosion
# override --wave/--f0/--f1/--dur/--vol/--decay (decay = envelope exponent; higher = snappier)
```

### Music — algorithmic / chiptune
Sequence notes to a WAV/OGG via code (extend the synth approach: arpeggios, a bass
+ lead + drum layer for adaptive stems). Drive layering/transitions from game state
with the `MusicManager` autoload (see `composer` role). Loop-friendly by design.

## Hygiene (always)
- Commit the **generator script**, not just its output — assets must be reproducible.
- Mark stand-ins `placeholder_`; mark Tier-1-final assets plainly. Track both in
  `games/<slug>/docs/art/asset-status.md` and `docs/audio/*.md`.
- Anything Tier 1 can't do becomes a line item in the **shopping list** for
  `external-asset-generation` (Tier 2) or a human.
