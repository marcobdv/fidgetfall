# ADR-0007: Placeholder-first, Tier-1-final policy

- **Status:** Accepted
- **Date:** 2026-06-28

## Context
Content production must never block gameplay iteration, but "placeholder" shouldn't
mean "ugly forever." We need a policy for when stand-ins are acceptable and when
generated assets are considered done.

## Decision
**Placeholder-first:** ship grey-box / programmer-art / procedural stand-ins so the
core loop is always playable; never block gameplay on final assets. **Tier-1-final:**
for the right art direction, Tier-1 procedural output (ADR-0005) *is* the final asset,
not a placeholder. Stand-ins are prefixed `placeholder_` and tracked in
`docs/art/asset-status.md`; anything still needing a human/Tier-2 asset goes on a
shopping list.

## Consequences
- Vertical slices stay runnable from day one (prove the loop is fun before scaling).
- Clear bookkeeping of what's final vs placeholder vs to-be-sourced.
- Requires discipline: the Game Artist must keep `asset-status.md` honest, and "this
  is Tier-1 final" is an art-direction call, not a default.

## Alternatives considered
- **Final-assets-before-gameplay:** blocks iteration and risks polishing the wrong loop.
- **Treat all generated assets as placeholders:** wastes the real, shippable output
  Tier 1 produces for flat/pixel/chiptune games.
