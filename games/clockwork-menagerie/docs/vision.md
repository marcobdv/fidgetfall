# Clockwork Menagerie — vision

> Phase-0 concept. A small, shippable cozy game. Target: a tiny vertical slice in
> Godot 4 / C#. Art/audio are **Tier-1 self-sufficient** (see note at bottom).

## Hook
A cozy little workbench where you wind, clean, and gently repair broken clockwork
critters until each one springs back to life and toddles happily across your desk.

## Pillars
1. **Repair is care, not a puzzle to solve.** The verbs are nurturing — wind the
   spring, oil a joint, swap a bent gear, polish a faceplate. Success is a critter
   coming *alive*, never a score or a fail state.
2. **Tactile, legible tinkering.** Every action has a satisfying, readable
   response: a tick of the spring, a wobble, a chime when a part seats correctly.
   Game feel over complexity.
3. **Each critter is a little personality.** A fixed critter expresses character
   through simple motion and sound (a hop, a head-tilt, a contented whirr), so the
   payoff is emotional, not numeric.
4. **Calm pace, zero pressure.** No timers, no failure, no resource scarcity. You
   can put a critter down half-finished and it just waits patiently.

### Anti-goals
- **No combat, no enemies, no danger.** Nothing on the bench can hurt or be lost.
- **No twitch skill or precision timing.** Repairs are deliberate, not reflexive.
- **No deep crafting economy / tech tree.** Parts are diegetic, not a grind.
- **No punishing failure states.** You cannot "break" a critter; worst case is it
  simply isn't done yet.

## Fantasy / tone
You are a kindly tinkerer at a warm pool of lamplight. The world outside is dark
and quiet; your bench is the cozy island. You feel *gentle competence* — the
quiet pride of bringing a small, trusting thing back to working order. Tone is
storybook-whimsical and unhurried: think a rainy evening, a cup of tea, and the
soft tick of gears finding their rhythm.

## References (what we take from each)
- **Tiny Glade** — the no-fail, no-pressure "just potter about" loop and the sense
  that the toy itself is the reward. We take the *zero-stakes cozy framing*.
- **Assemble with Care / Gnog** — diegetic, hands-on object repair with tactile,
  responsive parts. We take the *manipulate-this-object intimacy* and click-fit feel.
- **A Little to the Left** — small, satisfying "set it right" micro-tasks with
  charming, low-fidelity charm. We take the *bite-sized completion loop and warmth*.
- **Wilmot's Warehouse / Unpacking (vibe)** — flat, friendly shapes and quiet,
  diegetic audio carrying all the personality. We take the *minimalist visual
  language* that flat vector art can deliver in full fidelity.

## Vertical slice scope
- **One critter** (a beetle-ish clockwork bug) with **3 repair steps**: wind the
  mainspring, re-seat one gear, oil a stuck leg joint.
- **One bench scene**, fixed camera, mouse-driven interaction.
- **Win state:** all three steps done → the critter animates to life, chimes, and
  walks. That's the whole loop, proven fun before any content scaling.

## Why this art direction is Tier-1 self-sufficient
The chosen direction is **flat vector / minimalist geometric art with a tight,
warm palette, plus chiptune + synthesized SFX** — exactly the categories the
studio's **Tier-1 `procedural-asset-generation`** skill produces as *final*, not
placeholder, output:
- **Visuals:** critters and parts are built from simple shapes (gears = circles +
  teeth, springs = coils, bodies = rounded polys). These render perfectly as
  **code-generated SVG / vector**, so the studio can self-author every asset with
  zero external generator and full stylistic cohesion.
- **Animation:** personality comes from transform-based motion (rotate, bob,
  squash) on those flat shapes — Godot `AnimationPlayer` / tween, no rigging or
  drawn frames required.
- **Audio:** ticks, chimes, winding whirrs, and a gentle loop are squarely
  **synth-SFX + chiptune** territory (committed `synth-sfx.mjs` / algorithmic
  music), so audio is also Tier-1 final.

Net: the entire vertical slice can be built and shipped **without Tier-2 generators
or sourced assets**, keeping the studio fully self-sufficient and the look cohesive
by construction. (If we later want richer ambience, Tier-1.5 CC0 audio is the only
likely upgrade — gameplay never blocks on it.)
