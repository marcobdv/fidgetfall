---
name: godot-audio
description: Implement audio in Godot 4 C# — AudioStreamPlayer/2D/3D playback, bus layout and effects via AudioServer, music crossfades, SFX patterns. Use when wiring sound or music into a game.
---

# Godot 4 audio implementation (C#)

How sound and music actually get into the game. Assets come from the asset-tier
skills; this skill is the engine wiring.

## Players — pick by spatiality

| Node | Use for |
|---|---|
| `AudioStreamPlayer` | UI, music, non-positional SFX |
| `AudioStreamPlayer2D` | positional 2D SFX (attenuates with distance) |
| `AudioStreamPlayer3D` | positional 3D SFX |

```csharp
// Typical one-shot SFX from a node script:
[Export] public AudioStream? JumpSfx;
private AudioStreamPlayer _sfx = null!;

public override void _Ready()
{
    _sfx = GetNode<AudioStreamPlayer>("SfxPlayer");
}

private void PlayJump()
{
    _sfx.Stream = JumpSfx;
    _sfx.PitchScale = (float)GD.RandRange(0.95, 1.05);  // cheap variation
    _sfx.Play();
}
```

- A player plays **one stream at a time** — `Play()` while playing restarts it.
  For overlapping one-shots, pool a few players or use `AudioStreamPolyphonic`.
- `Finished` signal fires when playback ends (not for loops).
- Loop settings live on the **stream import**, not the player: for `.wav`, set
  loop mode in the import dock or `.import` file; `.ogg` has `loop` on the stream.

## Buses (`default_bus_layout.tres`)

Route everything through named buses so mixing is one knob per category:

```
Master
├── Music
└── SFX
    └── UI
```

- Create the layout in the editor's Audio panel (bottom dock) — it saves to
  `res://default_bus_layout.tres` automatically; commit it.
- Assign a player's bus with `Bus = "SFX"` (property `bus` in `.tscn`).
- Volume from C# — decibels, not linear; convert:

```csharp
AudioServer.SetBusVolumeDb(AudioServer.GetBusIndex("Music"),
                           Mathf.LinearToDb(volumeLinear));   // 0..1 slider value
AudioServer.SetBusMute(AudioServer.GetBusIndex("SFX"), muted);
```

- Bus effects (reverb, low-pass for "underwater/paused", compressor on Master)
  are added per-bus in the layout; toggle from code with
  `AudioServer.SetBusEffectEnabled(busIdx, effectIdx, enabled)`.

## Music — autoload + crossfade

Music survives scene changes, so it lives on an autoload (e.g. `MusicManager`
owned by the Composer role) with two `AudioStreamPlayer`s on the `Music` bus:

```csharp
// Crossfade: fade the active player down while the other fades up.
var t = CreateTween();
t.Parallel().TweenProperty(_active, "volume_db", -40f, dur);
t.Parallel().TweenProperty(_next,   "volume_db",   0f, dur);
_next.Play();
```

- Start fades from `-40 dB` (near-silent), not `-80`, so the curve feels linear.
- For adaptive music, keep stems on separate synced players and fade stems
  in/out; start them together and never stop the silent ones.

## Conventions (studio)

- Audio files under `res://assets/audio/{sfx,music}/`; sourced files logged in
  `CREDITS.md` (see `asset-sourcing`).
- Bus layout + `SoundManager` autoload are owned by the **Sound Designer**;
  `MusicManager` by the **Composer**; they share the bus layout.
- Keep gameplay logic out of audio nodes — gameplay emits signals/calls,
  audio nodes react (same pure-logic separation as everything else).
