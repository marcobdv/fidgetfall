---
name: asset-sourcing
description: TIER 1.5 — find and integrate existing FREE / open-licensed assets (art, audio, music, 3D models, fonts, icons) from reputable libraries, with strict license vetting and attribution tracking. Use to get higher-fidelity ready-made assets without generating them.
---

# Tier 1.5 — sourcing free / open-licensed assets

Between "make it ourselves" (Tier 1) and "drive an AI generator" (Tier 2) sits
**sourcing**: thousands of high-quality, legally-usable assets already exist. The
hard part isn't finding them — it's **using only what we're licensed to** and
**tracking attribution**. This skill makes both safe.

## Decision order (where sourcing fits)
1. **Tier 1 procedural** — best *cohesion*, free, instant. Prefer for a unified look.
2. **Tier 1.5 sourcing (this skill)** — best *fidelity-for-effort* when a ready-made
   asset beats what we'd generate (e.g. a polished SFX pack, a music track, a 3D kit).
3. **Tier 2 generation** — when nothing suitable exists and a generator is connected.
4. **Human** — bespoke needs.

## Reputable sources (favor CC0)

**2D art / sprites / tilesets / UI / icons**
- **Kenney.nl** — CC0, game-ready 2D+3D+UI+audio+fonts. The default first stop.
- **OpenGameArt.org** — mixed (CC0 / CC-BY / CC-BY-SA / GPL) — *filter by license*.
- **itch.io** game-asset packs — many free/CC0 — check each pack's terms.
- **game-icons.net** — 4000+ icons, CC-BY 3.0.

**3D models / textures / HDRIs**
- **Kenney.nl**, **Quaternius.com** — CC0 low-poly kits.
- **Poly Pizza** (poly.pizza) — CC0 / CC-BY, ex-Google Poly.
- **Poly Haven** — CC0 HDRIs, PBR textures, models. **ambientCG** — CC0 PBR textures.
- **Sketchfab** — filter Downloadable + CC license.

**SFX**
- **Freesound.org** — CC0 / CC-BY (per-sound — verify each).
- **Sonniss GDC Game Audio bundles** — royalty-free, huge.
- **Kenney audio**, **OpenGameArt audio** — CC0.

**Music**
- **Incompetech** (Kevin MacLeod) — CC-BY 4.0.
- **Pixabay Music** — Pixabay license (free, no attribution).
- **Patrick de Arteaga**, **Free Music Archive**, **OpenGameArt** — mixed CC.

**Fonts** — **Google Fonts** (OFL/Apache, commercial-safe). OFL = embed/use freely,
don't sell the font itself.

## License literacy (read before downloading)
| License | Use it? | Obligation |
|---|---|---|
| **CC0 / Public Domain** | ✅ preferred | none (we still log provenance) |
| **CC-BY** | ✅ | **attribution required** in CREDITS |
| **CC-BY-SA** | ⚠️ ok, understand it | attribution **+ share-alike** on derivatives |
| **OFL** (fonts) | ✅ | embed/use; don't sell the font alone |
| **Pixabay / Unsplash / Mixkit** | ✅ | per their license (usually none; read) |
| **CC-BY-NC** (NonCommercial) | ❌ avoid | unsafe if the game is ever sold |
| **CC-BY-ND** (NoDerivatives) | ❌ avoid | can't modify the asset |
| **GPL / custom / "royalty-free"** | ⚠️ | read the actual terms first |

**Never assume.** Verify the license **on the asset's own page**, not the homepage.

## Workflow
1. **Search** using your web-search/fetch tool if you have one; otherwise query the
   sites above directly (e.g. `curl -sL https://kenney.nl/assets` and read the page,
   or hit a site's search URL). Match the Concept Artist's art direction; prefer CC0
   for cohesion + zero obligation.
2. **Verify license** on the asset page. Reject NC/ND for a commercial game.
3. **Download** to the right folder: `curl -L -o games/<slug>/assets/<kind>/<file> <url>`.
   Most packs (Kenney, OpenGameArt, Sonniss) ship as **zip archives** — download to a
   temp dir, extract (`unzip`/`tar -xf`/PowerShell `Expand-Archive`), copy only the
   files you need into `assets/`, and delete the rest (don't commit whole packs).
   Direct-file URLs work for Freesound/Poly Haven; **itch.io** downloads usually sit
   behind a JS purchase flow `curl` can't drive — pick a source with direct links
   instead, or ask the human to download.
4. **Record provenance — mandatory** (the tool refuses NC/ND and builds `CREDITS.md`):
   ```bash
   node .pi/skills/asset-sourcing/scripts/credit-asset.mjs games/<slug> \
     --asset assets/audio/sfx/door.wav --source Freesound \
     --url https://freesound.org/s/123456/ --license CC0 --author someuser
   ```
5. **Integrate** like any asset (scene/resource/import skills); update
   `docs/art/asset-status.md` / `docs/audio/*`.

## Rules
- **No sourced asset ships without a `CREDITS.md` entry.** Use the helper every time.
- Default to **CC0**; only take CC-BY/SA when worth the obligation; **never** NC/ND
  for a commercial title.
- A surface-license mismatch (e.g. an OpenGameArt page bundling GPL + CC-BY) → treat
  as the most restrictive until verified.
- Mixing sourced assets from many artists fragments the look — flag cohesion risk to
  the Concept Artist; prefer single-author CC0 packs (e.g. Kenney) for consistency.
