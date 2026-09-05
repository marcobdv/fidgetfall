import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildCharacterIndex, parseScript, type Character, type GameScript } from '@botc/engine';
import type { Config } from './config.js';

export interface StoredScript {
  script: GameScript;
  unresolved: string[];
  file: string;
}

/**
 * Every `*.json` under data/scripts, parsed against the character index. Scripts
 * dropped into that folder are picked up on the next restart.
 */
export class ScriptStore {
  private readonly scripts = new Map<string, StoredScript>();
  readonly characters: Map<string, Character>;

  constructor(private readonly config: Config) {
    const indexSources: unknown[][] = [];
    const charactersDir = join(config.dataDir, 'characters');
    if (existsSync(charactersDir)) {
      for (const file of readdirSync(charactersDir).filter((f) => f.endsWith('.json')).sort()) {
        indexSources.push(readJsonArray(join(charactersDir, file)));
      }
    }
    if (config.rolesFile && existsSync(config.rolesFile)) {
      indexSources.push(readJsonArray(config.rolesFile));
    }
    this.characters = buildCharacterIndex(...indexSources);
    this.reload();
  }

  reload(): void {
    this.scripts.clear();
    const dir = join(this.config.dataDir, 'scripts');
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const id = file.replace(/\.json$/, '');
      try {
        const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
        const parsed = parseScript(id, raw, this.characters);
        // Travellers do not belong to a script. They are a shared pool the
        // Storyteller can seat on top of any of them, which is how they work at a
        // table, so every script is offered every traveller the index knows about.
        const named = new Set(parsed.script.characters.map((c) => c.id));
        const characters = [
          ...parsed.script.characters,
          ...this.travellers().filter((c) => !named.has(c.id)),
        ];
        this.scripts.set(id, { ...parsed, script: { ...parsed.script, characters }, file });
      } catch (error) {
        console.error(`[scripts] skipping ${file}: ${(error as Error).message}`);
      }
    }
  }

  /** The shared traveller pool, available on top of every script. */
  travellers(): Character[] {
    return [...this.characters.values()].filter((c) => c.team === 'traveller');
  }

  list(): StoredScript[] {
    return [...this.scripts.values()].sort((a, b) => a.script.name.localeCompare(b.script.name));
  }

  get(id: string): StoredScript | undefined {
    return this.scripts.get(id);
  }

  /** Compact listing for the lobby and for agents choosing a script. */
  summaries(): {
    id: string;
    name: string;
    author?: string;
    description?: string;
    characters: number;
    travellers: number;
    hasAbilityText: boolean;
  }[] {
    return this.list().map(({ script }) => ({
      id: script.id,
      name: script.name,
      ...(script.author ? { author: script.author } : {}),
      ...(script.description ? { description: script.description } : {}),
      // The count is the script itself; travellers are common to all of them.
      characters: script.characters.filter((c) => c.team !== 'traveller').length,
      travellers: script.characters.filter((c) => c.team === 'traveller').length,
      hasAbilityText: script.characters.some((c) => c.team !== 'traveller' && Boolean(c.ability)),
    }));
  }
}

function readJsonArray(path: string): unknown[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`[characters] skipping ${path}: ${(error as Error).message}`);
    return [];
  }
}
