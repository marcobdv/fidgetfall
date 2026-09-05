import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildView } from '../src/views.js';
import { expectErr, expectOk, table } from './helpers.js';

describe('private notes', () => {
  it('keeps a note visible only to the player who wrote it', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    const ana = t.byName('Ana');
    const ben = t.byName('Ben');
    expectOk(t.game.setNote(ana.id, ben.id, { alignment: 'evil', text: 'dodged every question' }));

    const anaView = buildView(t.game, { kind: 'seat', seatId: ana.id });
    assert.equal(anaView.seats.find((s) => s.id === ben.id)?.note?.alignment, 'evil');

    const benView = buildView(t.game, { kind: 'seat', seatId: ben.id });
    assert.equal(benView.seats.find((s) => s.id === ben.id)?.note, undefined);

    // Not even the Storyteller — this is the player's notepad, not the grimoire.
    const stView = buildView(t.game, { kind: 'storyteller' });
    assert.equal(stView.seats.find((s) => s.id === ben.id)?.note, undefined);
  });

  it('holds several possible teams at once', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    expectOk(
      t.game.setNote(t.byName('Ana').id, t.byName('Ben').id, {
        alignment: 'evil',
        teams: ['minion', 'demon'],
        confidence: 'maybe',
      }),
    );
    const note = t.game.note(t.byName('Ana').id, t.byName('Ben').id);
    assert.deepEqual(note?.teams, ['minion', 'demon']);
    assert.equal(note?.confidence, 'maybe');
  });

  it('merges updates and clears a field on null', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    const [ana, ben] = [t.byName('Ana').id, t.byName('Ben').id];
    expectOk(t.game.setNote(ana, ben, { alignment: 'evil', text: 'shifty' }));
    expectOk(t.game.setNote(ana, ben, { confidence: 'likely' }));
    assert.equal(t.game.note(ana, ben)?.text, 'shifty', 'untouched fields survive');
    assert.equal(t.game.note(ana, ben)?.confidence, 'likely');
    expectOk(t.game.setNote(ana, ben, { alignment: null }));
    assert.equal(t.game.note(ana, ben)?.alignment, undefined);
  });

  it('refuses a character that is not on the script', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    assert.match(
      expectErr(t.game.setNote(t.byName('Ana').id, t.byName('Ben').id, { characters: ['imp'] })),
      /not on this script/,
    );
    expectOk(t.game.setNote(t.byName('Ana').id, t.byName('Ben').id, { characters: ['wraith'] }));
  });

  it('never writes a note into the event log', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    const before = t.game.log.length;
    expectOk(t.game.setNote(t.byName('Ana').id, t.byName('Ben').id, { text: 'secret' }));
    assert.equal(t.game.log.length, before);
  });

  it('forgets a note on request', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    const [ana, ben] = [t.byName('Ana').id, t.byName('Ben').id];
    expectOk(t.game.setNote(ana, ben, { alignment: 'good' }));
    expectOk(t.game.clearNote(ana, ben));
    assert.equal(t.game.note(ana, ben), undefined);
    assert.match(expectErr(t.game.clearNote(ana, ben)), /no note/);
  });
});
