using GdUnit4;
using SampleClockwork.Core;
using static GdUnit4.Assertions;

namespace SampleClockwork.Tests;

/// <summary>
/// Demonstrates the studio's testing convention: pure logic (Core.Health) is tested
/// with no scene tree, runs headless via `dotnet test`. See the godot-testing-gdunit4 skill.
/// </summary>
[TestSuite]
public class HealthTests
{
    [TestCase]
    public void NewHealth_StartsFull_AndAlive()
    {
        var hp = new Health(max: 3);
        AssertInt(hp.Current).IsEqual(3);
        AssertBool(hp.IsDead).IsFalse();
    }

    [TestCase]
    public void TakeDamage_Reduces_AndClampsAtZero()
    {
        var hp = new Health(max: 3);
        hp.TakeDamage(1);
        AssertInt(hp.Current).IsEqual(2);

        hp.TakeDamage(99);
        AssertInt(hp.Current).IsEqual(0);
        AssertBool(hp.IsDead).IsTrue();
    }

    [TestCase(1, 5, 3)]   // overheal clamps to max (start alive; see Heal_DoesNotReviveTheDead)
    [TestCase(1, 1, 2)]
    public void Heal_ClampsToMax(int start, int heal, int expected)
    {
        var hp = new Health(max: 3);
        hp.SetCurrent(start);
        hp.Heal(heal);
        AssertInt(hp.Current).IsEqual(expected);
    }

    [TestCase]
    public void Heal_DoesNotReviveTheDead()
    {
        var hp = new Health(max: 3);
        hp.TakeDamage(3);
        hp.Heal(2);
        AssertInt(hp.Current).IsEqual(0);
        AssertBool(hp.IsDead).IsTrue();
    }
}
