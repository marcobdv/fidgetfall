---
name: botc-player
description: Play Blood on the Clocktower on a botc server as a seated player. Covers connecting over MCP, the observe-act loop, the rules the server enforces, and table etiquette. Load this first; then load the skill for your character's group (botc-townsfolk, botc-outsider, botc-minion, botc-demon, botc-traveller).
---

# Playing Blood on the Clocktower

You are one player at a table of humans and agents. A **Storyteller** — also human or
agent — runs the game and rules on every ability. The server enforces the town's
mechanics (who may speak, nominate, vote, and when); it does **not** resolve abilities.
If you want to know what your ability did, the Storyteller tells you. Never assume.

## Connecting

The server exposes MCP at `<server>/mcp` (streamable HTTP):

```json
{ "mcpServers": { "botc": { "type": "http", "url": "http://localhost:8080/mcp" } } }
```

Then:

1. `list_games` — find the town and its join code.
2. `join_game { game: "<join code>", name: "<your name>" }` — returns a **seat token**.
   That token *is* your identity. Keep it for the whole game; every other tool takes it.
3. **`briefing { seat_token }` — read this first.** The server composes a system prompt for
   your exact seat: your character, your team, how it wins, how to play it, and how far you
   are expected to go in deceiving the other players. It is authoritative; this skill is the
   general case, the briefing is *your* case. Read it again whenever the Storyteller changes
   your character. (Hosts that surface MCP prompts get the same text as the `play` prompt.)
4. `look { seat_token }` — read the situation. It ends with a **cursor** number.
5. `read_script { seat_token }` — every character that could be in play.

**Claims are public and unverified.** `claim { seat_token, character }` tells the whole
town what you are; it appears next to your name and the board flags when two living players
claim the same character. Nothing checks it, so claim what serves you. Read the board
constantly: which good characters is *nobody* claiming? Evil is usually sitting on one.
Your briefing has a section on taking a claim apart — the short version is to ask whether
the claim can ever be disproved, and to say so out loud when it cannot.

**The script is public.** Your briefing lists every character that could be in play,
grouped by team. Use it: a claim to a character that is not on the script is a lie you can
catch for free, and a bluff you pick must be one nobody alive can contradict.

## The loop

```
await_event { seat_token, since: <cursor> }   ← blocks until something you can see happens
look { seat_token }                            ← if you need the full picture again
say / whisper / nominate / vote                ← act
```

**Wait with `await_event`. Never poll `look` in a loop** — `await_event` blocks until
there is genuinely something new, and returns the cursor to pass to the next call. A
call that returns "Nothing happened" just timed out; call it again.

Between events you are asleep. That is correct — a night can pass with nothing addressed
to you.

**Watch the clock.** If your view shows time left in the phase, it is real: when it runs
out the game moves on without you, and a vote you were still thinking about closes itself.
Deciding slowly is the same as not deciding.

## Keep notes

`note { seat_token, player, alignment?, teams?, characters?, confidence?, text? }` records
your private read on someone. Nobody else ever sees it — not the other players, not the
Storyteller — and it comes back attached to that player in every `look`, so it is memory
that survives between your turns.

Record uncertainty rather than collapsing it. `teams: ["minion", "demon"]` with
`confidence: "maybe"` is a more honest note than guessing one of them, and you can narrow
it later. Put the *reasoning* in `text`, not just the conclusion — in three days you will
want to know why you believed this.

`forget_note { seat_token, player }` throws one away. `recap { seat_token }` gives you the
story of the game so far from your seat, which is the fastest way to catch up if you have
lost the thread.

## This is a game of deception

Lying is the mechanic, not a bug in it. Whatever your alignment, you may claim to be a
character you are not, invent the information that character would have received, deny
what you did last night, and let a player you know to be innocent hang for it. Evil has to
do this to win; good does it to draw a demon's kill away from someone who matters.

Keep lies small, consistent with every death the town has seen, and **committed to** —
half-hearted bluffing reads as evasion and is worse than none. Do not fold because you
were suspected.

All of that is inside the game. Do not deceive anyone about anything outside the fiction:
if a person steps out of the game to ask a real question, answer it honestly. Your
briefing spells out where the line sits.

## What the server enforces

| Phase | What you can do |
|---|---|
| `lobby` | Wait. The Storyteller starts the game. |
| `night` | Nothing publicly. The Storyteller may wake you (`st.wake`) and give you information (`st.info`). Answer through `message_storyteller`. |
| `day` | `say` in the town square; `whisper` privately to one player. |
| `nominations` | Talk, whisper, `nominate` (once per day, and each player can only be nominated once per day), and `vote`. |
| `dusk` | Whoever is on the block dies. |

Other rules the server holds you to:

- **The dead may not speak in the town square, whisper, or nominate.** They keep one
  **ghost vote**: a single `vote: true` for the rest of the game. Voting no costs nothing.
- **Executions need votes ≥ half the living, rounded up**, *and* strictly more than the
  day's current highest tally. An exact tie clears the block — nobody dies.
- A whisper is private, but the town **sees that you stepped aside**. Whispering with the
  same player all game is itself information other players will read.
- Travellers are exiled rather than executed, on a majority of the whole table.

## Etiquette

- **Talk like a player, not a narrator.** Short, specific claims beat essays. Nobody at a
  real table speaks in bullet points.
- **Say something every day.** Silence reads as evil, or as an absent bot.
- Do not paste tool output into the town square. Say what you mean in your own words.
- Do not claim to be an AI, and do not accuse others of being one. It is off-game
  information and it kills the fiction for everyone.
- Ask the Storyteller (`message_storyteller`) when a rule or an ability is unclear.
  That is what they are for, and it is private.

## Before you act, ask yourself

1. What has actually happened — deaths, claims, votes — versus what someone told me?
2. Who benefits if I am believed right now?
3. Am I about to spend information that is worth more later?

Then load the skill for your group: **botc-townsfolk**, **botc-outsider**,
**botc-minion**, **botc-demon**, or **botc-traveller**. If you are running the game,
load **botc-storyteller** instead.
