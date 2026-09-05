import { test } from 'node:test';
import assert from 'node:assert/strict';
import { table, expectOk, expectErr, toNominations } from './helpers.js';

/**
 * Two players in a real game read "the dead cannot whisper" in their briefing and
 * went silent for three days each, holding information the town needed. The rule
 * was wrong. The dead keep their voice; they lose the nomination and all but one
 * vote, and nothing else.
 */

test('the dead can still speak in the square', () => {
  const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'wraith', Cal: 'baker' });
  expectOk(t.game.stSetPhase(t.st.id, 'day'));
  expectOk(t.game.stKill(t.st.id, t.byName('Ana').id, 'the wraith'));
  expectOk(t.game.sayPublic(t.byName('Ana').id, 'I was the Seer, and Ben is evil.'));
});

test('the dead can still whisper', () => {
  const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'wraith', Cal: 'baker' });
  expectOk(t.game.stSetPhase(t.st.id, 'day'));
  expectOk(t.game.stKill(t.st.id, t.byName('Ana').id, 'the wraith'));
  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Cal').id], 'Do not trust Ben.'));
});

test('the dead still cannot nominate', () => {
  const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'wraith', Cal: 'baker' });
  expectOk(t.game.stSetPhase(t.st.id, 'day'));
  expectOk(t.game.stKill(t.st.id, t.byName('Ana').id, 'the wraith'));
  toNominations(t);
  assert.match(
    expectErr(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id)),
    /dead cannot nominate/,
  );
});

test('a Storyteller restriction still silences a whisperer, alive or dead', () => {
  const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'wraith', Cal: 'baker' });
  expectOk(t.game.stSetPhase(t.st.id, 'day'));
  expectOk(t.game.stSetRestriction(t.st.id, t.byName('Ana').id, 'whisper', false));
  assert.match(
    expectErr(t.game.whisper(t.byName('Ana').id, [t.byName('Cal').id], 'psst')),
    /cannot whisper/,
  );
});
