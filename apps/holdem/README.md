# Fidgetfall Hold'em ♠

Online no-limit Texas Hold'em where **humans and AI agents sit at the same table**.
Humans play in the browser with a coach looking over their shoulder; agents join over
**MCP** and play from an identical seat. Tables are created on request and live only as
long as someone is using them.

> This is an experiment, and the one thing in this repo that is not a Godot game —
> see [ADR-0009](../../docs/adr/0009-holdem-typescript-exception.md) for why.

```
      ┌────────────┐   WebSocket + REST   ┌──────────────────┐
      │  browser   │ ───────────────────► │                  │
      │  (human)   │ ◄─────────────────── │   table server   │
      └────────────┘                      │                  │
                                          │  ┌────────────┐  │
      ┌────────────┐   MCP over HTTP      │  │   rules    │  │
      │   agent    │ ───────────────────► │  │   engine   │  │
      │            │ ◄─────────────────── │  └────────────┘  │
      └────────────┘                      └──────────────────┘
```

The engine is the authority. Hole cards are only ever sent to the seat that owns them —
there is no request, from the browser or from MCP, that returns another player's cards
before a showdown.

## Run it

```bash
npm install
npm run build
npm start            # http://localhost:8787
```

Open the page, name yourself, tick a couple of bot opponents, and hit **Create and sit
down**. That is the whole setup.

Development:

```bash
npm test             # 109 tests: rules, evaluator, coach, room, HTTP, MCP
npm run typecheck
```

## Playing as a human

The table deals itself. When it is your turn, the action bar offers exactly what is
legal, and the **Coach** panel shows the arithmetic behind the decision:

- what you actually hold, and which five cards make it;
- your equity against the opponents still in the hand;
- your outs, grouped by what they make, with the rule of two and four;
- the pot odds — what fraction of the time you need to win to break even on the call;
- a suggested action, with the reasoning that produced it.

When the hand ends, **Last hand** replays your decisions and recomputes your equity at
each one against the price you were being offered, and names the decision that mattered.

The coach measures equity against *random* hands, which flatters marginal holdings — real
opponents fold their worst cards. The panel says so, because a beginner who learns the
arithmetic and its limits learns more than one handed an answer.

## Playing as an agent

Ten MCP tools. A whole agent is `join_table` once, then `wait_for_turn` → `act` in a loop.

| Tool | What it does |
|---|---|
| `list_tables` | Every running table, with blinds, buy-ins and who is seated |
| `create_table` | Start one. All arguments optional; `bots` seats opponents immediately |
| `join_table` | Take a seat. Returns the **token** that *is* your seat |
| `get_state` | The table as your seat sees it, with your legal actions and their amounts |
| `wait_for_turn` | Blocks until it is your turn — use this instead of polling |
| `act` | `fold` / `check` / `call` / `bet` / `raise` |
| `get_coaching` | The coach's read on your current spot |
| `review_hand` | Post-hand breakdown of your own decisions |
| `add_bot` | Seat a built-in opponent |
| `leave_table` | Stand up and cash out |

**Amounts are raise-to totals.** `{"action":"raise","amount":80}` means *end the round
with 80 in*, not *add 80*. `get_state` always shows the legal range; an amount outside it
is rejected, never quietly adjusted.

### Connecting

**Remote (streamable HTTP)** — point any MCP client at the running server:

```
http://localhost:8787/mcp
```

**Local (stdio)** — for hosts that launch MCP servers as subprocesses:

```json
{
  "mcpServers": {
    "holdem": {
      "command": "node",
      "args": ["/path/to/apps/holdem/dist/mcp/stdio.js", "http://localhost:8787"]
    }
  }
}
```

The stdio process is a thin proxy: it forwards every tool call to the table server over
its REST API, so a local agent plays at a table hosted anywhere.

### Poking at it by hand

`tools/mcp-cli.mjs` is a one-shot MCP client: it connects to `/mcp`, calls one tool, prints
what came back, and exits. Handy for debugging, and it lets an agent host that cannot mount
an MCP server (a shell, a CI job) still play a hand.

```bash
node tools/mcp-cli.mjs tools                    # list the tools
node tools/mcp-cli.mjs create_table '{"bots":["balanced"]}'
node tools/mcp-cli.mjs join_table '{"tableId":"bd7k2p","name":"Ada"}'
node tools/mcp-cli.mjs wait_for_turn '{"token":"bd7k2p.…"}'
node tools/mcp-cli.mjs act '{"token":"bd7k2p.…","action":"raise","amount":80}'
```

Set `HOLDEM_SERVER` to point it at a server other than `http://localhost:8787`.

### A minimal agent loop

```
list_tables                        → pick one, or create_table
join_table  {tableId, name}        → keep the token
loop:
  wait_for_turn {token}            → yourTurn true? act. false? call it again.
  read state.legalActions
  act {token, action, amount?}
```

`wait_for_turn` returns within 45 seconds either way, and `yourTurn: false` simply
means call it again — a table with slow opponents needs several calls. The cap is
deliberate: MCP clients abandon a request on their own deadline (60s by default in the
TypeScript SDK), so a longer block would fail as "Request timed out" no matter how
healthy the table is.

## Bots

Four archetypes, all playing from their own cards only — they call the same equity code
the coach does and see nothing you cannot see.

| Bot | Behaviour | What it teaches |
|---|---|---|
| `rock` | Folds almost everything, means it when it bets | Respecting a tight player's aggression |
| `station` | Calls far too much, almost never raises | Value-betting thin, never bluffing |
| `maniac` | Bets and raises relentlessly | Waiting for a hand and letting it bluff at you |
| `balanced` | Plays pot odds and hand strength, bluffs occasionally | Ordinary, reasonable poker |

## HTTP API

| Method | Path | |
|---|---|---|
| `GET` | `/api/tables` | list tables |
| `POST` | `/api/tables` | create one |
| `GET` | `/api/tables/:id?token=` | table state, redacted for the token |
| `POST` | `/api/tables/:id/join` | sit down, returns a seat token |
| `POST` | `/api/tables/:id/act` | `{token, action, amount?}` |
| `POST` | `/api/tables/:id/leave` | stand up |
| `GET` | `/api/tables/:id/coach?token=` | coaching for that seat |
| `GET` | `/api/tables/:id/review?token=&hand=` | post-hand review |
| `POST` | `/api/tables/:id/bots` | seat a bot |
| `GET` | `/api/bots` | the bot roster |
| `WS` | `/ws?table=&token=` | pushed state on every change |

## How it is put together

```
src/engine/    the rules. Pure, deterministic, no I/O — cards, evaluator,
               betting state machine, side pots, table lifecycle
src/coach/     equity (Monte Carlo + exact river), outs, pot-odds advice,
               post-hand review
src/bots/      the four opponent archetypes
src/server/    the room (identity, clocks, bot turns) and the HTTP/WS server
src/mcp/       the agent-facing tools, the text renderer, and both transports
public/        the browser client — no framework, no build step
tools/         mcp-cli.mjs, a one-shot MCP client for debugging
test/          109 tests
```

Two properties are worth calling out because everything else leans on them:

**The engine is deterministic.** Every hand is seeded, so it replays exactly. That is
what makes the rules testable, and it is how the post-hand review recomputes what your
equity *was* at a decision rather than guessing.

**Redaction happens at the server.** `Table.view(viewerId)` builds a state that already
has the other seats' cards removed. The browser and the MCP tools both render what they
are given; neither is trusted to hide anything.

The evaluator is cross-checked in the tests against an independent brute-force scorer over
20,000 random seven-card hands, and the betting engine is fuzzed over 400 hands asserting
that chips are conserved exactly.

## Limits

- Tables live in memory. Restarting the server ends every table.
- Cash-game ring play only — no tournaments, no blind levels.
- No accounts and no real money. A seat token is the only identity, and it is not a
  credential worth protecting beyond the length of a session.
- The coach's equity assumes random opponent hands. It is a teaching tool, not a solver.
