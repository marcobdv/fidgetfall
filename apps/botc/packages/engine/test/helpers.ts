import { Game } from '../src/game.js';
import { parseScript, buildCharacterIndex } from '../src/scripts.js';
import type { GameScript, Seat } from '../src/types.js';

export const demoScript: GameScript = parseScript(
  'demo',
  [
    { id: '_meta', name: 'Demo Script' },
    { id: 'seer', name: 'Seer', team: 'townsfolk', ability: 'Each night, learn a thing.', firstNight: 10, otherNight: 10 },
    { id: 'smith', name: 'Smith', team: 'townsfolk', ability: 'You are hard to kill.' },
    { id: 'baker', name: 'Baker', team: 'townsfolk', ability: 'You bake.' },
    { id: 'oaf', name: 'Oaf', team: 'outsider', ability: 'You are clumsy.' },
    { id: 'thief', name: 'Thief', team: 'minion', ability: 'You steal.', otherNight: 5 },
    { id: 'wraith', name: 'Wraith', team: 'demon', ability: 'Each night*, choose a player: they die.', otherNight: 20 },
    { id: 'pilgrim', name: 'Pilgrim', team: 'traveller', ability: 'You wander.' },
  ],
  buildCharacterIndex(),
).script;

let counter = 0;

export interface Table {
  game: Game;
  st: Seat;
  seats: Seat[];
  byName: (name: string) => Seat;
}

/** A started game with `names` seated and the given characters assigned. */
export function table(names: string[], characters: Record<string, string> = {}): Table {
  counter = 0;
  const game = new Game({
    id: 'g1',
    name: 'Test Town',
    joinCode: 'ABCD',
    script: demoScript,
    storytellerName: 'ST',
    now: () => 1_700_000_000_000,
    makeId: (prefix) => `${prefix}${++counter}`,
  });
  const seats = names.map((name) => {
    const result = game.join(name, 'agent');
    if (!result.ok) throw new Error(result.error);
    return result.value;
  });
  const st = game.storyteller;
  const started = game.stStart(st.id);
  if (!started.ok) throw new Error(started.error);
  for (const [name, characterId] of Object.entries(characters)) {
    const seat = seats.find((s) => s.name === name);
    if (!seat) throw new Error(`no seat named ${name}`);
    const assigned = game.stAssignCharacter(st.id, seat.id, characterId);
    if (!assigned.ok) throw new Error(assigned.error);
  }
  return {
    game,
    st,
    seats,
    byName: (name) => {
      const seat = seats.find((s) => s.name === name);
      if (!seat) throw new Error(`no seat named ${name}`);
      return seat;
    },
  };
}

export function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.value;
}

export function expectErr(result: { ok: boolean; error?: string }): string {
  if (result.ok) throw new Error('expected an error, got ok');
  return result.error ?? '';
}

/** Walk to the nominations phase of the current day. */
export function toNominations(t: Table): void {
  while (t.game.state.phase !== 'nominations') expectOk(t.game.stAdvancePhase(t.st.id));
}
