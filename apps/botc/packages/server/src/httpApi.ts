import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import type { Config } from './config.js';
import { writeChronicle } from '@botc/engine';
import { writeBriefing } from './briefing.js';
import type { RoomManager, Room } from './rooms.js';
import type { ScriptStore } from './scriptStore.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const MAX_BODY = 64 * 1024;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim() : fallback;

function roomSummary(room: Room) {
  const state = room.game.state;
  return {
    id: state.id,
    name: state.name,
    joinCode: state.joinCode,
    phase: state.phase,
    day: state.day,
    script: { id: state.script.id, name: state.script.name },
    players: room.game.players().length,
    storyteller: room.game.storyteller.name,
    createdAt: state.createdAt,
  };
}

export interface ApiDeps {
  config: Config;
  rooms: RoomManager;
  scripts: ScriptStore;
}

/** Returns true when the request was handled. */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: ApiDeps,
): Promise<boolean> {
  const { rooms, scripts, config } = deps;
  const path = url.pathname;
  if (!path.startsWith('/api/')) return false;

  try {
    if (req.method === 'GET' && path === '/api/health') {
      sendJson(res, 200, { ok: true, games: rooms.list().length, scripts: scripts.list().length });
      return true;
    }

    if (req.method === 'GET' && path === '/api/scripts') {
      sendJson(res, 200, { scripts: scripts.summaries() });
      return true;
    }

    if (req.method === 'GET' && path.startsWith('/api/scripts/')) {
      const stored = scripts.get(decodeURIComponent(path.slice('/api/scripts/'.length)));
      if (!stored) {
        sendJson(res, 404, { error: 'no such script' });
        return true;
      }
      sendJson(res, 200, { script: stored.script, unresolved: stored.unresolved });
      return true;
    }

    if (req.method === 'GET' && path === '/api/games') {
      sendJson(res, 200, { games: rooms.list().map(roomSummary) });
      return true;
    }

    if (req.method === 'POST' && path === '/api/games') {
      const body = (await readBody(req)) as Record<string, unknown>;
      if (config.adminToken && asString(body['adminToken']) !== config.adminToken) {
        sendJson(res, 403, { error: 'a valid adminToken is required to create a game' });
        return true;
      }
      const scriptId = asString(body['scriptId']);
      const stored = scripts.get(scriptId);
      if (!stored) {
        sendJson(res, 400, { error: `no such script "${scriptId}"`, available: scripts.summaries().map((s) => s.id) });
        return true;
      }
      const storytellerName = asString(body['storytellerName'], 'Storyteller') || 'Storyteller';
      const { room, session } = rooms.create({
        name: asString(body['name'], stored.script.name) || stored.script.name,
        script: stored.script,
        storytellerName,
        storytellerKind: body['storytellerKind'] === 'agent' ? 'agent' : 'human',
      });
      sendJson(res, 201, {
        gameId: room.id,
        joinCode: room.game.state.joinCode,
        token: session.token,
        seatId: session.seatId,
        isStoryteller: true,
      });
      return true;
    }

    const joinMatch = /^\/api\/games\/([^/]+)\/join$/.exec(path);
    if (req.method === 'POST' && joinMatch?.[1]) {
      const room = rooms.find(decodeURIComponent(joinMatch[1]));
      if (!room) {
        sendJson(res, 404, { error: 'no such game' });
        return true;
      }
      const body = (await readBody(req)) as Record<string, unknown>;
      const joined = room.game.join(asString(body['name']), body['kind'] === 'agent' ? 'agent' : 'human');
      if (!joined.ok) {
        sendJson(res, 400, { error: joined.error });
        return true;
      }
      const session = rooms.issue(room, joined.value.id);
      room.notify();
      sendJson(res, 201, {
        gameId: room.id,
        token: session.token,
        seatId: session.seatId,
        seatIndex: joined.value.index,
        isStoryteller: false,
      });
      return true;
    }

    // The seat's system prompt. `?format=text` returns it raw, ready to paste into
    // a harness; otherwise JSON for the web client.
    if (req.method === 'GET' && (path === '/api/briefing' || path === '/api/recap')) {
      const resolved = rooms.resolve(url.searchParams.get('token'));
      if (!resolved) {
        sendJson(res, 401, { error: 'unknown or expired token' });
        return true;
      }
      const body =
        path === '/api/briefing'
          ? writeBriefing(resolved.room, resolved.session.seatId)
          : writeChronicle(
              resolved.room.game,
              resolved.room.viewerFor(resolved.session.seatId),
            );
      if (url.searchParams.get('format') === 'text') {
        const payload = Buffer.from(body, 'utf8');
        res.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-length': payload.length,
          'cache-control': 'no-store',
        });
        res.end(payload);
        return true;
      }
      sendJson(res, 200, { text: body });
      return true;
    }

    if (req.method === 'GET' && path === '/api/state') {
      const resolved = rooms.resolve(url.searchParams.get('token'));
      if (!resolved) {
        sendJson(res, 401, { error: 'unknown or expired token' });
        return true;
      }
      const since = Number(url.searchParams.get('since') ?? '0') || 0;
      sendJson(res, 200, {
        view: resolved.room.view(resolved.session.seatId),
        events: resolved.room.events(resolved.session.seatId, since),
      });
      return true;
    }

    sendJson(res, 404, { error: 'no such endpoint' });
    return true;
  } catch (error) {
    sendJson(res, 400, { error: (error as Error).message });
    return true;
  }
}

/** Serve the static town-square client. */
export function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL, root: string): void {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safe = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const file = resolve(join(root, safe));
  if (!file.startsWith(resolve(root)) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}
