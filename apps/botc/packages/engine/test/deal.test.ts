import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { rngFrom, shuffle } from '../src/deal.js';
import { buildView } from '../src/views.js';
import { writeChronicle } from '../src/chronicle.js';
import { demoScript, expectOk, expectErr } from './helpers.js';

/**
 * Dealing the bag. At a table the Storyteller picks the tokens and then stops
 * choosing — players draw, so adjacency falls where it falls. These tests are
 * about that second half: that the Storyteller cannot pick the seating, and that
 * the record afterwards says whether they did.
 */

let counter = 0;

/** A lobby with `names` seated and nothing assigned yet. */
function lobby(names: string[]) {
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
  const seats = names.map((name) => expectOk(game.join(name, 'agent')));
  return { game, st: game.storyteller, seats };
}

const BAG = ['seer', 'smith', 'baker', 'oaf', 'thief', 'wraith'];
const NAMES = ['Ana', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay'];

test('the same seed deals the same circle, a different seed does not', () => {
  const a = lobby(NAMES);
  expectOk(a.game.stDeal(a.st.id, BAG, 'ilsmere'));
  const b = lobby(NAMES);
  expectOk(b.game.stDeal(b.st.id, BAG, 'ilsmere'));
  const c = lobby(NAMES);
  expectOk(c.game.stDeal(c.st.id, BAG, 'nettlemere'));

  const draw = (g: Game) => g.players().map((s) => s.characterId);
  assert.deepEqual(draw(a.game), draw(b.game), 'the same seed must replay the same deal');
  assert.notDeepEqual(draw(a.game), draw(c.game), 'a different seed must move the circle');
});

test('the whole bag is dealt out, once each', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stDeal(t.st.id, BAG, 'seed'));
  assert.deepEqual(t.game.players().map((s) => s.characterId).sort(), [...BAG].sort());
});

test('the deal sets alignment from the team', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stDeal(t.st.id, BAG, 'seed'));
  for (const seat of t.game.players()) {
    const team = t.game.character(seat.characterId)?.team;
    const expected = team === 'minion' || team === 'demon' ? 'evil' : 'good';
    assert.equal(seat.alignment, expected, `${seat.name} drew a ${team}`);
  }
});

test('the seed is announced publicly before any character is handed out', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stDeal(t.st.id, BAG, 'ilsmere'));
  const dealt = t.game.log.find((e) => e.type === 'game.dealt');
  assert.ok(dealt, 'no game.dealt event');
  assert.equal(dealt.visibility.kind, 'public');
  assert.equal((dealt.data as { seed: string }).seed, 'ilsmere');
  const firstCharacter = t.game.log.find((e) => e.type === 'player.character');
  assert.ok(firstCharacter && dealt.seq < firstCharacter.seq, 'the seed must be committed before the draw');
});

test('the deal is announced as counts, not as characters', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stDeal(t.st.id, BAG, 'seed'));
  const dealt = t.game.log.find((e) => e.type === 'game.dealt');
  const payload = JSON.stringify(dealt?.data);
  for (const id of BAG) assert.ok(!payload.includes(id), `${id} leaked into the public announcement`);
  assert.deepEqual((dealt?.data as { counts: unknown }).counts, {
    townsfolk: 3,
    outsider: 1,
    minion: 1,
    demon: 1,
    traveller: 0,
  });
});

test('a player is told only their own draw', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stDeal(t.st.id, BAG, 'seed'));
  const ana = t.seats[0]!;
  const told = t.game.log.filter((e) => e.type === 'player.character' && e.visibility.kind === 'seats');
  assert.equal(told.length, NAMES.length);
  const hers = told.filter((e) => (e.visibility as unknown as { seats: string[] }).seats.includes(ana.id));
  assert.equal(hers.length, 1, 'a seat should hear about exactly one draw: its own');
  assert.equal((hers[0]!.data as { seatId: string }).seatId, ana.id);
});

test('the bag must hold exactly one token per seat', () => {
  const t = lobby(NAMES);
  assert.match(expectErr(t.game.stDeal(t.st.id, BAG.slice(0, 3), 'seed')), /exactly one each/);
  assert.match(expectErr(t.game.stDeal(t.st.id, [...BAG, 'baker'], 'seed')), /exactly one each/);
});

test('an unknown character is refused before anything is dealt', () => {
  const t = lobby(NAMES);
  assert.match(expectErr(t.game.stDeal(t.st.id, [...BAG.slice(1), 'gremlin'], 'seed')), /not on this script/);
  assert.ok(
    t.game.players().every((s) => !s.characterId),
    'a rejected deal must leave the circle untouched',
  );
});

test('the bag is drawn in the lobby, not mid-game', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stStart(t.st.id));
  assert.match(expectErr(t.game.stDeal(t.st.id, BAG, 'seed')), /before the first night/);
});

test('a circle that already holds characters cannot be re-dealt', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stDeal(t.st.id, BAG, 'seed'));
  assert.match(expectErr(t.game.stDeal(t.st.id, BAG, 'other')), /already hold characters/);
});

test('only the Storyteller deals', () => {
  const t = lobby(NAMES);
  assert.match(expectErr(t.game.stDeal(t.seats[0]!.id, BAG, 'seed')), /[Ss]toryteller/);
});

test("the Storyteller's view says the circle was dealt, and names hand-set seats", () => {
  const t = lobby(NAMES);
  expectOk(t.game.stDeal(t.st.id, BAG, 'ilsmere'));
  let view = buildView(t.game, { kind: 'storyteller' });
  assert.equal(view.deal?.seed, 'ilsmere');
  assert.deepEqual(view.deal?.handSetNames, []);

  expectOk(t.game.stAssignCharacter(t.st.id, t.seats[2]!.id, 'baker'));
  view = buildView(t.game, { kind: 'storyteller' });
  assert.deepEqual(view.deal?.handSetNames, ['Cal']);
});

test('an undealt circle is called out to the Storyteller as arranged', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stStart(t.st.id));
  expectOk(t.game.stAssignCharacter(t.st.id, t.seats[0]!.id, 'wraith'));
  const view = buildView(t.game, { kind: 'storyteller' });
  assert.equal(view.deal?.seed, undefined);
  assert.deepEqual(view.deal?.handSetNames, ['Ana']);
});

test('the chronicle records the seed of a dealt game', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stDeal(t.st.id, BAG, 'ilsmere'));
  expectOk(t.game.stStart(t.st.id));
  const text = writeChronicle(t.game, { kind: 'storyteller' }, { reveal: true });
  assert.match(text, /ilsmere/);
  assert.match(text, /Nobody chose\s+who sat next to whom|Nobody chose who sat next to whom/);
});

test('the chronicle says so when the circle was arranged instead', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stStart(t.st.id));
  expectOk(t.game.stAssignCharacter(t.st.id, t.seats[0]!.id, 'wraith'));
  const text = writeChronicle(t.game, { kind: 'storyteller' }, { reveal: true });
  assert.match(text, /not dealt/);
});

test('the deal survives a snapshot and restore', () => {
  const t = lobby(NAMES);
  expectOk(t.game.stDeal(t.st.id, BAG, 'ilsmere'));
  const back = Game.restore(t.game.serialise());
  assert.equal(back.state.deal?.seed, 'ilsmere');
  assert.deepEqual(
    back.players().map((s) => s.characterId),
    t.game.players().map((s) => s.characterId),
  );
});

test('the shuffle is a permutation, not a partial one', () => {
  const items = Array.from({ length: 40 }, (_, i) => i);
  for (const seed of ['a', 'b', 'ilsmere', 'coldharrow']) {
    const out = shuffle(items, rngFrom(seed));
    assert.deepEqual([...out].sort((x, y) => x - y), items);
  }
});

test('the shuffle actually moves things', () => {
  const items = Array.from({ length: 40 }, (_, i) => i);
  const out = shuffle(items, rngFrom('ilsmere'));
  const fixed = out.filter((v, i) => v === i).length;
  assert.ok(fixed < 8, `${fixed} of 40 stayed put — that is not a shuffle`);
});
