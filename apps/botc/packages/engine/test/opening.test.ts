import { test } from 'node:test';
import assert from 'node:assert/strict';
import { table, expectOk, toNominations } from './helpers.js';

const AT = 1_700_000_000_000;

/**
 * The floor opens on a short fuse. The town gets `opening` seconds to put up a
 * first name — not the whole nominations phase — and the moment somebody does,
 * the full clock replaces it. Storytellers shorten the fuse a little every day.
 */

test('the first nomination hands over from the opening fuse to the full clock', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stSetTimer(t.st.id, 'opening', 20));
  expectOk(t.game.stSetTimer(t.st.id, 'nominations', 300));
  toNominations(t);
  assert.equal(t.game.state.phaseEndsAt, AT + 20_000, 'the floor opens on the short fuse');

  expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
  assert.equal(t.game.state.phaseEndsAt, AT + 300_000, 'and the full clock takes over');
});

test('silence past the fuse ends the day with nobody named', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stSetTimer(t.st.id, 'opening', 20));
  expectOk(t.game.stSetTimer(t.st.id, 'nominations', 300));
  toNominations(t);
  assert.equal(t.game.tick(AT + 19_000), true, 'the five-second call goes out first');
  t.game.tick(AT + 21_000);
  assert.equal(t.game.state.phase, 'dusk');
});

test('the five-second call is public, and said once', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stSetTimer(t.st.id, 'opening', 20));
  toNominations(t);
  t.game.tick(AT + 16_000);
  t.game.tick(AT + 17_000);
  t.game.tick(AT + 18_000);
  const calls = t.game.log.filter((e) => e.type === 'timer.lastcall');
  assert.equal(calls.length, 1, 'called once, not once a second');
  assert.equal(calls[0]?.visibility.kind, 'public');
});

test('with no opening set the nominations clock behaves as before', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stSetTimer(t.st.id, 'nominations', 300));
  toNominations(t);
  assert.equal(t.game.state.phaseEndsAt, AT + 300_000);
  expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
  assert.equal(t.game.state.phaseEndsAt, AT + 300_000, 'nothing to hand over to');
});
