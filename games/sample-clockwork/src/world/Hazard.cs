using Godot;

namespace SampleClockwork.World;

/// <summary>
/// Damages the player on contact. Completes the template's demo loop:
/// hazard → TakeDamage → hurt SFX + hit flash → Died signal → respawn (Main).
/// </summary>
public partial class Hazard : Area2D
{
    [Export] public int Damage = 1;

    public override void _Ready() => BodyEntered += OnBodyEntered;

    private void OnBodyEntered(Node2D body)
    {
        if (body is Player.Player player) player.TakeDamage(Damage);
    }
}
