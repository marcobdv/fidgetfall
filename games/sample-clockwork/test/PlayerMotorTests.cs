using GdUnit4;
using SampleClockwork.Core;
using static GdUnit4.Assertions;

namespace SampleClockwork.Tests;

/// <summary>
/// Pure (engine-free) tests for the movement core — the coyote-time / jump-buffer /
/// jump-cut logic that used to live untestable inside the Player node (ADR-0004).
/// </summary>
[TestSuite]
public class PlayerMotorTests
{
    private const float Dt = 1f / 60f;

    private static PlayerMotor NewMotor() => new()
    {
        Speed = 200f,
        Acceleration = 1800f,
        Friction = 2000f,
        JumpVelocity = -400f,
        Gravity = 1200f,
        CoyoteTime = 0.1f,
        JumpBuffer = 0.1f,
        JumpCutMultiplier = 0.5f,
    };

    [TestCase]
    public void Jump_OnFloor_SetsJumpVelocity()
    {
        var m = NewMotor();
        var (_, vy) = m.Tick(Dt, 0f, 0f, axis: 0f, jumpPressed: true, jumpReleased: false, onFloor: true);
        AssertFloat(vy).IsEqual(-400f);
        AssertBool(m.JumpedThisTick).IsTrue();
    }

    [TestCase]
    public void CoyoteTime_AllowsJump_ShortlyAfterLeavingFloor()
    {
        var m = NewMotor();
        m.Tick(Dt, 0f, 0f, 0f, false, false, onFloor: true);      // establish floor contact
        m.Tick(Dt, 0f, 0f, 0f, false, false, onFloor: false);     // walk off the ledge
        var (_, vy) = m.Tick(Dt, 0f, 0f, 0f, jumpPressed: true, jumpReleased: false, onFloor: false);
        AssertBool(m.JumpedThisTick).IsTrue();
        AssertFloat(vy).IsEqual(-400f);
    }

    [TestCase]
    public void CoyoteTime_Expires_NoAirJump()
    {
        var m = NewMotor();
        m.Tick(Dt, 0f, 0f, 0f, false, false, onFloor: true);
        for (int i = 0; i < 10; i++)                               // 10 * (1/60) s > 0.1 s coyote window
            m.Tick(Dt, 0f, 0f, 0f, false, false, onFloor: false);
        m.Tick(Dt, 0f, 0f, 0f, jumpPressed: true, jumpReleased: false, onFloor: false);
        AssertBool(m.JumpedThisTick).IsFalse();
    }

    [TestCase]
    public void JumpBuffer_PressBeforeLanding_JumpsOnLanding()
    {
        var m = NewMotor();
        m.Tick(Dt, 0f, 100f, 0f, jumpPressed: true, jumpReleased: false, onFloor: false);  // press mid-air
        m.Tick(Dt, 0f, 100f, 0f, false, false, onFloor: true);                             // land within buffer
        AssertBool(m.JumpedThisTick).IsTrue();
    }

    [TestCase]
    public void JumpCut_EarlyRelease_HalvesUpwardVelocity()
    {
        var m = NewMotor();
        var (_, vy) = m.Tick(Dt, 0f, -300f, 0f, jumpPressed: false, jumpReleased: true, onFloor: false);
        // gravity applies first, then the cut: (-300 + 1200*dt) * 0.5
        AssertFloat(vy).IsEqualApprox((-300f + 1200f * Dt) * 0.5f, 0.001f);
    }

    [TestCase]
    public void JumpCut_DoesNotAffectFalling()
    {
        var m = NewMotor();
        var (_, vy) = m.Tick(Dt, 0f, 100f, 0f, jumpPressed: false, jumpReleased: true, onFloor: false);
        AssertFloat(vy).IsEqualApprox(100f + 1200f * Dt, 0.001f);  // gravity only, no cut
    }

    [TestCase]
    public void Friction_NoInput_DecaysTowardZero()
    {
        var m = NewMotor();
        var (vx, _) = m.Tick(Dt, 200f, 0f, axis: 0f, jumpPressed: false, jumpReleased: false, onFloor: true);
        AssertFloat(vx).IsEqualApprox(200f - 2000f * Dt, 0.001f);
    }

    [TestCase]
    public void Acceleration_ClampsAtTargetSpeed()
    {
        var m = NewMotor();
        float vx = 0f;
        for (int i = 0; i < 60; i++)
            (vx, _) = m.Tick(Dt, vx, 0f, axis: 1f, jumpPressed: false, jumpReleased: false, onFloor: true);
        AssertFloat(vx).IsEqual(200f);
    }
}
