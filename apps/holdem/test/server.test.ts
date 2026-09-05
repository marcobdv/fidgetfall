import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer, type RunningServer } from "../src/server/http.js";
import { PokerRoom } from "../src/server/room.js";

let running: RunningServer;
let base: string;

beforeAll(async () => {
  running = await startServer({
    port: 0,
    host: "127.0.0.1",
    // Fast bots and no pause between hands, so a test can play a whole session.
    room: new PokerRoom({ botThinkMs: 0, handIntervalMs: 0 }),
    tickMs: 10,
  });
  base = `http://127.0.0.1:${running.port}`;
});

afterAll(async () => {
  await running.close();
});

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function apiRaw(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

describe("REST API", () => {
  it("serves the browser client at the root", async () => {
    const response = await apiRaw("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(await response.text()).toMatch(/<title>/i);
  });

  it("refuses to serve anything outside the public directory", async () => {
    const response = await apiRaw("/../package.json");
    expect([403, 404]).toContain(response.status);
  });

  it("creates a table on request and lists it", async () => {
    const created = await api<{ table: { id: string; bigBlind: number } }>("/api/tables", {
      method: "POST",
      body: JSON.stringify({ name: "Kitchen table", bigBlind: 50, maxSeats: 4, bots: ["rock"] }),
    });
    expect(created.table.bigBlind).toBe(50);

    const listed = await api<{ tables: Array<{ id: string; name: string; agents: number }> }>("/api/tables");
    const mine = listed.tables.find((t) => t.id === created.table.id)!;
    expect(mine.name).toBe("Kitchen table");
    expect(mine.agents).toBe(1);
  });

  it("rejects a bad table configuration with a readable message", async () => {
    const response = await apiRaw("/api/tables", {
      method: "POST",
      body: JSON.stringify({ bigBlind: 20, smallBlind: 50 }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/cannot exceed/);
  });

  it("plays a hand end to end over HTTP", async () => {
    const { table } = await api<{ table: { id: string } }>("/api/tables", {
      method: "POST",
      body: JSON.stringify({ name: "E2E", bigBlind: 20, bots: ["station"] }),
    });

    const { seating } = await api<{ seating: { token: string; seat: number } }>(
      `/api/tables/${table.id}/join`,
      { method: "POST", body: JSON.stringify({ name: "Ada", kind: "human", buyIn: 1000 }) },
    );

    // Wait for a hand to start and the action to reach us.
    const state = await waitForTurn(table.id, seating.token);
    expect(state.legalActions).not.toBeNull();
    expect(state.seats[seating.seat]!.holeCards).toHaveLength(2);

    // Everyone else's cards stay hidden, even to a seated player.
    for (const seat of state.seats) {
      if (seat.seat === seating.seat || !seat.inHand) continue;
      expect(seat.holeCards).toBeNull();
    }

    const after = await api<{ state: { log: string[] } }>(`/api/tables/${table.id}/act`, {
      method: "POST",
      body: JSON.stringify({ token: seating.token, action: "fold" }),
    });
    expect(after.state.log.join(" ")).toMatch(/Ada folds/);
  });

  it("rejects an action from a seat that is not to act", async () => {
    const { table } = await api<{ table: { id: string } }>("/api/tables", {
      method: "POST",
      body: JSON.stringify({ bigBlind: 20, bots: ["rock"] }),
    });
    const { seating } = await api<{ seating: { token: string } }>(`/api/tables/${table.id}/join`, {
      method: "POST",
      body: JSON.stringify({ name: "Ada", kind: "human", buyIn: 1000 }),
    });
    await waitForTurn(table.id, seating.token);

    // Fold, then immediately try to act again: it is no longer our turn.
    await api(`/api/tables/${table.id}/act`, {
      method: "POST",
      body: JSON.stringify({ token: seating.token, action: "fold" }),
    });
    const response = await apiRaw(`/api/tables/${table.id}/act`, {
      method: "POST",
      body: JSON.stringify({ token: seating.token, action: "fold" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an unknown token", async () => {
    const { table } = await api<{ table: { id: string } }>("/api/tables", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const response = await apiRaw(`/api/tables/${table.id}/act`, {
      method: "POST",
      body: JSON.stringify({ token: "nope.nope", action: "fold" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/unknown or expired/);
  });

  it("hides hole cards from an unauthenticated view of a live table", async () => {
    const { table } = await api<{ table: { id: string } }>("/api/tables", {
      method: "POST",
      body: JSON.stringify({ bots: ["rock", "balanced"] }),
    });
    await sleepUntil(async () => {
      const { state } = await api<{ state: { handNumber: number } }>(`/api/tables/${table.id}`);
      return state.handNumber > 0;
    });
    const { state } = await api<{ state: { seats: Array<{ holeCards: unknown }> } }>(
      `/api/tables/${table.id}`,
    );
    for (const seat of state.seats) expect(seat.holeCards).toBeNull();
  });

  it("returns 404 for an unknown table and an unknown route", async () => {
    expect((await apiRaw("/api/tables/zzzzzz")).status).toBe(404);
    expect((await apiRaw("/api/nonsense")).status).toBe(404);
  });

  it("reports its health and its bot roster", async () => {
    const health = await api<{ ok: boolean }>("/api/health");
    expect(health.ok).toBe(true);
    const { bots } = await api<{ bots: Array<{ id: string; blurb: string }> }>("/api/bots");
    expect(bots.map((b) => b.id).sort()).toEqual(["balanced", "maniac", "rock", "station"]);
    for (const bot of bots) expect(bot.blurb.length).toBeGreaterThan(10);
  });
});

describe("MCP endpoint", () => {
  async function connect(): Promise<Client> {
    const client = new Client({ name: "test-agent", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    return client;
  }

  it("advertises the tools an agent needs to play", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "act",
      "add_bot",
      "create_table",
      "get_coaching",
      "get_state",
      "join_table",
      "leave_table",
      "list_tables",
      "review_hand",
      "wait_for_turn",
    ]);
    for (const tool of tools) expect(tool.description!.length).toBeGreaterThan(30);
    await client.close();
  });

  it("lets an agent create a table, sit down, and play a hand", async () => {
    const client = await connect();

    const created = await client.callTool({
      name: "create_table",
      arguments: { name: "Agent table", bigBlind: 20, bots: ["station"] },
    });
    const tableId = (created.structuredContent as { table: { id: string } }).table.id;
    expect(tableId).toBeTruthy();

    const joined = await client.callTool({
      name: "join_table",
      arguments: { tableId, name: "Bot-Ada", buyIn: 1000 },
    });
    const token = (joined.structuredContent as { token: string }).token;
    expect(token.startsWith(`${tableId}.`)).toBe(true);

    const waited = await client.callTool({
      name: "wait_for_turn",
      arguments: { token, timeoutMs: 5000 },
    });
    const wait = waited.structuredContent as {
      yourTurn: boolean;
      state: { legalActions: { canCall: boolean } };
    };
    expect(wait.yourTurn).toBe(true);
    // The rendered text is what a model actually reads.
    expect(text(waited)).toMatch(/It is your turn/);
    expect(text(waited)).toMatch(/You may:/);

    // In the big blind there is nothing to call, so take whichever passive
    // action the table is actually offering.
    const passive = wait.state.legalActions.canCall ? "call" : "check";
    const acted = await client.callTool({ name: "act", arguments: { token, action: passive } });
    expect(acted.isError).toBeFalsy();
    expect(text(acted)).toMatch(new RegExp(`You ${passive}`));

    await client.close();
  });

  it("gives an agent coaching on its own hand", async () => {
    const client = await connect();
    const created = await client.callTool({
      name: "create_table",
      arguments: { bigBlind: 20, bots: ["rock"] },
    });
    const tableId = (created.structuredContent as { table: { id: string } }).table.id;
    const joined = await client.callTool({
      name: "join_table",
      arguments: { tableId, name: "Student", buyIn: 1000 },
    });
    const token = (joined.structuredContent as { token: string }).token;

    await client.callTool({ name: "wait_for_turn", arguments: { token, timeoutMs: 5000 } });
    const coaching = await client.callTool({ name: "get_coaching", arguments: { token } });
    expect(text(coaching)).toMatch(/Equity/);
    expect(text(coaching)).toMatch(/Suggestion:/);
    expect(text(coaching)).toMatch(/not a solver/);

    await client.close();
  });

  it("reports an illegal action as an error the agent can read", async () => {
    const client = await connect();
    const created = await client.callTool({
      name: "create_table",
      arguments: { bigBlind: 20, bots: ["rock"] },
    });
    const tableId = (created.structuredContent as { table: { id: string } }).table.id;
    const joined = await client.callTool({
      name: "join_table",
      arguments: { tableId, name: "Student", buyIn: 1000 },
    });
    const token = (joined.structuredContent as { token: string }).token;
    await client.callTool({ name: "wait_for_turn", arguments: { token, timeoutMs: 5000 } });

    // Preflop, facing the big blind, checking is not available.
    const bad = await client.callTool({ name: "act", arguments: { token, action: "check" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/cannot check/);

    // And a bet with no amount is refused rather than guessed at.
    const noAmount = await client.callTool({ name: "act", arguments: { token, action: "raise" } });
    expect(noAmount.isError).toBe(true);
    expect(text(noAmount)).toMatch(/needs an amount/);

    await client.close();
  });

  it("never reveals another seat's hole cards through the agent tools", async () => {
    const client = await connect();
    const created = await client.callTool({
      name: "create_table",
      arguments: { bigBlind: 20, bots: ["rock", "station"] },
    });
    const tableId = (created.structuredContent as { table: { id: string } }).table.id;
    const joined = await client.callTool({
      name: "join_table",
      arguments: { tableId, name: "Spy", buyIn: 1000 },
    });
    const seating = joined.structuredContent as { token: string; seat: number };

    await client.callTool({ name: "wait_for_turn", arguments: { token: seating.token, timeoutMs: 5000 } });
    const state = await client.callTool({ name: "get_state", arguments: { token: seating.token } });
    const seats = (state.structuredContent as { state: { seats: Array<{ seat: number; holeCards: unknown; inHand: boolean }> } })
      .state.seats;

    for (const seat of seats) {
      if (seat.seat === seating.seat) expect(seat.holeCards).toHaveLength(2);
      else expect(seat.holeCards).toBeNull();
    }
    await client.close();
  });
});

function text(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((part) => part.text ?? "").join("\n");
}

async function waitForTurn(tableId: string, token: string) {
  return sleepUntil(async () => {
    const { state } = await api<{ state: { legalActions: unknown } }>(
      `/api/tables/${tableId}?token=${encodeURIComponent(token)}`,
    );
    return state.legalActions !== null ? state : null;
  });
}

/** Polls `check` until it returns something truthy, or gives up after 5s. */
async function sleepUntil<T>(check: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deadline) throw new Error("timed out waiting for the table");
    await new Promise((done) => setTimeout(done, 20));
  }
}
