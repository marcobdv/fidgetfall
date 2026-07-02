using Godot;

namespace SampleClockwork;

/// <summary>
/// Scene glue: listens to the player's <c>Died</c> signal and respawns it.
/// Demonstrates the studio convention of connecting signals in the owning scene
/// rather than having entities reach out to their listeners.
/// </summary>
public partial class Main : Node2D
{
    public override void _Ready()
    {
        var player = GetNode<Player.Player>("Player");
        player.Died += player.Respawn;
    }
}
