# Clockwork Menagerie — Asset Status

> Tracks every visual asset: placeholder vs Tier-1 FINAL. Per the vision, the flat
> vector / minimalist geometric direction is Tier-1 self-sufficient, so these SVGs
> are **final output**, not stand-ins. Authored by hand as clean SVG (Godot 4.7
> imports `.svg` natively). See `docs/art/direction.md` for palette + rules.

## Sprites (`assets/sprites/`)

| Asset | File | Purpose | Tier | Size (px) |
|---|---|---|---|---|
| Beetle body | `beetle_body.svg` | The clockwork critter; has an empty gear socket bay (top-left) and a visible leg joint spot (rear-right) plus a wind-up stub on top. | **Tier-1 FINAL** | 96×96 |
| Beetle gear | `beetle_gear.svg` | The single gear the player grabs and re-seats (8-tooth, brass). | **Tier-1 FINAL** | 40×40 |
| Gear socket | `beetle_gear_socket.svg` | Faint "ghost" target the gear snaps into; brightens via modulate when the gear is near. | **Tier-1 FINAL** | 40×40 |
| Wind-up key | `wind_key.svg` | Wind-up key for the mainspring step (also usable as the wind-mode cursor). | **Tier-1 FINAL** | 48×48 |
| Oil can | `oil_can.svg` | Oil can / dropper for the oil-the-joint step (terracotta drop at spout). | **Tier-1 FINAL** | 48×48 |
| Bench background | `bench_bg.svg` | Cozy lamplit workbench backdrop; dark surround, warm light pool, hanging lamp, minimal props. | **Tier-1 FINAL** | 640×360 |
| Tinkerer cursor | `cursor.svg` | Pointing-hand pointer; hotspot at fingertip (~6,4). | **Tier-1 FINAL** | 32×32 |
| Spark | `spark.svg` | Optional sparkle for the come-alive payoff; instance + tween (scale/fade). | **Tier-1 FINAL** | 24×24 |

## Coverage vs. the slice
The repair system (`docs/systems/repair.md`) names three step archetypes and their
visual needs; all are now covered:

- **Wind** → `wind_key.svg` + the wind-up stub on `beetle_body.svg`.
- **Re-seat** → `beetle_gear.svg` + `beetle_gear_socket.svg` + the socket bay on the body.
- **Oil** → `oil_can.svg` + the joint spot on `beetle_body.svg`.
- **Scene framing** → `bench_bg.svg`.
- **Pointer** → `cursor.svg`. **Payoff** → `spark.svg`.

## Placeholders / gaps
- **None blocking the slice.** All listed assets are Tier-1 final.

## Shopping list (Tier 2 / human — post-slice, optional)
- Nothing required for the slice. If richer ambience is ever wanted, the only likely
  upgrade is Tier-1.5 CC0 *audio*, not art (gameplay never blocks on it).

## Notes for the Gameplay Programmer
- No asset paths are hardcoded in `src/` yet (verified), so wiring is open.
- Suggested logical names match the files above: `beetle_body`, `beetle_gear`,
  `beetle_gear_socket`, `wind_key`, `oil_can`, `bench_bg`, `cursor`, `spark`.
- Naming caveats (so nothing surprises you):
  - The socket file is `beetle_gear_socket.svg` (prefixed `beetle_`), not `gear_socket.svg`.
  - The wind tool is `wind_key.svg` (underscore), not `windup_key` / `wind-key`.
  - The oiler is `oil_can.svg`, not `oiler.svg` / `dropper.svg`.
  - The cursor is a generic `cursor.svg`; per-mode cursors (e.g. wind/oil) can reuse
    `wind_key.svg` / `oil_can.svg` directly if you want context cursors.
- The beetle body bakes the *resting* look of its three repair sites. Drive
  highlight/pulse and the socket-ghost brighten via `modulate`/alpha in code per the
  affordance rule, rather than expecting separate state sprites.
