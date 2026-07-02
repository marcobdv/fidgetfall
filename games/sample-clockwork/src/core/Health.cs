namespace SampleClockwork.Core;

/// <summary>
/// Pure, scene-tree-free health logic. Lives outside any Godot node so it can be
/// unit-tested without the editor (see test/HealthTests.cs). This separation of
/// logic from <c>Node</c> glue is a studio convention — see docs/conventions.md.
/// </summary>
public sealed class Health
{
    public int Max { get; }
    public int Current { get; private set; }
    public bool IsDead => Current <= 0;

    public Health(int max)
    {
        if (max <= 0) throw new System.ArgumentOutOfRangeException(nameof(max));
        Max = max;
        Current = max;
    }

    /// <summary>
    /// Apply damage; clamps at zero. Ignores non-positive amounts. Returns true only
    /// when this call caused the alive→dead transition, so callers can fire a death
    /// event exactly once (damaging a corpse returns false).
    /// </summary>
    public bool TakeDamage(int amount)
    {
        if (amount <= 0 || IsDead) return false;
        Current = System.Math.Max(0, Current - amount);
        return IsDead;
    }

    /// <summary>Heal; clamps at Max. Ignores non-positive amounts and the dead.</summary>
    public void Heal(int amount)
    {
        if (amount <= 0 || IsDead) return;
        Current = System.Math.Min(Max, Current + amount);
    }

    /// <summary>
    /// Directly set current health (clamped). Unlike <see cref="Heal"/> this has no
    /// dead-guard by design — it's the revive path for save/load, respawn, and tests.
    /// </summary>
    public void SetCurrent(int value) =>
        Current = System.Math.Clamp(value, 0, Max);
}
