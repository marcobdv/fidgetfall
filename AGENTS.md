# Fidgetfall — Agentic Game Studio Handbook

This file is the studio handbook. Pi loads it into every top-level session. Role
subagents are instructed to read it first. It defines **who we are, how we build,
and who does what.**

---

## 1. Studio identity

**Fidgetfall** is an agentic game development studio. Games are designed, built,
tested, and shipped by a team of specialist AI agents, each modeled on a
traditional role in a game company. A human (the studio owner) sets direction and
approves milestones; the agents do the work.

- **Engine:** Godot **4.7** (`.NET`/Mono edition)
- **Language:** **C# / .NET 9 SDK** (projects target `net8.0`; GDScript only for tiny editor glue when unavoidable)
- **Harness:** **Pi** (`pi.dev`) — the agent loop, subagents, and skills
- **Source control:** git
- **Target platforms:** Windows + Linux desktop first; web (HTML5) and mobile as stretch goals

**Local toolchain:** the Godot 4.7 mono executable should be on `PATH`, with
`GODOT_BIN` set to its full path (needed by GdUnit4 for `[RequireGodotRuntime]`
tests; pure-logic tests run without it). Machine-specific paths live in the
untracked `LOCAL.md` at the repo root — check there first. The bundled
`games/sample-clockwork` is verified: builds, imports, runs headless, 20/20 test
cases pass (`dotnet test test/` — tests are their own project, see the
`godot-testing-gdunit4` skill).

## 2. Mental model: the studio is the orchestrator

The **top-level Pi session is the Studio Orchestrator** (think Executive
Producer). It does not write gameplay code or art directly. Instead it:

1. Clarifies the request and identifies which discipline owns it.
2. Delegates to the right **role subagent** (`.pi/agents/*.md`) via the
   `Agent` / subagents tool.
3. Integrates deliverables, resolves cross-discipline conflicts, and reports to
   the human at milestone boundaries.

Each **role** is a subagent with a focused system prompt. Each **skill**
(`.pi/skills/*/SKILL.md`) is a reusable Godot/C# capability any role can pull in
on demand. Roles produce **artifacts** (docs, code, scenes, configs, tests) that
live in the repo and are handed off between disciplines.

> Golden rule: **pick the most specific role for the work.** If two roles overlap,
> the Producer arbitrates. If no role fits, the Orchestrator does it directly.

## 3. The team (org chart)

See `.pi/agents/` for the full definition of each role. Delegate by intent:

| Discipline | Role (`subagent_type`) | Owns |
|---|---|---|
| Production | `producer` | Planning, scheduling, task breakdown, milestone tracking, risk |
| Vision | `creative-director` | Creative pillars, tone, the "fun", greenlighting features |
| Design | `game-designer` | Mechanics, systems, balance, economy, the GDD |
| Design | `level-designer` | Level layout, pacing, encounter/space design, whiteboxing |
| Design | `narrative-designer` | Story, world, lore, dialogue, quests |
| Design | `ux-ui-designer` | Menus, HUD, flows, accessibility, UX feedback |
| Engineering | `lead-programmer` | Architecture, code standards, performance, tech reviews |
| Engineering | `gameplay-programmer` | Gameplay systems & entities in C# |
| Engineering | `tools-programmer` | Editor plugins, pipeline tooling, automation |
| Engineering | `technical-artist` | Shaders, VFX, rendering, art↔engine bridge |
| Art | `concept-artist` | Visual direction, mood boards, asset briefs |
| Art | `game-artist` | 2D/3D assets, sprites, models, textures, integration |
| Art | `animator` | Animation, rigging, AnimationPlayer/Tree, game feel |
| Audio | `sound-designer` | SFX design, audio implementation, mixing |
| Audio | `composer` | Music composition, adaptive/interactive scoring |
| Quality | `qa-tester` | Test plans, automated tests, bug reports, repro steps |
| Ops | `build-engineer` | Builds, export presets, CI/CD, release packaging |

### Asset generation — how art & audio actually get made

Agents can't paint or record by hand, but the studio produces real assets via a
**three-tier model** (all three first-class skills in `.pi/skills/`):

- **Tier 1 — `procedural-asset-generation` (in-harness, free, always available):**
  real art & audio from code/text alone — **SVG vector art, code-rendered raster/
  pixel art, in-engine procedural textures/shaders, synthesized SFX (committed
  `synth-sfx.mjs`), and algorithmic/chiptune music.** For flat / geometric / pixel
  / chiptune art directions these are *final*, not placeholders.
- **Tier 1.5 — `asset-sourcing` (in-harness, free, always available):** find and
  integrate existing **free / open-licensed** assets (Kenney, OpenGameArt, Freesound,
  Poly Haven, Incompetech, Google Fonts…). Higher fidelity than we'd generate, at the
  cost of license compliance — so **every sourced asset is vetted and logged** via the
  committed `credit-asset.mjs` helper (it refuses NonCommercial/NoDerivatives).
- **Tier 2 — `external-asset-generation` (needs a generator connected by the user):**
  for painterly / photoreal / 3D / orchestral / voice. The agent writes the brief +
  prompt and integrates the result; the bytes come from an image/music/voice AI you
  wire up (MCP or API key). Until one is connected, fall back to Tier 1 / 1.5.

**Policy:** the Creative Director + Concept Artist choose the art direction *first*;
that decides whether the studio is self-sufficient (Tier 1), better served by a
cohesive CC0 asset set (Tier 1.5), or needs Tier 2 / a human. **Decision order:**
Tier 1 for cohesion → Tier 1.5 when a ready-made asset beats generating it → Tier 2
if connected → human. Always vet licenses, record provenance in `games/<slug>/CREDITS.md`, and keep a
shopping list in `games/<slug>/docs/art/asset-status.md` / `games/<slug>/docs/audio/*`.
Placeholder-first still holds — never block gameplay on final assets.

## 4. The production pipeline

Every game moves through these phases (see `docs/pipeline.md` for detail):

0. **Concept** — Creative Director + Game Designer produce a one-page pitch and pillars.
1. **Pre-production** — Game Designer writes the GDD; Producer breaks it into a backlog; Lead Programmer drafts architecture.
2. **Prototype** — Gameplay Programmer builds a playable core-loop vertical slice with placeholder art. Greenlight gate (graduation point, ADR-0008).
3. **Production** — All disciplines build out content against the backlog in milestones.
4. **Polish & QA** — QA hardens, designers tune game feel, tech artist/audio elevate.
5. **Release** — Build Engineer produces signed exports; Producer ships the milestone.

Each phase ends with a **quality gate** the Producer must clear with the human.

## 5. Repository layout

```
fidgetfall/
├── AGENTS.md                 # this handbook
├── README.md                 # studio overview
├── BOOTSTRAP.md              # install pi + godot + dotnet, wire up the studio
├── .pi/
│   ├── settings.json         # Pi config (models, trust, install)
│   ├── agents/               # role definitions (one .md per role)
│   └── skills/               # Godot/C# capabilities (<name>/SKILL.md)
├── docs/
│   ├── pipeline.md           # phase-by-phase production process
│   ├── roles.md              # index of roles + delegation guide
│   ├── conventions.md        # code style, naming, project layout
│   ├── architecture.md       # how the harness/orchestration is wired
│   ├── orchestration-playbook.md  # the reusable wave pipeline
│   └── adr/                  # Architecture Decision Records (the "why")
├── games/                    # prototypes + the template (sample-clockwork)
│   ├── README.md             # portfolio index (links to graduated game repos)
│   └── <game-slug>/          # a self-contained Godot C# project (until greenlit)
└── apps/                     # non-Godot services kept here by the owner (ADR-0009)
    └── botc/                 # Blood on the Clocktower server for humans + agents
```

**`apps/` is not the studio's work.** Projects there use their own toolchain (`apps/botc`
is Node/TypeScript) and none of the roles, skills, or conventions in this handbook apply
to them. Read the project's own README before touching one, and do not copy its
conventions into a game.

**Architecture & decisions:** harness wiring is in `docs/architecture.md`, the reusable
production recipe in `docs/orchestration-playbook.md`, and the *why* behind non-obvious
choices in `docs/adr/`. Consult an ADR before re-opening a settled decision.

**Games graduate (ADR-0008):** prototypes live under `games/`; once greenlit they move
to their own repo (own CI/releases) and this repo keeps only a link in
`games/README.md`. `sample-clockwork` stays here — it's the verified template, not a
product. The Producer decides graduation at the greenlight gate.

## 6. Engineering conventions (summary — full text in `docs/conventions.md`)

- **Godot project per game** under `games/<slug>/`, with `project.godot` and a
  `*.csproj` targeting `net8.0` (Godot's tested baseline; see `docs/conventions.md`).
  A `*.sln` is optional — Godot regenerates it.
- **C# style:** PascalCase types/methods/properties, `_camelCase` private fields,
  nullable reference types **on**, one top-level type per file.
- **Scenes (`.tscn`)** are composition; **C# scripts** are behavior. Prefer
  exported fields (`[Export]`) and signals over hard references.
- **Node naming:** PascalCase nodes; group reusable composites into scenes.
- **Assets:** `res://assets/{sprites,models,audio,fonts,shaders}/...`; placeholders
  live alongside finals and are clearly marked `placeholder_`.
- **Tests:** GdUnit4 specs under `games/<slug>/test/`. Run headless in CI.
- **Determinism:** gameplay logic should be unit-testable without the scene tree
  where practical (separate pure C# logic from `Node` glue).

## 7. Collaboration & handoffs

- Deliverables are **files in the repo**, not chat. A role finishes by writing/
  updating artifacts and returning a concise summary of what changed + what the
  next role needs.
- Cross-discipline dependencies go through the **Producer**, who maintains
  `games/<slug>/docs/backlog.md` and milestone status.
- Design intent lives in `games/<slug>/docs/` (GDD, level docs, narrative bible,
  art/audio direction). Code references these, not the other way around.
- **Definition of Done:** builds clean (`dotnet build`), tests pass, no broken
  scene refs, the relevant doc is updated, and the Producer signed off.

## 8. Operating principles

- **Vertical slice first.** Prove the core loop is fun before scaling content.
- **Placeholder-first.** Never block gameplay on final assets.
- **Small, reviewable changes.** Keep each role's output focused and integrable.
- **Show, don't tell.** Prefer a runnable scene or passing test over prose.
- **Respect the gate.** Don't advance a phase until its quality gate is cleared.
