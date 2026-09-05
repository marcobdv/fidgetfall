import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildView } from '../src/views.js';
import { describeEvent } from '../src/views.js';
import { expectErr, expectOk, table, type Table } from './helpers.js';

/** Get to a day, where claims are made. */
function daytime(names: string[], characters: Record<string, string> = {}): Table {
  const t = table(names, characters);
  expectOk(t.game.stAdvancePhase(t.st.id));
  return t;
}

describe('claims', () => {
  it('puts an unverified claim on the board for everyone', () => {
    const t = daytime(['Ana', 'Ben', 'Cal'], { Ana: 'wraith' });
    // The demon claims a townsfolk. Nothing stops them; that is the point.
    expectOk(t.game.claim(t.byName('Ana').id, 'baker'));

    for (const viewer of [
      { kind: 'seat' as const, seatId: t.byName('Ben').id },
      { kind: 'storyteller' as const },
      { kind: 'spectator' as const },
    ]) {
      const view = buildView(t.game, viewer);
      assert.equal(view.seats.find((s) => s.name === 'Ana')?.claim?.id, 'baker');
    }
  });

  it('never leaks what they actually are', () => {
    const t = daytime(['Ana', 'Ben', 'Cal'], { Ana: 'wraith' });
    expectOk(t.game.claim(t.byName('Ana').id, 'baker'));
    const ben = buildView(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
    const ana = ben.seats.find((s) => s.name === 'Ana');
    assert.equal(ana?.claim?.id, 'baker');
    assert.equal(ana?.character, undefined, 'the claim is not the character');
  });

  it('flags two living players claiming the same character', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.claim(t.byName('Ana').id, 'seer'));
    expectOk(t.game.claim(t.byName('Ben').id, 'seer'));

    const view = buildView(t.game, { kind: 'spectator' });
    assert.equal(view.seats.find((s) => s.name === 'Ana')?.claimContested, true);
    assert.equal(view.seats.find((s) => s.name === 'Ben')?.claimContested, true);
    assert.equal(view.seats.find((s) => s.name === 'Cal')?.claimContested, undefined);

    const contested = t.game.contestedClaims();
    assert.equal(contested.length, 1);
    assert.equal(contested[0]?.characterName, 'Seer');
  });

  it('says out loud that a claim is contested', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.claim(t.byName('Ana').id, 'seer'));
    expectOk(t.game.claim(t.byName('Ben').id, 'seer'));
    const event = t.game.log.filter((e) => e.type === 'player.claim').at(-1);
    assert.ok(event);
    assert.match(describeEvent(t.game, event), /Ben claims the Seer — so does Ana\. One of them is lying\./);
  });

  it('stops counting a dead player against a claim', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.claim(t.byName('Ana').id, 'seer'));
    expectOk(t.game.claim(t.byName('Ben').id, 'seer'));
    expectOk(t.game.stKill(t.st.id, t.byName('Ana').id, 'the demon'));
    assert.deepEqual(t.game.contestedClaims(), [], 'a dead claim no longer contests');
  });

  it('can be taken back', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.claim(t.byName('Ana').id, 'seer'));
    expectOk(t.game.claim(t.byName('Ana').id, null));
    assert.equal(t.game.seat(t.byName('Ana').id)?.claimedCharacterId, undefined);
    assert.match(expectErr(t.game.claim(t.byName('Ana').id, null)), /have not claimed/);
  });

  it('only in daylight, only from the living, only from the script', () => {
    const night = table(['Ana', 'Ben', 'Cal']);
    assert.match(expectErr(night.game.claim(night.byName('Ana').id, 'seer')), /during the day/);

    const t = daytime(['Ana', 'Ben', 'Cal']);
    assert.match(expectErr(t.game.claim(t.byName('Ana').id, 'imp')), /not on this script/);
    expectOk(t.game.stKill(t.st.id, t.byName('Cal').id, 'the demon'));
    assert.match(expectErr(t.game.claim(t.byName('Cal').id, 'seer')), /dead do not claim/);
  });
});
