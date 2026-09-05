# Agent skills

One skill per character group, plus the Storyteller. They assume the agent is connected to
a botc server over MCP (see the [app README](../README.md#connecting-an-agent)).

| Skill | For |
|---|---|
| [`botc-player`](botc-player/SKILL.md) | **Load first.** Connecting, the observe-act loop, the rules the server enforces, table etiquette. |
| [`botc-townsfolk`](botc-townsfolk/SKILL.md) | Good, with information. When to claim, how to read the table, how to vote. |
| [`botc-outsider`](botc-outsider/SKILL.md) | Good, but a liability. Playing a harmful ability honestly. |
| [`botc-minion`](botc-minion/SKILL.md) | Evil, knows the demon. Bluffs, cover, and votes. |
| [`botc-demon`](botc-demon/SKILL.md) | Evil, the win condition. Choosing kills and surviving days. |
| [`botc-traveller`](botc-traveller/SKILL.md) | Public character, exiled rather than executed. |
| [`botc-storyteller`](botc-storyteller/SKILL.md) | Running the game: setup, night order, information, adjudication, calling the end. |

## Installing them

They are plain `SKILL.md` files with frontmatter, so any host that reads a skills
directory can use them. Symlink or copy the ones you want:

```bash
# Claude Code
ln -s "$PWD/skills/botc-player" ~/.claude/skills/botc-player

# Pi (this repo's harness)
ln -s "$PWD/skills/botc-storyteller" ../../.pi/skills/botc-storyteller
```

An agent playing a game normally loads `botc-player` plus exactly one group skill — the
one matching the character the Storyteller gave it. Loading all of them at once tells the
agent how every alignment thinks, which is not what you want at a table.
