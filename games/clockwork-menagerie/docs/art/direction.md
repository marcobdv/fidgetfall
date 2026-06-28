# Clockwork Menagerie — Art Direction

> Tier-1 FINAL art direction (per `docs/vision.md`). Flat vector / minimalist
> geometric, warm lamplit cozy. Every visual role and the Gameplay Programmer
> should hold to the palette and rules below so the slice stays cohesive by
> construction. Assets are authored by hand as clean SVG (Godot 4.7 imports `.svg`
> natively).

## 1. Mood in one line
A kindly tinkerer at a warm pool of lamplight on a rainy evening: brass clockwork,
soft glow, dark quiet surround. Storybook-whimsical, unhurried, zero-stakes.

## 2. Palette (the only colors — 7 hex)

Use these and only these. Pick from the role column; do not introduce new hues.
Opacity may be varied for shadow/glow, but keep the base hue from this list.

| Hex | Name | Role |
|---|---|---|
| `#2a2438` | Deep dusk | Dark surround / background, deepest shadow, eye/bore holes |
| `#3d3450` | Muted plum | Recessed surfaces, back wall, legs, lamp cord |
| `#5a3a16` | Walnut | Outlines / strokes on metal, bench wood, seams |
| `#c98a3a` | Warm brass | Primary critter body & metal parts (key, gear, spout) |
| `#e9c27a` | Pale gold | Highlights, belly/faceplate, lamplight warmth, glints |
| `#7c5a8c` | Soft violet | Cool accent: sockets, joints, foot caps, props, cuff |
| `#e8836b` | Terracotta glow | Warm accent: oil drop, sparks, come-alive payoff warmth |
| `#f4ead8` | Warm cream | Lightest highlights, lamp glow core, eye glints, sparkle |

Notes:
- `#5a3a16` (Walnut) is the universal stroke color for "metal/wood" line art.
- `#7c5a8c` (violet) is the single cool note that keeps the warm scheme from going
  monotone — reserve it for accents (sockets, joints, caps), never large fills.
- `#e8836b` (terracotta) is the "magic/aliveness" color: oil, sparks, the payoff.
  Sparing use makes the come-alive beat read as special.

## 3. Style rules
- **Flat fills only.** No gradients except the single soft lamplight radial in
  `bench_bg.svg` (the one intentional exception — it sells "pool of light").
- **Few nodes per asset.** Readable silhouette first; detail second. Sprites are a
  handful of shapes (circles, rounded rects, ellipses, simple paths).
- **Consistent outline language.** Metal/wood shapes get a `#5a3a16` stroke,
  ~1–2.5px at native size. Glows/ghosts/highlights are stroke-less or low-opacity.
- **Rounded, friendly geometry.** Prefer `rx`/ellipses over sharp corners; the
  critter and tools should feel soft and pettable, not industrial.
- **Affordance via modulate, not baked states.** The actionable part highlights by
  the engine tinting/pulsing toward `#e9c27a`; the gear socket ghost brightens by
  raising its alpha. Author the *resting* look; let code drive state.
- **Self-illuminated reads.** Contrast comes from value (dark surround vs. lit
  brass), so assets stay legible against the dark bench.

## 4. Sizing & import (for the Game Artist / Programmer)
- SVGs are authored at their logical pixel size (viewBox = width/height). Set the
  Godot import `scale` per sprite if a larger on-screen size is wanted; the vector
  stays crisp.
- Canonical sizes: body 96×96, gear & socket 40×40, key & oil can 48×48,
  cursor 32×32, spark 24×24, bench background 640×360.
- Cursor hotspot is the index fingertip (~6,4 in its 32×32 space).

## 5. Animation guidance (for the Animator)
Personality is transform-based on these flat shapes — rotate the gear/key, bob &
squash the body, wiggle a leg, pulse highlight alpha. No drawn frames or rigs.
The spark sprite is meant to be instanced/tweened (scale-up + fade) on the payoff.
