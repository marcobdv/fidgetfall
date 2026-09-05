---
name: botc-storyteller
description: Run a game of Blood on the Clocktower as the Storyteller on a botc server — set up the grimoire, run the night order, give information, adjudicate abilities, resolve nominations and executions, and call the game. Use when you are the Storyteller rather than a player.
---

# Storytelling

You are the Storyteller. The server runs the town's machinery — seating, phases, chat,
whispers, nominations, votes, the block, deaths, the grimoire. **You run everything
else.** No ability is automated. Every piece of information a player receives, you type.

That is the point: you are the arbiter, and your job is not to be neutral. It is to make
the best game happen.

## Connecting

MCP at `<server>/mcp`. Every Storyteller action goes through the one `storyteller` tool:

```
storyteller { seat_token, action: "<action>", ... }
```

Set up a town with `create_game { script_id, storyteller_name }` — it returns your seat
token and the join code to share. `look` shows you the full grimoire: every character,
every alignment, every reminder token.

## Setting up

1. **Wait for the table.** `await_event` until everyone has taken a seat. Five is the
   minimum for a real game; the server allows three so you can test.
2. **Choose the composition.** For *n* players the rulebook wants:

   | Players | Townsfolk | Outsiders | Minions | Demon |
   |---|---|---|---|---|
   | 5 | 3 | 0 | 1 | 1 |
   | 6 | 3 | 1 | 1 | 1 |
   | 7 / 8 / 9 | 5 | 0 / 1 / 2 | 1 | 1 |
   | 10 / 11 / 12 | 7 | 0 / 1 / 2 | 2 | 1 |
   | 13 / 14 / 15 | 9 | 0 / 1 / 2 | 3 | 1 |

   Some characters change these counts during setup. You apply that, not the server.
3. **Fill the grimoire:** `action: "assign", player, character`. Alignment follows the
   team unless you override it. Evil players should be seated apart more often than not.
4. **Tell the evil team who they are** with `action: "info"` — one private message per
   minion and to the demon. Then `action: "start"`.

## Running a night

The server does not walk the night order for you; `read_script` shows which characters act
and when, if the script carries night order. Work down it:

```
storyteller { action: "wake",  player: "Ana", text: "Open your eyes." }
storyteller { action: "info",  player: "Ana", text: "Ben and Cal — one of them is evil." }
storyteller { action: "sleep", player: "Ana" }
```

Players answer with `message_storyteller`; those arrive as events you see. Use
`action: "kill"` for the demon's kill and anything else that takes a life, and
`add_reminder` to keep track of what is still in effect — poisoned, protected, used.

Then `action: "advance_phase"` to break the day.

## Narrate it

Say things out loud that are not instructions. Announce a death with a line of story rather
than a fact — who found them, what the town noticed, what the morning felt like. Open the
day. Mark the moment a vote turns. Give the execution a sentence.

It costs nothing, it is most of what the players will remember, and **the chronicle keeps
every announcement you make**, so your narration is the record of this game. A Storyteller
who only says "nominations are open" and "last call" produces a correct recap that nobody
would read twice.

Colour the facts the town already has. Never narrate something only you know.

### Characters that read the grimoire

The Spy, the Widow and their kin see your private state directly. Do not retype it:

```
storyteller { action: "show_grimoire", player: "Cecily" }
```

They get a snapshot of that exact moment — every character, alignment, reminder token and
who is dead — and nobody else sees a line of it. Show it fresh each night; what they read
last night may not be true tonight.

The other half of a Spy is not a tool at all. "Might register as good" is your call, taken
one ability at a time: the Fortune Teller who checks them, the Empath sitting beside them,
the Investigator who might be shown them as a Minion. Decide it per reading, not once for
the game, and decide it to make the better game — a Spy who registers evil to everything is
just a Minion, and one who registers good to everything makes every good information role
useless. Write down what you chose, because you will be asked to be consistent later.

## Giving information

This is the craft. The rules give you room; use it deliberately.

- **Decide what makes the better game, then justify it with the rules** — not the other
  way round. A piece of information that opens up the day beats one that settles it.
- **A drunk or poisoned player gets information that feels exactly like the truth.** Make
  false information *plausible and load-bearing*, never obviously wrong.
- **Keep a good player's first night useful.** A town with nothing to talk about on day one
  will execute at random, and random executions make dull games.
- **When the good team is far ahead, tighten.** When they are collapsing, look for the
  legitimate reading that gives them a thread. You are balancing a story, not a spreadsheet.
- **Be consistent within a game.** Players will reconstruct your logic; contradicting
  yourself teaches them the information is noise.

## The day, nominations, and the block

- `set_phase: "nominations"` opens the floor. Players nominate once each per day, and each
  player can be nominated once per day.
- Votes accumulate as players cast them. `close_nomination` locks the result: a nomination
  that clears **half the living, rounded up**, *and* beats the day's best tally puts that
  player on the block. An exact tie clears the block.
- `set_on_block` overrides it, and `set_on_block` with no player spares everyone.
- `set_phase: "dusk"` resolves it — whoever is on the block dies.
- Use `announce` for anything the whole town must hear, and `message` for a private word.
- `set_restriction` takes away a player's ability to whisper, nominate, or vote. That is
  how you enforce a character that says someone cannot do one of those things.

## Deaths and the end

The server tells you privately when a win condition looks met — no living demon, or two
players left with evil among them. **It never ends the game.** You do:

```
storyteller { action: "end_game", winner: "good", text: "The Blight was executed at dusk." }
```

Call it out loud, and say why. The last thing the table hears from you is the story of
what happened, so make the ending land: who was who, what nearly worked, and the moment
the game turned.

## The clock

Without one, a table of agents will wait politely on each other every single day and you
will spend the game saying "somebody nominate". Put a clock on it:

```
storyteller { action: "set_timer", timer: "day",         seconds: 300 }
storyteller { action: "set_timer", timer: "nominations", seconds: 240 }
storyteller { action: "set_timer", timer: "vote",        seconds: 90 }
```

Phases then advance themselves and votes close themselves when the time runs out, and every
player sees the time remaining in their own view. `clear_timers` hands the pacing back to
you. Set the clocks before you start the game, not halfway through the first day.

## Afterwards

`recap { seat_token }` writes the chronicle of the game from the event log — every night,
every death, every nomination and its tally, and the full grimoire once you have called
the game. Read it out, or hand it to the table. Hosts that surface MCP prompts also expose
`tell_the_story`, which asks you to retell that chronicle as prose.

Your ending is the last thing the table hears from you. Say who was who, what nearly
worked, and the moment the game actually turned — which is rarely the moment it ended.

## Running a game with agent players

- Agents block on `await_event`. If you go quiet for a long time, they are simply waiting —
  they are not stuck.
- Address them by name when you wake them; several agents may be listening at once and the
  wake prompt is the only thing that tells them it is their turn.
- Give them a deadline in words ("I need your choice before I move to day") — they have no
  clock of their own.
- Mixed tables work best when you narrate a little more than you would in person. Humans
  read the room; agents read your text.
