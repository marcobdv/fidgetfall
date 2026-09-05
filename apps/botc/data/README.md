# Script store

The server reads every `*.json` in `scripts/` on start and offers them when a game is
created. Files use the **community script-tool JSON format**: an array whose first entry
is a `_meta` object, followed by either

- a **character id string** (`"washerwoman"`) — resolved against the character index in
  `characters/`, or
- a **full character object** (`{ "id": ..., "name": ..., "team": ..., "ability": ... }`)
  for homebrew.

Drop a script exported from the official script tool (or from botc-scripts) into
`scripts/` and it shows up on the next restart.

## What ships here, and what doesn't

| File | Contents |
|---|---|
| `scripts/trouble-brewing.json`, `bad-moon-rising.json`, `sects-and-violets.json` | The three base editions, exactly as the script tool represents them: `_meta` plus the list of character ids. |
| `characters/base-editions.json` | Index for those 72 characters: **id, display name, and team** only. |
| `scripts/whispers-in-the-orchard.json` | An **original** 10-character homebrew script written for this repo, with full ability text and night order. Used by the tests and playable out of the box. |
| `scripts/the-long-thaw.json` | An **original** 17-character script for 8-13 players, also with full text. Written after four games of watching agents play, so several characters read the public record — claims made, votes cast — rather than the grimoire. |

**Ability text and night order for the three base editions are deliberately not
committed.** Those are the publisher's copyrighted text; this repo is public and MIT
licensed, so it ships the mechanical facts (name, team, which script) and leaves the
words to you. Nothing breaks without them — the engine is
[storyteller-adjudicated](../README.md#design), so the Storyteller rules on abilities;
missing text just means the character sheet shows a name and a team.

## Filling in ability text locally

If you own the game, point the server at a character database and it will merge the
extra fields (`ability`, `firstNight`, `otherNight`, `reminders`, …) over the shipped
index at load time:

```bash
BOTC_ROLES_FILE=/path/to/roles.json npm start
```

The file is a JSON array of character objects keyed by `id` — the same shape the script
tool uses for homebrew entries. `data/characters/roles.local.json` is gitignored, so you
can also just drop it there:

```bash
cp ~/Downloads/roles.json apps/botc/data/characters/roles.local.json
```

Anything the merge doesn't cover is simply absent from the UI; it is never invented.

## Travellers

`base-editions.json` also carries the fifteen base-edition travellers (name and team
only, like everything else in it). Travellers are **not** part of any script — the store
offers the whole pool on top of every script, including the original ones, because that
is how they work at a table: the Storyteller seats one for a player arriving mid-game.

They have no ability text here for the same copyright reason as everything else, so
supply it the same way, through `BOTC_ROLES_FILE` or `roles.local.json`. A traveller
with no ability text still works — their character is public, so the table can simply
ask the Storyteller what it does.
