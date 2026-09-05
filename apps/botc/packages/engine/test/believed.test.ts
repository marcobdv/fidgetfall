import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView, describeEvent } from '../src/views.js';
import { canSee } from '../src/events.js';
import { writeChronicle } from '../src/chronicle.js';
import { table, expectOk, expectErr } from './helpers.js';

/**
 * The Drunk and the Sleeper: a player who is told they are somebody else. The
 * whole character is the gap between the grimoire and their own head, so these
 * tests are really one test — that the two never leak into each other.
 */

test('a lied-to player sees only the lie', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'oaf', undefined, 'seer'));

  const own = buildView(t.game, { kind: 'seat', seatId: t.byName('Ana').id });
  assert.equal(own.you?.character?.id, 'seer');
  assert.equal(own.you?.character?.name, 'Seer');
  // The script list names every character, so look where it would actually leak:
  // her own block, and the seat rows.
  const surface = JSON.stringify({ you: own.you, seats: own.seats });
  assert.ok(!surface.includes('oaf'), 'the truth leaked into her own view');
});

test('the Storyteller sees both the truth and the lie', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'oaf', undefined, 'seer'));

  const st = buildView(t.game, { kind: 'storyteller' });
  const ana = st.seats.find((s) => s.name === 'Ana');
  assert.equal(ana?.character?.id, 'oaf');
  assert.equal(ana?.believedCharacter?.id, 'seer');
  // She is an Outsider, so she is still good.
  assert.equal(ana?.alignment, 'good');
});

test('other players learn nothing either way', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'oaf', undefined, 'seer'));

  const ben = buildView(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
  const ana = ben.seats.find((s) => s.name === 'Ana');
  assert.equal(ana?.character, undefined);
  assert.equal(ana?.believedCharacter, undefined);
});

test('an alignment given by hand still wins', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'thief', 'evil', 'baker'));
  const st = buildView(t.game, { kind: 'storyteller' });
  const ana = st.seats.find((s) => s.name === 'Ana');
  assert.equal(ana?.character?.id, 'thief');
  assert.equal(ana?.believedCharacter?.id, 'baker');
  assert.equal(ana?.alignment, 'evil');
});

test('believing a character off the script is refused', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  const error = expectErr(
    t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'oaf', undefined, 'nobody'),
  );
  assert.match(error, /not on this script/);
  // And the assignment did not half-happen.
  assert.equal(t.game.seat(t.byName('Ana').id)?.characterId, undefined);
});

test('believing what you already are is refused', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  const error = expectErr(
    t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'oaf', undefined, 'oaf'),
  );
  assert.match(error, /leave "believes" off/);
});

test('reassigning without believes clears the lie', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'oaf', undefined, 'seer'));
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'baker'));
  const st = buildView(t.game, { kind: 'storyteller' });
  const ana = st.seats.find((s) => s.name === 'Ana');
  assert.equal(ana?.character?.id, 'baker');
  assert.equal(ana?.believedCharacter, undefined);
});

test('the chronicle keeps the lie until the reveal, then names it', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'oaf', undefined, 'seer'));
  const viewer = { kind: 'seat', seatId: t.byName('Ana').id } as const;

  const during = writeChronicle(t.game, viewer, { reveal: false });
  assert.match(during, /as the Seer/);
  assert.ok(!during.includes('Oaf'), 'the reveal leaked into a mid-game recap');

  expectOk(t.game.stEndGame(t.st.id, 'good', 'the Wraith was caught'));
  const after = writeChronicle(t.game, viewer, { reveal: true });
  assert.match(after, /You were never the Seer\. You were the Oaf/);
  assert.match(after, /Oaf — thought they were the Seer/);
});

test('a Lunatic is told the alignment that goes with the lie', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  // Ana is a good Outsider who has been told she is the demon.
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'oaf', undefined, 'wraith'));

  const own = buildView(t.game, { kind: 'seat', seatId: t.byName('Ana').id });
  assert.equal(own.you?.character?.id, 'wraith');
  assert.equal(own.you?.alignment, 'evil', 'a briefing reading "demon, good" gives it away');

  // The Storyteller still sees what is actually true.
  const st = buildView(t.game, { kind: 'storyteller' });
  const ana = st.seats.find((s) => s.name === 'Ana');
  assert.equal(ana?.character?.id, 'oaf');
  assert.equal(ana?.alignment, 'good');
});

test('a Drunk told they are a Townsfolk is still shown good', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'oaf', undefined, 'seer'));
  assert.equal(buildView(t.game, { kind: 'seat', seatId: t.byName('Ana').id }).you?.alignment, 'good');
});

test('the roll call names everyone once the game is over', () => {
  const t = table(['Ana', 'Ben', 'Cal'], { Ben: 'wraith', Cal: 'baker' });
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'oaf', undefined, 'wraith'));
  expectOk(t.game.stEndGame(t.st.id, 'good', 'done'));

  const rollcall = t.game.log.find((e) => e.type === 'game.rollcall');
  assert.ok(rollcall, 'ending a game should call the roll');
  // Everyone sees it, not just the Storyteller.
  assert.equal(canSee(rollcall, { kind: 'seat', seatId: t.byName('Cal').id }), true);
  const text = describeEvent(t.game, rollcall);
  assert.match(text, /Ana — Oaf \(outsider, good\), and thought they were the Wraith/);
  assert.match(text, /Ben — Wraith \(demon, evil\)/);
});
