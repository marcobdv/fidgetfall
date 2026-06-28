# Clockwork Menagerie — GDD

> Living design doc for the vertical slice. Source of truth for what we build.
> Input: `docs/vision.md` (greenlit). Detailed system specs live under `docs/systems/`.

## 1. Overview

- **Genre:** Cozy tactile repair / toy-box sandbox. No fail state, no timers.
- **Platform:** Windows + Linux desktop first (Godot 4.7 mono, C#/.NET). Web stretch.
- **Input:** Mouse-driven, fixed camera. Single-pointer; no keyboard required to play.
- **Target session length:** 2–5 minutes for the slice (one critter). The full game
  is "potter about for as long as you like."
- **Audience:** Players who want a calm, warm, low-stakes fidget — fans of Tiny Glade,
  A Little to the Left, Assemble with Care.
- **Elevator pitch:** A kindly tinkerer winds, re-seats, and oils a broken clockwork
  critter at a lamplit bench until it springs to life and toddles across the desk.

## 2. Pillars

(from `docs/vision.md` — the lens for every decision)

1. **Repair is care, not a puzzle.** Verbs are nurturing; success is a critter coming
   alive, never a score or a fail state.
2. **Tactile, legible tinkering.** Every action gives a satisfying, readable response
   (tick, wobble, chime). Game feel over complexity.
3. **Each critter is a little personality.** Payoff is emotional motion + sound, not a
   number.
4. **Calm pace, zero pressure.** No timers, no failure, no scarcity. A half-done critter
   waits patiently.

**Anti-goals:** no combat/enemies/danger; no twitch or precision timing; no crafting
economy or tech tree; no punishing failure states. You cannot break a critter — worst
case it simply isn't done yet.

## 3. Core loop

**One-line:** *Hover a glowing part → hold/click the right gentle gesture → the part
responds and seats with a chime → repeat across three parts → the critter wakes and
walks.*

### 10-second loop (moment-to-moment)
1. A repairable part on the critter softly pulses to invite attention (affordance).
2. Player moves the cursor over it → it highlights; a hint of the gesture shows.
3. Player performs the gesture for that part (see Controls): hold-and-turn to **wind**,
   drag-to-seat to re-seat a **gear**, hold-to-pour to **oil** a joint.
4. The part gives continuous tactile feedback (rotation ticks, wobble, fill) and, when
   complete, snaps/seats with a chime + small settle animation.
5. The next part lights up. No part can regress; progress only accumulates.

### Session loop (2–5 minutes, the whole slice)
Sit down at the bench → **Step 1 Wind** the mainspring → **Step 2 Re-seat** the bent
gear → **Step 3 Oil** the stuck leg joint → all three done triggers the **come-to-life
payoff**: the critter animates awake, chimes, does a personality beat (head-tilt + happy
whirr), and toddles across the desk. Player watches the payoff; slice ends (or resets to
replay). The reward *is* the toy.

### Why it's fun
Legible cause→effect with juicy feedback, zero pressure, and an earned emotional payoff.
Each gesture maps to a real-world caring motion, so competence feels gentle, not clever.

## 4. Mechanics & systems

The slice has exactly one system of consequence: **Repair**. Full spec with state
machine, rules, edge cases, and tunables: **`docs/systems/repair.md`**.

- **Purpose:** Pillars 1 & 2 — turn caring gestures into legible, satisfying progress.
- **Summary:** A critter holds an ordered list of **repair steps**. Each step is a small
  state machine (`Idle → Active → Completing → Done`) driven by one mouse gesture. When
  every step is `Done`, the critter fires its **come-to-life** payoff.
- **Three step archetypes in the slice:**
  - **Wind** (mainspring): hold `interact` and circle the cursor to accumulate winding
    turns to a target.
  - **Re-seat** (gear): press `interact` to grab the loose gear, drag it onto its socket
    within a snap radius, release to seat.
  - **Oil** (leg joint): hover the oiler over the joint and hold `interact` to fill an
    oil meter; the joint frees once full.

Step **order is fixed** for the slice (wind → re-seat → oil) to teach the verbs one at a
time. (See Open Questions for whether later critters allow free order.)

## 5. Progression & economy

**None in the slice.** No currencies, no unlocks, no upgrade tree, no difficulty ramp.
The only "progression" is the three steps of the single critter. This is intentional per
the anti-goals. Numbers that *do* exist are game-feel tunables, owned by `repair.md`.

## 6. Content scope (the slice)

| Content | Count | The one representative |
|---|---|---|
| Critters | 1 | **Beetle** — a beetle-ish clockwork bug, flat-vector body, 3 repair sites. |
| Bench scenes | 1 | Lamplit workbench, fixed camera, dark quiet surround, warm pool of light. |
| Repair steps | 3 | Wind mainspring → re-seat one gear → oil one stuck leg joint. |
| Tools | 3 (diegetic) | Implied by gesture: winding-key (cursor), fingers/grab, oiler. No inventory. |
| Payoff | 1 | Come-to-life: wake animation + chime + head-tilt/whirr + walk across desk. |

Art/audio are **Tier-1 self-sufficient** (flat vector SVG + chiptune/synth SFX) per the
vision; no Tier-2 generators needed for the slice.

## 7. Controls & UX

Single-pointer mouse control. Proposed input map (Gameplay Programmer wires these into
`project.godot [input]`; logic references action **names**, never raw keycodes):

| Action (input map) | Binding | Used for |
|---|---|---|
| `interact` | Left mouse button (`InputEventMouseButton`, `BUTTON_LEFT`) | The single verb: hold to wind/oil, press-drag-release to re-seat. |
| `cursor` | Mouse motion (`InputEventMouseMotion` position) | Hover/highlight, circle-to-wind angle, drag target for re-seat. |
| `cancel` | Right mouse button / `Esc` | Release a grabbed part back to its start (no progress lost on completed steps). |

Notes:
- **One verb, context-sensitive.** The active step decides what holding `interact` does;
  the player never picks a tool from a menu.
- **`cursor` is motion, not a binding** in the engine sense — listed so the spec can
  reference "cursor position/delta" unambiguously. The programmer reads
  `GetGlobalMousePosition()` / `InputEventMouseMotion`.

### Key UX flows
- **Affordance:** only the *currently actionable* part pulses/highlights; completed and
  not-yet-available parts do not, so the player always knows where to look.
- **In-action feedback:** continuous visual (rotation, drag ghost, fill meter) + audio
  (winding whirr, scrape, drip) proportional to progress.
- **Completion:** snap/seat animation + chime + the part stops inviting input.
- **No HUD numbers, no fail prompts.** All feedback is diegetic.
- Detailed UX/feedback ownership is shared with the UX/UI Designer; this GDD owns the
  *rules*, that doc owns *presentation polish*.

## 8. Art & audio direction

Flat vector / minimalist geometric, tight warm palette; chiptune + synth SFX. Final via
Tier-1 `procedural-asset-generation`. See `docs/art/direction.md` and `docs/audio/*`
(to be authored by Concept Artist / Sound Designer). Gameplay never blocks on assets;
placeholders are clearly marked `placeholder_`.

## 9. Narrative

No dialogue or text in the slice. Story is purely the *fantasy of gentle competence*
delivered through the critter waking up. Pointer for later: `docs/narrative/bible.md`
(not needed for the slice).

## 10. Scope & milestones

**Vertical slice (THIS):** one bench, one beetle, three repair steps, one come-to-life
payoff. Proves the core loop is fun before any content scaling.

**Explicitly OUT of the slice:**
- More than one critter, or any critter selection / menu / hub.
- Save/load, settings beyond defaults, options menus.
- Progression, currency, unlocks, achievements, score.
- Free camera, pan/zoom, multi-angle inspection (camera is fixed).
- Keyboard/gamepad control schemes (mouse only).
- Difficulty modes or assist toggles.
- Multiple tools as inventory items; any non-diegetic UI.
- Procedural/random part placement (the slice is hand-authored).
- Localization, accessibility passes beyond "no timing pressure" (revisit post-slice).

## 11. Open questions

1. **Step ordering for future critters:** slice is fixed-order (wind→reseat→oil). Do
   later critters allow any-order repair? *Decision deferred to post-slice; slice is
   fixed-order.* (Repair system is authored to support both — see `repair.md`.)
2. **Replay/reset after payoff:** does the slice loop back to a fresh broken critter, or
   end on the walk-away? *Proposed: a soft "tinker again" reset; confirm with Producer.*
3. **`cancel` necessity:** is an explicit cancel needed, or does releasing `interact`
   suffice for every gesture? *Proposed: releasing suffices; `cancel` is a safety net for
   re-seat drags. Confirm in playtest.*
4. **Re-seat input model:** hold-drag vs. click-to-grab/click-to-place. *Proposed:
   hold-drag (press-move-release). Flagged for the first feel test.*
