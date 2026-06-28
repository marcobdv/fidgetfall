using GdUnit4;
using PlayerNode = SampleClockwork.Player.Player;   // namespace Player shadows the type
using static GdUnit4.Assertions;

namespace SampleClockwork.Tests;

/// <summary>
/// Pure (engine-free) regression tests for Player logic. Scene-level tests of the full
/// CharacterBody2D are intentionally avoided — the headless scene runner is unstable here,
/// and the studio convention is to keep logic testable without the tree.
/// </summary>
[TestSuite]
public class PlayerLogicTests
{
    // Regression for code review finding #3: a designer-set MaxHealth <= 0 must not reach
    // the Health constructor (which throws); it is clamped to a valid minimum instead.
    [TestCase(0, 1)]
    [TestCase(-5, 1)]
    [TestCase(1, 1)]
    [TestCase(3, 3)]
    [TestCase(100, 100)]
    public void SanitizeMaxHealth_ClampsBelowOne(int input, int expected)
    {
        AssertInt(PlayerNode.SanitizeMaxHealth(input)).IsEqual(expected);
    }
}
