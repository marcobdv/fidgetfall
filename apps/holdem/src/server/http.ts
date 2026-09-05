/**
 * The table server: a REST API for creating and playing at tables, a WebSocket
 * that pushes each seat its own view, static hosting for the browser client,
 * and an MCP endpoint at `/mcp` so agents can sit down at the same tables.
 *
 * It is deliberately plain `node:http` — no framework — because the whole
 * surface is a dozen routes and the dependency is not worth it.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BOT_POLICIES } from "../bots/policies.js";
import { markPracticeSpot, practiceSpot } from "../coach/drill.js";
import { LocalRoomClient } from "../shared/client.js";
import { buildMcpServer } from "../mcp/tools.js";
import { PokerRoom, type CreateTableOptions } from "./room.js";
import type { Action, ActionType } from "../engine/types.js";

const PUBLIC_DIR = resolvePath(fileURLToPath(new URL("../../public", import.meta.url)));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

export interface ServerOptions {
  port?: number;
  host?: string;
  room?: PokerRoom;
  /** How often the room clock advances, in ms. */
  tickMs?: number;
}

export interface RunningServer {
  server: Server;
  room: PokerRoom;
  port: number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 256 * 1024;

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const room = options.room ?? new PokerRoom();
  const client = new LocalRoomClient(room);
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";

  const server = createServer((req, res) => {
    handle(req, res, room, client).catch((error) => {
      sendError(res, error);
    });
  });

  // ---- WebSocket: one connection per open table view -----------------------

  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Map<WebSocket, { tableId: string; token?: string }>();

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const tableId = url.searchParams.get("table") ?? "";
    const token = url.searchParams.get("token") ?? undefined;

    try {
      room.getTable(tableId);
    } catch {
      socket.close(4004, "no such table");
      return;
    }

    sockets.set(socket, { tableId, token });
    push(socket, tableId, token);

    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {
      sockets.delete(socket);
    });
  });

  function push(socket: WebSocket, tableId: string, token?: string): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify({ type: "state", state: room.view(tableId, token) }));
    } catch {
      // A dead socket is cleaned up by its own close handler.
    }
  }

  room.onChange((tableId) => {
    for (const [socket, binding] of sockets) {
      if (binding.tableId === tableId) push(socket, tableId, binding.token);
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  // ---- the room clock -----------------------------------------------------

  const tickMs = options.tickMs ?? 250;
  const ticker = setInterval(() => {
    try {
      room.tick(Date.now());
    } catch (error) {
      console.error("[holdem] tick failed:", error);
    }
  }, tickMs);
  ticker.unref();

  await new Promise<void>((ready) => server.listen(port, host, ready));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    room,
    port: actualPort,
    async close() {
      clearInterval(ticker);
      for (const socket of sockets.keys()) socket.close();
      wss.close();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

// --------------------------------------------------------------------- routes

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  room: PokerRoom,
  client: LocalRoomClient,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // The browser client is served from the same origin, so CORS only matters for
  // remote MCP clients, which need it to reach /mcp.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, mcp-protocol-version, accept");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  if (method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (path === "/mcp") {
    await handleMcp(req, res, client);
    return;
  }

  if (!path.startsWith("/api/")) {
    serveStatic(path, res);
    return;
  }

  // ---- collection routes --------------------------------------------------

  if (path === "/api/health") {
    return sendJson(res, 200, { ok: true, tables: room.listTables().length });
  }

  if (path === "/api/bots") {
    return sendJson(res, 200, {
      bots: Object.values(BOT_POLICIES).map((p) => ({ id: p.id, label: p.label, blurb: p.blurb })),
    });
  }

  if (path === "/api/practice" && method === "GET") {
    const seedParam = url.searchParams.get("seed");
    const seed = seedParam === null ? (Math.random() * 0x7fffffff) | 0 : asInt(seedParam, "seed");
    // The spot goes out without its answers; marking rebuilds it from the seed.
    return sendJson(res, 200, { seed, spot: practiceSpot(seed) });
  }

  if (path === "/api/practice/check" && method === "POST") {
    const body = await readJson(req);
    const seed = asInt(body.seed, "seed");
    return sendJson(res, 200, {
      seed,
      spot: practiceSpot(seed),
      marking: markPracticeSpot(seed, drillAnswerFrom(body)),
    });
  }

  if (path === "/api/tables" && method === "GET") {
    return sendJson(res, 200, { tables: room.listTables() });
  }

  if (path === "/api/tables" && method === "POST") {
    const body = await readJson(req);
    const table = room.createTable(tableOptionsFrom(body));
    return sendJson(res, 201, { table: room.listTables().find((t) => t.id === table.config.id) });
  }

  const tableMatch = /^\/api\/tables\/([A-Za-z0-9_-]{1,32})(\/[a-z]+)?$/.exec(path);
  if (!tableMatch) {
    return sendJson(res, 404, { error: `no route for ${method} ${path}` });
  }

  const tableId = tableMatch[1]!;
  const action = (tableMatch[2] ?? "").replace("/", "");

  switch (`${method} ${action}`) {
    case "GET ": {
      const token = url.searchParams.get("token") ?? undefined;
      // A caller that supplies a token expects a seat's view. If the token is
      // dead, say so rather than quietly handing back a spectator's view — an
      // agent would otherwise see an empty hand and think it had been dealt one.
      if (token !== undefined) room.resolve(token);
      return sendJson(res, 200, { state: room.view(tableId, token) });
    }

    case "POST join": {
      const body = await readJson(req);
      const seating = room.join(tableId, {
        name: asString(body.name, "name"),
        kind: body.kind === "agent" ? "agent" : "human",
        buyIn: body.buyIn === undefined ? undefined : asInt(body.buyIn, "buyIn"),
        seat: body.seat === undefined ? undefined : asInt(body.seat, "seat"),
      });
      return sendJson(res, 201, { seating, state: room.view(tableId, seating.token) });
    }

    case "POST leave": {
      const body = await readJson(req);
      room.leave(asString(body.token, "token"));
      return sendJson(res, 200, { ok: true });
    }

    case "POST act": {
      const body = await readJson(req);
      const token = asString(body.token, "token");
      room.act(token, parseAction(body));
      return sendJson(res, 200, { state: room.view(tableId, token) });
    }

    case "GET coach": {
      const token = asString(url.searchParams.get("token"), "token");
      return sendJson(res, 200, { advice: room.advise(token) });
    }

    case "GET quiz": {
      const token = asString(url.searchParams.get("token"), "token");
      return sendJson(res, 200, { quiz: room.quiz(token) });
    }

    case "POST quiz": {
      const body = await readJson(req);
      const token = asString(body.token, "token");
      const key = asString(body.key, "key");
      return sendJson(res, 200, room.markQuiz(token, key, drillAnswerFrom(body)));
    }

    case "GET review": {
      const token = asString(url.searchParams.get("token"), "token");
      const handParam = url.searchParams.get("hand");
      const review = room.review(token, handParam ? Number(handParam) : undefined);
      return sendJson(res, 200, { review });
    }

    case "POST bots": {
      const body = await readJson(req);
      const seating = room.addBot(
        tableId,
        asString(body.bot, "bot"),
        body.seat === undefined ? undefined : asInt(body.seat, "seat"),
      );
      return sendJson(res, 201, { seating: { seat: seating.seat } });
    }

    case "POST sitout": {
      const body = await readJson(req);
      room.setSittingOut(asString(body.token, "token"), body.sittingOut !== false);
      return sendJson(res, 200, { ok: true });
    }

    case "POST topup": {
      const body = await readJson(req);
      room.topUp(asString(body.token, "token"), asInt(body.amount, "amount"));
      return sendJson(res, 200, { ok: true });
    }

    case "POST kick": {
      const body = await readJson(req);
      const removed = room.removeBot(tableId, asInt(body.seat, "seat"));
      return sendJson(res, removed ? 200 : 404, { removed });
    }

    default:
      return sendJson(res, 404, { error: `no route for ${method} ${path}` });
  }
}

/**
 * Stateless MCP over streamable HTTP: a fresh server and transport per request.
 * Seat identity lives in the token an agent passes to each tool, not in an MCP
 * session, so there is no session state worth keeping between calls.
 */
async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  client: LocalRoomClient,
): Promise<void> {
  if (req.method === "GET" || req.method === "DELETE") {
    // No server-initiated stream and nothing to tear down in stateless mode.
    res.writeHead(405, { "content-type": "application/json" }).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "this MCP endpoint is stateless; POST requests only" },
        id: null,
      }),
    );
    return;
  }

  const body = await readJson(req);
  const server = buildMcpServer(client);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

// ------------------------------------------------------------------- plumbing

function serveStatic(path: string, res: ServerResponse): void {
  const relative = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  // normalize() collapses any "..", and the prefix check rejects what is left.
  const target = normalize(join(PUBLIC_DIR, relative));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function sendError(res: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // Every error this server raises is a rejected request, not a crash: the
  // engine refuses illegal actions rather than entering a bad state.
  const status = /no such table|not found|no route/i.test(message) ? 404 : 400;
  if (!res.headersSent) sendJson(res, status, { error: message });
  else res.end();
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) throw new Error("expected a JSON object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`invalid JSON body: ${error instanceof Error ? error.message : error}`);
  }
}

export function tableOptionsFrom(body: Record<string, unknown>): CreateTableOptions {
  const options: CreateTableOptions = {};
  if (body.name !== undefined) options.name = asString(body.name, "name");
  if (body.smallBlind !== undefined) options.smallBlind = asInt(body.smallBlind, "smallBlind");
  if (body.bigBlind !== undefined) options.bigBlind = asInt(body.bigBlind, "bigBlind");
  if (body.ante !== undefined) options.ante = asInt(body.ante, "ante");
  if (body.maxSeats !== undefined) options.maxSeats = asInt(body.maxSeats, "maxSeats");
  if (body.minBuyIn !== undefined) options.minBuyIn = asInt(body.minBuyIn, "minBuyIn");
  if (body.maxBuyIn !== undefined) options.maxBuyIn = asInt(body.maxBuyIn, "maxBuyIn");
  if (body.actionTimeoutMs !== undefined) {
    options.actionTimeoutMs = asInt(body.actionTimeoutMs, "actionTimeoutMs");
  }
  if (body.coaching !== undefined) options.coaching = body.coaching !== false;
  if (body.revealShowdown !== undefined) options.revealShowdown = body.revealShowdown !== false;
  if (body.bots !== undefined) {
    if (!Array.isArray(body.bots)) throw new Error("bots must be an array of archetype names");
    options.bots = body.bots.map((bot, i) => asString(bot, `bots[${i}]`));
  }
  return options;
}

const ACTION_TYPES: ActionType[] = ["fold", "check", "call", "bet", "raise"];

export function parseAction(body: Record<string, unknown>): Action {
  const raw = asString(body.action, "action").toLowerCase();

  // "all-in" is not an engine action; it is whichever aggressive action is
  // legal, at the largest legal size. The caller must supply the amount, so we
  // only translate the word here and let the engine bound it.
  if (!ACTION_TYPES.includes(raw as ActionType)) {
    throw new Error(`action must be one of ${ACTION_TYPES.join(", ")}`);
  }
  const type = raw as ActionType;
  if (type !== "bet" && type !== "raise") return { type };
  return { type, amount: asInt(body.amount, "amount") };
}

/** Reads a drill attempt. Every field is optional — an unanswered question is
 * marked as unanswered rather than rejected, so a player can skip one. */
function drillAnswerFrom(body: Record<string, unknown>) {
  const optionalInt = (value: unknown, field: string) =>
    value === undefined || value === null || value === "" ? undefined : asInt(value, field);

  const cards = body.outCards;
  return {
    outs: optionalInt(body.outs, "outs"),
    ruleOfThumbPct: optionalInt(body.ruleOfThumbPct, "ruleOfThumbPct"),
    breakEvenPct: optionalInt(body.breakEvenPct, "breakEvenPct"),
    outCards: Array.isArray(cards)
      ? cards.slice(0, 52).map((card, i) => asString(card, `outCards[${i}]`))
      : undefined,
  };
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value;
}

function asInt(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    throw new Error(`${field} must be a whole number`);
  }
  return parsed;
}
