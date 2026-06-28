# Audio — SFX (event→sound map)

> Clockwork Menagerie is a **calm, no-fail cozy game** (see `docs/vision.md`). All
> SFX are **soft, warm, gentle** — sine-based, modest volume, short. Nothing harsh,
> no noise bursts, no aggressive transients. The bench is a quiet lamplit island;
> sound is diegetic and reassuring.
>
> **Tier:** these are **Tier-1 final** assets (synthesized via the committed
> `synth-sfx.mjs`), not placeholders — chiptune/synth SFX is exactly what Tier 1
> delivers as final for this art direction.

## Event → sound map

These cues hook to the repair state machines in `docs/systems/repair.md`.

| File | Repair event (where it fires) | Character |
|---|---|---|
| `wind_tick.wav` | **Wind** step (§5.1): every `WindTickDegrees` (30°) of accumulated winding travel while the player turns the key. | Very short, low-volume soft tick. Played repeatedly — kept quiet so a stream of ticks stays pleasant, not clicky. |
| `gear_pickup.wav` | **Re-seat** step (§5.2): on `press`/grab of the loose gear (`Idle`→`Active`, gear becomes grabbed). | Gentle rising pluck — "lifted." |
| `gear_seat.wav` | **Re-seat** step (§5.2): on successful seat (release within `SnapRadius` → `Completing`); the gear snaps home. | Warm settling chime — the satisfying "seats home." |
| `oil_drip.wav` | **Oil** step (§5.3): looped/retriggered softly while pouring on-target (`progress` filling). | Soft, low, bubbly drip. |
| `step_done.wav` | **Any** step's `Completing` settle chime (shared, §4 / §7.0 `CompletionSettleTime`). Fires once when a step reaches `Done`. | Gentle confirming rising chime. |
| `come_alive.wav` | **Critter** `ComingAlive` payoff (§3): the frame the last step completes and the beetle wakes (after `ComeAliveDelay`). | Warm, longer, rising-and-happy wake chime — the emotional payoff. |

Notes for the implementer (Gameplay Programmer / Animator):
- `wind_tick.wav` is **retriggered many times per gesture** — randomize pitch slightly
  (±1–2 semitones) and/or let pitch/density rise with `progress` per §5.1 for life.
- `oil_drip.wav` is short; loop it or retrigger with small random pitch while pouring,
  and fade it out the moment pouring pauses (Oil pauses, never punishes).
- `gear_seat.wav` and `step_done.wav` both play around a successful re-seat — sequence
  them (seat snap, then the step-done confirm) or pick one to avoid stacking.
- The magnet/hover hum mentioned in §5.2 (`MagnetHintRadius`) is **not yet authored** —
  see shopping list below.

## Reproducible synth commands

Run from the repo root (`C:\repos\private\fidgetfall`). All use the committed
`synth-sfx.mjs`. Sine waves + modest `--vol` + short `--dur` = cozy.

```bash
SYNTH=.pi/skills/procedural-asset-generation/scripts/synth-sfx.mjs
SFX=games/clockwork-menagerie/assets/audio/sfx

# soft tick each wind increment (very short, low volume)
node "$SYNTH" "$SFX/wind_tick.wav"   --wave sine --f0 520 --f1 440  --dur 0.045 --vol 0.22 --decay 3.0

# picking up the gear to re-seat (gentle rising pluck)
node "$SYNTH" "$SFX/gear_pickup.wav" --wave sine --f0 440 --f1 660  --dur 0.10  --vol 0.30 --decay 2.2

# "seats home" chime when the gear snaps in (warm, settling)
node "$SYNTH" "$SFX/gear_seat.wav"   --wave sine --f0 784 --f1 1047 --dur 0.22  --vol 0.34 --decay 1.8

# soft bubbly drip while oiling (low, gentle)
node "$SYNTH" "$SFX/oil_drip.wav"    --wave sine --f0 300 --f1 220  --dur 0.13  --vol 0.26 --decay 2.6

# gentle confirming chime when a repair step completes (rising)
node "$SYNTH" "$SFX/step_done.wav"   --wave sine --f0 659 --f1 988  --dur 0.30  --vol 0.34 --decay 1.6

# warm payoff chime when the critter wakes (longer, rising, happy)
node "$SYNTH" "$SFX/come_alive.wav"  --wave sine --f0 523 --f1 1319 --dur 0.70  --vol 0.40 --decay 1.1
```

## Intended mix (soft)

- **Overall:** quiet and warm. SFX never spike; this is a tea-and-rain soundscape.
- **Relative levels (loudest → softest):** `come_alive` (the payoff, `--vol 0.40`)
  > `step_done` / `gear_seat` (chimes, 0.34) > `gear_pickup` (0.30) > `oil_drip`
  (0.26) > `wind_tick` (0.22, deliberately the quietest since it repeats most).
- **Frequencies** sit in a warm mid range (220 Hz–1.3 kHz); nothing piercing.
- **Bus suggestion (for in-engine wiring, not yet authored):** a single `SFX` bus
  under `Master`, gentle limiter only. Duck `SFX` slightly under `come_alive` so the
  wake payoff reads clearly. Light reverb (small room) would suit the lamplit-bench
  cozy space — optional, add at polish.

## Shopping list / outstanding SFX needs

These events in `docs/systems/repair.md` are spec'd but **not yet authored**:

- **Magnet/hover hum** (§5.2, `MagnetHintRadius`): a soft continuous "let go here" hum
  when the dragged gear is within snap range. Needs a gentle looping tone — synthesize
  next (low sine drone) or source CC0 (Tier 1.5).
- **Idle invite / hover highlight** (§4, `HighlightPulsePeriod`): optional faint pulse
  cue when a step is `Idle` awaiting the player. Likely visual-only, but a barely-there
  blip could help legibility.
- **Walk / contented whirr** (§3 `Alive`, Pillar 3 personality): the toddle-across-the-
  desk loop and the "contented whirr" personality beat. Belongs with the Animator's
  wake sequence; author alongside the walk animation.
