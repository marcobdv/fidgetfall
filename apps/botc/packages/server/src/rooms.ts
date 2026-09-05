import { randomBytes, randomUUID } from 'node:crypto';
import { Game, buildView, type AnyEvent, type GameScript, type SeatKind, type Viewer } from '@botc/engine';

export interface Session {
  token: string;
  gameId: string;
  seatId: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function joinCode(): string {
  const bytes = randomBytes(4);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export class Room {
  readonly game: Game;
  private readonly listeners = new Set<() => void>();
  private clock: ReturnType<typeof setInterval> | undefined;

  constructor(game: Game) {
    this.game = game;
  }

  /**
   * The engine has no timer of its own, so the room ticks it. Only runs while a
   * clock is actually configured, and stops itself when the game ends.
   */
  startClock(intervalMs = 1000): void {
    if (this.clock) return;
    this.clock = setInterval(() => {
      if (this.game.state.phase === 'over') {
        this.stopClock();
        return;
      }
      if (this.game.tick(Date.now())) this.notify();
    }, intervalMs);
    this.clock.unref?.();
  }

  stopClock(): void {
    if (!this.clock) return;
    clearInterval(this.clock);
    this.clock = undefined;
  }

  get id(): string {
    return this.game.state.id;
  }

  viewerFor(seatId: string): Viewer {
    return seatId === this.game.state.storytellerSeatId
      ? { kind: 'storyteller' }
      : { kind: 'seat', seatId };
  }

  view(seatId: string | null) {
    return buildView(this.game, seatId ? this.viewerFor(seatId) : { kind: 'spectator' });
  }

  events(seatId: string | null, since: number): AnyEvent[] {
    return this.game.eventsSince(since, seatId ? this.viewerFor(seatId) : { kind: 'spectator' });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True while a browser is still attached to this game. */
  get hasListeners(): boolean {
    return this.listeners.size > 0;
  }

  notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[room] listener failed', error);
      }
    }
  }

  /** Resolve once the log has grown past `cursor`, or after `timeoutMs`. */
  waitForEvents(cursor: number, timeoutMs: number): Promise<void> {
    if (this.game.log.length > cursor) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, timeoutMs));
      timer.unref?.();
      const unsubscribe = this.subscribe(() => {
        if (this.game.log.length > cursor) done();
      });
    });
  }
}

export interface CreateGameInput {
  name: string;
  script: GameScript;
  storytellerName: string;
  storytellerKind?: SeatKind;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<string, Session>();

  create(input: CreateGameInput): { room: Room; session: Session } {
    const id = randomUUID().slice(0, 8);
    const game = new Game({
      id,
      name: input.name,
      joinCode: joinCode(),
      script: input.script,
      storytellerName: input.storytellerName,
      ...(input.storytellerKind ? { storytellerKind: input.storytellerKind } : {}),
    });
    const room = new Room(game);
    room.startClock();
    this.rooms.set(id, room);
    const session = this.issue(room, game.state.storytellerSeatId);
    return { room, session };
  }

  issue(room: Room, seatId: string): Session {
    const session: Session = { token: randomUUID().replace(/-/g, ''), gameId: room.id, seatId };
    this.sessions.set(session.token, session);
    return session;
  }

  session(token: string | undefined | null): Session | undefined {
    if (!token) return undefined;
    return this.sessions.get(token);
  }

  /** Resolve a token to its room and seat in one step. */
  resolve(token: string | undefined | null): { room: Room; session: Session } | undefined {
    const session = this.session(token);
    if (!session) return undefined;
    const room = this.rooms.get(session.gameId);
    if (!room) return undefined;
    return { room, session };
  }

  byId(gameId: string): Room | undefined {
    return this.rooms.get(gameId);
  }

  byJoinCode(code: string): Room | undefined {
    const wanted = code.trim().toUpperCase();
    return [...this.rooms.values()].find((r) => r.game.state.joinCode === wanted);
  }

  /** Accepts either a game id or a join code. */
  find(idOrCode: string): Room | undefined {
    return this.byId(idOrCode) ?? this.byJoinCode(idOrCode);
  }

  list(): Room[] {
    return [...this.rooms.values()].sort((a, b) => b.game.state.createdAt - a.game.state.createdAt);
  }

  /** Drop games that have been over or idle for longer than `maxIdleMs`. */
  sweep(maxIdleMs: number, now = Date.now()): number {
    let removed = 0;
    for (const room of this.rooms.values()) {
      if (room.hasListeners) continue;
      const last = room.game.log.at(-1)?.at ?? room.game.state.createdAt;
      if (now - last < maxIdleMs) continue;
      for (const [token, session] of this.sessions) {
        if (session.gameId === room.id) this.sessions.delete(token);
      }
      room.stopClock();
      this.rooms.delete(room.id);
      removed += 1;
    }
    return removed;
  }
}
