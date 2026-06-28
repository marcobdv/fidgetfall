---
name: external-asset-generation
description: TIER 2 — produce rich art & audio by driving external AI generators (image, music, SFX, voice) via API or MCP, then integrate the results into Godot. Use when the art direction needs painterly/photoreal/3D/orchestral/voice output beyond Tier 1.
---

# Tier 2 — external asset generation (driving AI generators)

When the art direction exceeds what code alone can make (painterly art, photoreal
textures, 3D, orchestral music, voiced dialogue), the studio **orchestrates an
external generator**: the agent writes the brief and does the integration; the
pixels/audio come from a tool **you must connect**.

> ⚠️ **Requires setup.** None of these are wired up by default. The studio cannot
> invent image/audio bytes itself — it can only call a generator you provide
> access to. Until one is connected, fall back to Tier 1
> (`procedural-asset-generation`) and keep a shopping list.

## How to connect a generator (pick one)
- **MCP server** — add an image/audio MCP to Pi (`.pi/settings.json` packages or
  the host's MCP config). The agent then calls its tools like any other tool.
- **HTTP API + key** — put the key in the environment (never commit it), and use a
  small committed script under `games/<slug>/tools/` to call the API and write the
  asset file. This mirrors the Tier-1 script pattern.
- Typical providers: image (SDXL/Stable Diffusion, Midjourney, DALL·E, Flux),
  music (Suno, Udio), SFX/voice (ElevenLabs). Honor each provider's license/usage
  terms for shipped assets.

## The brief (the agent's real deliverable)
Every generated asset starts from a brief the Concept Artist / Sound Designer /
Composer writes, precise enough to be reproducible:
- Subject, style anchors (palette hex, references, anti-references), dimensions/
  format, seed (if supported), and the exact **prompt**.
- Store prompts + seeds next to the asset so results are reproducible/regenerable:
  `games/<slug>/docs/art/prompts/<asset>.md`.

## Integration & provenance
- Post-process to spec: resize, crop, transparency, atlas, set Godot import flags.
- Record **provenance** for every Tier-2 asset in `asset-status.md`: tool, model,
  prompt/seed, license, date. This is non-negotiable for shipping.
- Wire into scenes/resources exactly like Tier-1 assets (scene/resource skills).

## Decision rule
1. Can **Tier 1** make it (flat/pixel/chiptune)? → do that, it's free and in-harness.
2. Else, is a generator **connected**? → write brief, generate, integrate, log provenance.
3. Else → produce a Tier-1 placeholder now + add to the shopping list for later.
