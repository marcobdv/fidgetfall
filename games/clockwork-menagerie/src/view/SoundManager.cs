using Godot;
using System.Collections.Generic;

namespace ClockworkMenagerie.View;

/// <summary>
/// Small SFX hub: owns a pool of <see cref="AudioStreamPlayer"/>s and plays the mapped cozy
/// cues (docs/audio/sfx.md) on repair events. One-shot sounds round-robin over the pool so
/// rapidly retriggered ticks/drips don't cut each other off. Pitch can be jittered slightly
/// per the audio notes ("randomize pitch ±1–2 semitones" for the repeated tick/drip).
/// </summary>
public partial class SoundManager : Node
{
    private const string SfxDir = "res://assets/audio/sfx/";

    private readonly Dictionary<string, AudioStream> _streams = new();
    private AudioStreamPlayer[] _pool = System.Array.Empty<AudioStreamPlayer>();
    private int _next;

    /// <summary>Number of voices in the round-robin pool.</summary>
    [Export] public int Voices { get; set; } = 8;

    public override void _Ready()
    {
        LoadStream("wind_tick");
        LoadStream("gear_pickup");
        LoadStream("gear_seat");
        LoadStream("oil_drip");
        LoadStream("step_done");
        LoadStream("come_alive");

        _pool = new AudioStreamPlayer[Mathf.Max(1, Voices)];
        for (int i = 0; i < _pool.Length; i++)
        {
            var p = new AudioStreamPlayer { Name = $"Voice{i}", Bus = "Master" };
            AddChild(p);
            _pool[i] = p;
        }
    }

    private void LoadStream(string key)
    {
        var stream = GD.Load<AudioStream>($"{SfxDir}{key}.wav");
        if (stream is not null) _streams[key] = stream;
        else GD.PushWarning($"SoundManager: missing SFX '{key}'.");
    }

    /// <summary>Play a one-shot cue by logical name with optional pitch + volume (dB) adjust.</summary>
    public void Play(string key, float pitch = 1f, float volumeDb = 0f)
    {
        if (!_streams.TryGetValue(key, out AudioStream? stream)) return;
        AudioStreamPlayer voice = _pool[_next];
        _next = (_next + 1) % _pool.Length;
        voice.Stream = stream;
        voice.PitchScale = Mathf.Clamp(pitch, 0.25f, 4f);
        voice.VolumeDb = volumeDb;
        voice.Play();
    }

    /// <summary>Convenience: play with a small random pitch jitter (for repeated ticks/drips).</summary>
    public void PlayJittered(string key, float basePitch = 1f, float jitter = 0.06f, float volumeDb = 0f)
    {
        float p = basePitch + (float)GD.RandRange(-jitter, jitter);
        Play(key, p, volumeDb);
    }
}
