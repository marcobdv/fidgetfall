# ADR-0005: Three-tier asset strategy

- **Status:** Accepted
- **Date:** 2026-06-28

## Context
Agents can't paint textures or record audio by hand, yet games need art and sound.
We need a realistic, policy-driven way to produce assets that scales from "free and
in-harness" to "rich, externally generated."

## Decision
Adopt three tiers, all first-class skills:

- **Tier 1 — `procedural-asset-generation`:** real assets from code/text alone (SVG
  vector art, code-rendered raster, in-engine procedural, synthesized SFX, chiptune).
  *Final* for flat/geometric/pixel/chiptune directions.
- **Tier 1.5 — `asset-sourcing`:** integrate existing free/open-licensed assets
  (Kenney, OpenGameArt, Freesound, …) with strict license vetting + provenance.
- **Tier 2 — `external-asset-generation`:** drive an AI image/music/voice generator
  the user connects (MCP/API); the agent writes briefs and integrates output.

**Decision order:** Tier 1 for cohesion → Tier 1.5 when a ready-made asset beats
generating → Tier 2 if a generator is connected → human. The Creative Director +
Concept Artist pick the art direction *first*, which decides self-sufficiency.

## Consequences
- The studio is fully self-sufficient for art *and* audio in Tier-1-friendly styles —
  proven: clockwork-menagerie's 8 sprites + 6 SFX were 100% self-generated.
- License safety is enforceable: `credit-asset.mjs` refuses NonCommercial/NoDerivatives
  and logs `CREDITS.md` provenance (see ADR-0007 for the placeholder relationship).
- Tier 2 is dormant until the user connects a generator; the studio degrades cleanly
  to Tier 1/1.5 plus a shopping list.

## Alternatives considered
- **Placeholders-only + "get a human":** undersells what code can ship as *final*.
- **Assume an AI image generator is always available:** false for headless/no-key runs.
