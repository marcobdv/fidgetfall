import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { describeEvent } from '@botc/engine';
import { CommandSchema, execute } from './commands.js';
import type { Room, RoomManager } from './rooms.js';

interface Envelope {
  id?: string;
  type: string;
  [key: string]: unknown;
}

/**
 * The human transport. Each socket is one seat; it receives the events that seat
 * is allowed to see, plus a refreshed view after every change.
 */
export function attachWebSocket(server: Server, rooms: RoomManager): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const resolved = rooms.resolve(url.searchParams.get('token'));
    if (!resolved) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
      open(ws, resolved.room, resolved.session.seatId);
    });
  });

  return wss;
}

function open(ws: WebSocket, room: Room, seatId: string): void {
  let cursor = 0;

  const send = (message: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };

  const flush = () => {
    const fresh = room.events(seatId, cursor);
    if (fresh.length) {
      cursor = fresh[fresh.length - 1]?.seq ?? cursor;
      send({
        type: 'events',
        events: fresh.map((event) => ({ ...event, text: describeEvent(room.game, event) })),
      });
    }
    send({ type: 'state', view: room.view(seatId) });
  };

  room.game.setConnected(seatId, true);
  const unsubscribe = room.subscribe(flush);
  flush();
  room.notify();

  ws.on('message', (raw) => {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(String(raw)) as Envelope;
    } catch {
      send({ type: 'error', error: 'malformed message' });
      return;
    }
    if (envelope.type === 'ping') {
      send({ type: 'pong' });
      return;
    }
    if (envelope.type === 'sync') {
      cursor = typeof envelope['since'] === 'number' ? envelope['since'] : 0;
      flush();
      return;
    }
    if (envelope.type !== 'command') {
      send({ type: 'error', id: envelope.id, error: `unknown message type "${envelope.type}"` });
      return;
    }
    const parsed = CommandSchema.safeParse(envelope['command']);
    if (!parsed.success) {
      send({ type: 'error', id: envelope.id, error: parsed.error.issues[0]?.message ?? 'invalid command' });
      return;
    }
    const result = execute(room, seatId, parsed.data);
    if (result.ok) send({ type: 'ok', id: envelope.id });
    else send({ type: 'error', id: envelope.id, error: result.error });
    flush();
  });

  ws.on('close', () => {
    unsubscribe();
    room.game.setConnected(seatId, false);
    room.notify();
  });
}
