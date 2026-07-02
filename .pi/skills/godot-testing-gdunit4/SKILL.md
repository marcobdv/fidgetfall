---
name: godot-testing-gdunit4
description: Write and run automated tests for Godot 4 C# with GdUnit4 — unit tests, scene/node tests, headless CI execution. Use for QA automation and verifying gameplay logic.
---

# Testing Godot 4 C# with GdUnit4

GdUnit4 is the standard test framework for Godot C#. Favor testing **pure C# logic**
extracted from nodes; use scene tests only when you need the tree.

## Setup

Tests are their **own project** under `games/<slug>/test/`, referencing the game
csproj — never add test packages to the game project or they ship with exports.
See `games/sample-clockwork/test/` for the working reference. The pieces:

1. `test/<Slug>.Tests.csproj` (plain `Microsoft.NET.Sdk`):
   ```xml
   <Project Sdk="Microsoft.NET.Sdk">
     <PropertyGroup>
       <TargetFramework>net8.0</TargetFramework>
       <Nullable>enable</Nullable>
       <IsPackable>false</IsPackable>
       <!-- Godot's source generators flow in via the ProjectReference and need this: -->
       <GodotProjectDir>$(MSBuildProjectDirectory)/..</GodotProjectDir>
     </PropertyGroup>
     <ItemGroup>
       <PackageReference Include="gdUnit4.api" Version="5.0.0" />
       <PackageReference Include="gdUnit4.test.adapter" Version="3.0.0" />
       <PackageReference Include="Microsoft.NET.Test.Sdk" Version="18.6.0" />
     </ItemGroup>
     <ItemGroup>
       <ProjectReference Include="../<Slug>.csproj" />
     </ItemGroup>
   </Project>
   ```
2. In the **game** csproj: `<Compile Remove="test/**/*.cs" />` (the SDK glob would
   double-compile them) and `<InternalsVisibleTo Include="<Slug>.Tests" />` if tests
   touch internals.
3. An empty `test/.gdignore` so the Godot editor doesn't scan/import the test dir.

## A pure-logic unit test

```csharp
using GdUnit4;
using static GdUnit4.Assertions;

namespace Slug.Tests;

[TestSuite]
public class HealthTests
{
    [TestCase]
    public void TakeDamage_ReducesHealth_AndClampsAtZero()
    {
        var hp = new Health(max: 10);
        hp.TakeDamage(3);
        AssertInt(hp.Current).IsEqual(7);

        hp.TakeDamage(100);
        AssertInt(hp.Current).IsEqual(0);
        AssertBool(hp.IsDead).IsTrue();
    }

    [TestCase(0, 10, 10)]
    [TestCase(5, 10, 10)]    // overheal clamps to max
    public void Heal_ClampsToMax(int start, int heal, int expected)
    {
        var hp = new Health(max: 10);
        hp.SetCurrent(start);
        hp.Heal(heal);
        AssertInt(hp.Current).IsEqual(expected);
    }
}
```

> This is why the Lead Programmer keeps logic (`Health`) separable from the
> `Node` — it's testable with no scene tree.

## A scene/node test (needs the tree)

```csharp
[TestSuite]
[RequireGodotRuntime]   // gdUnit4 v5: without this the test runs on plain .NET and ISceneRunner fails
public class PlayerSceneTest
{
    [TestCase]
    public async Task Player_FallsUnderGravity()
    {
        ISceneRunner runner = ISceneRunner.Load("res://scenes/Player.tscn");
        var player = runner.Scene() as Player;
        float y0 = player!.Position.Y;
        await runner.SimulateFrames(30);          // advance physics
        AssertFloat(player.Position.Y).IsGreater(y0);
    }
}
```

> ⚠️ **Headless scene tests can be unstable.** The `ISceneRunner` path that drives a
> live `CharacterBody2D` / physics node has been seen to crash the test host with an
> `AccessViolationException` under headless CI. Prefer extracting and unit-testing
> **pure logic** (as above); reach for scene tests only when you truly need the tree,
> and keep them isolated so a native crash can't abort the whole suite.

## Run

In gdUnit4 v5, **pure-logic tests run as plain .NET tests** — no Godot binary
needed. Only suites/tests marked `[RequireGodotRuntime]` launch the engine, and
for those **`GODOT_BIN` must point at your Godot mono executable** or they fail
to host:

```bash
cd games/<slug>
dotnet test test/                # pure-logic tests: just works, headless in CI

# only needed when [RequireGodotRuntime] tests exist:
export GODOT_BIN="/path/to/Godot_v4.7-stable_mono.exe"
# PowerShell: $env:GODOT_BIN = "C:\path\to\Godot_v4.7-stable_mono.exe"
dotnet test test/
```

(`dotnet test` needs the explicit `test/` path — the game dir contains the game
csproj, which has no tests.)

## Conventions
- One `[TestSuite]` per unit; name tests `Method_State_Expectation`.
- Test behavior against the **design spec**, not the implementation.
- Every fixed bug gets a regression test before it's closed (QA rule).
- Keep tests fast and deterministic; no real time, no randomness without a seed.
