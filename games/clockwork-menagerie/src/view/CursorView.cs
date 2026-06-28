using Godot;

namespace ClockworkMenagerie.View;

/// <summary>
/// Custom diegetic pointer (docs/art: cursor.svg, hotspot at the fingertip ~6,4). Sets the
/// hardware cursor image so the tinkerer's hand replaces the OS arrow across the bench.
/// </summary>
public partial class CursorView : Node
{
    [Export] public Texture2D? CursorTexture { get; set; }

    /// <summary>Hotspot offset within the texture (fingertip). (asset-status.md: ~6,4)</summary>
    [Export] public Godot.Vector2 Hotspot { get; set; } = new(6, 4);

    public override void _Ready()
    {
        if (CursorTexture is not null)
            Input.SetCustomMouseCursor(CursorTexture, Input.CursorShape.Arrow, Hotspot);
    }
}
