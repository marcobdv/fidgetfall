import { appendFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyEvent, GameScript } from '@botc/engine';

/**
 * Every event a game produces, appended to disk as it happens.
 *
 * Games used to live only in memory, so a chronicle was rendered once and the
 * material it came from died with the process. That made the chronicle a
 * one-shot artefact: six renderer fixes in a single afternoon could not be
 * applied to a single game already played, and a restarted container took the
 * record with it. One line of JSON per event fixes that for the cost of a file
 * handle, and the chronicle becomes a view of something durable rather than the
 * only copy.
 */
export class Journal {
  private readonly dir: string;

  constructor(root: string) {
    this.dir = join(root, 'games');
    mkdirSync(this.dir, { recursive: true });
  }

  private file(gameId: string): string {
    return join(this.dir, `${gameId}.jsonl`);
  }

  /** Written once, first line, so a replay knows what script to parse against. */
  open(gameId: string, header: { name: string; scriptId: string; startedAt: number }): void {
    if (existsSync(this.file(gameId))) return;
    this.write(gameId, { kind: 'header', ...header });
  }

  append(gameId: string, event: AnyEvent): void {
    this.write(gameId, { kind: 'event', event });
  }

  /** The engine's own state, so a replay never has to re-derive the rules. */
  snapshot(gameId: string, snapshot: unknown): void {
    this.write(gameId, { kind: 'snapshot', snapshot });
  }

  /** The most recent snapshot on file, which is the one to restore from. */
  latestSnapshot(gameId: string): unknown {
    const rows = this.rows(gameId).filter((r) => r['kind'] === 'snapshot');
    return rows.length ? rows[rows.length - 1]?.['snapshot'] : undefined;
  }

  private write(gameId: string, row: unknown): void {
    try {
      appendFileSync(this.file(gameId), `${JSON.stringify(row)}\n`);
    } catch (error) {
      // A game must never die because a disk did. Losing the record is bad;
      // losing the game in progress is worse.
      console.error(`[journal] ${gameId}: ${(error as Error).message}`);
    }
  }

  list(): { gameId: string; name: string; scriptId: string; startedAt: number; events: number }[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const gameId = f.replace(/\.jsonl$/, '');
        const rows = this.rows(gameId);
        const header = rows.find((r) => r['kind'] === 'header') as Record<string, unknown> | undefined;
        return {
          gameId,
          name: String(header?.['name'] ?? gameId),
          scriptId: String(header?.['scriptId'] ?? '?'),
          startedAt: Number(header?.['startedAt'] ?? 0),
          events: rows.filter((r) => r['kind'] === 'event').length,
        };
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  private rows(gameId: string): Record<string, unknown>[] {
    if (!existsSync(this.file(gameId))) return [];
    return readFileSync(this.file(gameId), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          // A half-written last line after a crash costs that line, not the game.
          return [];
        }
      });
  }

  /** The events of a finished game, ready to be re-rendered by today's chronicle. */
  events(gameId: string): AnyEvent[] {
    return this.rows(gameId)
      .filter((r) => r['kind'] === 'event')
      .map((r) => r['event'] as AnyEvent);
  }

  header(gameId: string): { name: string; scriptId: string } | undefined {
    const row = this.rows(gameId).find((r) => r['kind'] === 'header');
    if (!row) return undefined;
    return { name: String(row['name']), scriptId: String(row['scriptId']) };
  }
}

export type { GameScript };
