import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { writeChronicle } from '../src/chronicle.js';
import { table, expectOk } from './helpers.js';

/**
 * A game must survive leaving memory. Every renderer fix made after a game was
 * played is worthless if the material it rendered from is gone.
 */
test('a restored game renders the same chronicle as the original', () => {
  const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'wraith', Cal: 'baker' });
  expectOk(t.game.stSetPhase(t.st.id, 'day'));
  expectOk(t.game.sayPublic(t.byName('Ana').id, 'I think Ben is the Wraith.'));
  expectOk(t.game.claim(t.byName('Ana').id, ['seer'], null));
  expectOk(t.game.stRecord(t.st.id, 'She is right and does not know it.'));
  expectOk(t.game.setNote(t.byName('Cal').id, t.byName('Ben').id, { alignment: 'evil' }));
  expectOk(t.game.stEndGame(t.st.id, 'good', 'done'));

  // Through JSON, exactly as the journal stores it.
  const restored = Game.restore(JSON.parse(JSON.stringify(t.game.serialise())));

  const before = writeChronicle(t.game, { kind: 'storyteller' }, { reveal: true });
  const after = writeChronicle(restored, { kind: 'storyteller' }, { reveal: true });
  assert.equal(after, before, 'the record must survive the round trip intact');
  assert.match(after, /She is right and does not know it\./);

  // Per-viewer projection still works on the restored game, notes included.
  const cal = t.byName('Cal').id;
  assert.equal(
    writeChronicle(restored, { kind: 'seat', seatId: cal }, { reveal: true }),
    writeChronicle(t.game, { kind: 'seat', seatId: cal }, { reveal: true }),
  );
});
