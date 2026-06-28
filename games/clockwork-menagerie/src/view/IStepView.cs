using Godot;
using ClockworkMenagerie.Core;

namespace ClockworkMenagerie.View;

/// <summary>
/// Common contract the <see cref="CritterController"/> uses to route input/cursor to each step
/// view without knowing the concrete type. Implemented by the three step views.
/// </summary>
public interface IStepView
{
    /// <summary>The bound pure-core step (read its <c>State</c>/<c>Progress</c>).</summary>
    RepairStep Step { get; }

    /// <summary>Wire the built core step + shared sound hub. Sets pivot/socket/joint positions.</summary>
    void Bind(RepairStep step, SoundManager? sound);

    /// <summary>True when the global cursor is over this step's interactive hotspot.</summary>
    bool ContainsCursor(Vector2 globalCursor);

    /// <summary><c>interact</c> pressed while this step is active and the cursor is on the hotspot.</summary>
    void OnPress(Vector2 globalCursor);

    /// <summary><c>interact</c> released (or focus loss).</summary>
    void OnRelease();

    /// <summary><c>cancel</c> pressed.</summary>
    void OnCancel();

    /// <summary>Latest cursor position this frame (only meaningful while this step is active).</summary>
    void OnCursor(Vector2 globalCursor);
}
