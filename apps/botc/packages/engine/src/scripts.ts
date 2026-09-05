import type { Character, GameScript, Team } from './types.js';

const TEAMS: readonly Team[] = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled'];

const isTeam = (value: unknown): value is Team => TEAMS.includes(value as Team);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** "scarletwoman" -> "Scarletwoman"; only used when a script references an unknown id. */
function humanize(id: string): string {
  const spaced = id.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** An entry that may only carry the fields it wants to change. */
export type PartialCharacter = Partial<Character> & { id: string };

/**
 * Read a character out of a raw script-tool / roles.json entry.
 *
 * Fields the entry does not mention are **left out**, not defaulted — an
 * enrichment file that supplies only ability text must not silently reassign
 * every character to the Townsfolk.
 */
export function parseCharacter(raw: unknown): PartialCharacter | undefined {
  if (!isRecord(raw)) return undefined;
  const id = str(raw['id']);
  if (!id || id === '_meta') return undefined;
  const reminders = Array.isArray(raw['reminders'])
    ? raw['reminders'].filter((r): r is string => typeof r === 'string')
    : undefined;
  const character: PartialCharacter = { id };
  const name = str(raw['name']);
  if (name) character.name = name;
  if (isTeam(raw['team'])) character.team = raw['team'];
  const ability = str(raw['ability']);
  if (ability) character.ability = ability;
  const firstNight = num(raw['firstNight']);
  if (firstNight !== undefined) character.firstNight = firstNight;
  const otherNight = num(raw['otherNight']);
  if (otherNight !== undefined) character.otherNight = otherNight;
  const firstReminder = str(raw['firstNightReminder']);
  if (firstReminder) character.firstNightReminder = firstReminder;
  const otherReminder = str(raw['otherNightReminder']);
  if (otherReminder) character.otherNightReminder = otherReminder;
  if (reminders?.length) character.reminders = reminders;
  if (raw['setup'] === true) character.setup = true;
  return character;
}

/** Fill in the defaults a character needs when nothing else supplied them. */
export function completeCharacter(partial: PartialCharacter): Character {
  return { name: humanize(partial.id), team: 'townsfolk', ...partial };
}

/**
 * Build the id -> character lookup. Later sources win field by field, so a local
 * roles.json can add ability text and night order on top of the shipped index
 * without replacing the names and teams it already knows.
 */
export function buildCharacterIndex(...sources: unknown[][]): Map<string, Character> {
  const index = new Map<string, Character>();
  for (const source of sources) {
    for (const raw of source) {
      const parsed = parseCharacter(raw);
      if (!parsed) continue;
      const existing = index.get(parsed.id);
      index.set(parsed.id, existing ? { ...existing, ...parsed } : completeCharacter(parsed));
    }
  }
  return index;
}

export interface ParsedScript {
  script: GameScript;
  /** Ids the script referenced that the index could not resolve. */
  unresolved: string[];
}

/**
 * Parse a script-tool JSON document: a `_meta` object followed by character ids
 * (resolved against `index`) and/or inline homebrew character objects.
 */
export function parseScript(fallbackId: string, raw: unknown, index: Map<string, Character>): ParsedScript {
  if (!Array.isArray(raw)) throw new Error(`script "${fallbackId}" is not a JSON array`);

  const meta = raw.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry['id'] === '_meta');
  const characters: Character[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    let character: Character | undefined;
    if (typeof entry === 'string') {
      character = index.get(entry);
      if (!character) {
        unresolved.push(entry);
        character = { id: entry, name: humanize(entry), team: 'townsfolk', unresolved: true };
      }
    } else if (isRecord(entry) && entry['id'] !== '_meta') {
      const inline = parseCharacter(entry);
      if (inline) {
        const base = index.get(inline.id);
        character = base ? { ...base, ...inline } : completeCharacter(inline);
      }
    }
    if (!character || seen.has(character.id)) continue;
    seen.add(character.id);
    characters.push(character);
  }

  const script: GameScript = {
    id: fallbackId,
    name: str(meta?.['name']) ?? humanize(fallbackId),
    characters,
  };
  const author = str(meta?.['author']);
  if (author) script.author = author;
  const description = str(meta?.['description']);
  if (description) script.description = description;
  const edition = str(meta?.['edition']);
  if (edition) script.edition = edition;

  return { script, unresolved };
}

/** Characters that act at night, in the order the Storyteller should call them. */
export function nightOrder(script: GameScript, firstNight: boolean): Character[] {
  const key = firstNight ? 'firstNight' : 'otherNight';
  return script.characters
    .filter((c) => typeof c[key] === 'number' && (c[key] as number) > 0)
    .sort((a, b) => (a[key] as number) - (b[key] as number));
}

/** Recommended town composition, straight from the rulebook's setup table. */
export function setupCounts(players: number): {
  townsfolk: number;
  outsiders: number;
  minions: number;
  demons: number;
} {
  const clamped = Math.max(5, Math.min(15, Math.trunc(players)));
  // 5 and 6 players are their own case; from 7 up the table repeats every 3.
  if (clamped === 5) return { townsfolk: 3, outsiders: 0, minions: 1, demons: 1 };
  if (clamped === 6) return { townsfolk: 3, outsiders: 1, minions: 1, demons: 1 };
  const outsiders = (clamped - 7) % 3;
  const minions = Math.floor((clamped - 7) / 3) + 1;
  return { townsfolk: clamped - outsiders - minions - 1, outsiders, minions, demons: 1 };
}
