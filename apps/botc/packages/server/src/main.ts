import { createServer, type IncomingMessage } from 'node:http';
import { loadConfig } from './config.js';
import { handleApi, sendJson, serveStatic } from './httpApi.js';
import { handleMcpRequest } from './mcp.js';
import { RoomManager } from './rooms.js';
import { ScriptStore } from './scriptStore.js';
import { attachWebSocket } from './wsApi.js';
import { Journal } from './journal.js';

const MAX_MCP_BODY = 1024 * 1024;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const GAME_TTL_MS = 12 * 60 * 60 * 1000;

async function readRawBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_MCP_BODY) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export interface StartedServer {
  port: number;
  rooms: RoomManager;
  scripts: ScriptStore;
  close: () => Promise<void>;
}

export async function start(overrides: NodeJS.ProcessEnv = {}): Promise<StartedServer> {
  const config = loadConfig({ ...process.env, ...overrides });
  const scripts = new ScriptStore(config);
  // Games used to be memory-only, so a restart took the record with it and a
  // renderer fix could never reach a game already played. Every event is now on
  // disk; BOTC_JOURNAL_DIR=off opts out.
  const journalDir = config.journalDir;
  const rooms = new RoomManager(journalDir ? new Journal(journalDir) : undefined);
  const deps = { config, rooms, scripts };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    void (async () => {
      try {
        if (url.pathname === '/mcp') {
          const body = req.method === 'POST' ? await readRawBody(req) : undefined;
          await handleMcpRequest(req, res, body, deps);
          return;
        }
        if (await handleApi(req, res, url, deps)) return;
        serveStatic(req, res, url, config.clientDir);
      } catch (error) {
        console.error('[http]', error);
        if (!res.headersSent) sendJson(res, 500, { error: (error as Error).message });
        else res.end();
      }
    })();
  });

  attachWebSocket(server, rooms);

  const sweeper = setInterval(() => {
    const removed = rooms.sweep(GAME_TTL_MS);
    if (removed) console.log(`[rooms] swept ${removed} idle game(s)`);
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;

  console.log(`[botc] town square   http://localhost:${port}/`);
  console.log(`[botc] agent MCP     http://localhost:${port}/mcp`);
  console.log(
    `[botc] scripts       ${scripts.list().map((s) => s.script.id).join(', ') || '(none — check data/scripts)'}`,
  );
  for (const stored of scripts.list()) {
    if (stored.unresolved.length) {
      console.warn(`[botc] ${stored.script.id}: unknown character ids ${stored.unresolved.join(', ')}`);
    }
  }

  return {
    port,
    rooms,
    scripts,
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearInterval(sweeper);
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const isEntryPoint = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
