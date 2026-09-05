import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildView, describeEvent } from '../src/views.js';
import { expectErr, expectOk, table, type Table } from './helpers.js';

/** Get to a day, where claims are made. */
function daytime(names: string[], characters: Record<string, string> = {}): Table {
  const t = table(names, characters);
  expectOk(t.game.stAdvancePhase(t.st.id));
  return t;
}

const TOWN = null;

describe('claims', () => {
  it('lets you tell two people two different things', () => {
    const t = daytime(['Ana', 'Ben', 'Cal', 'Dee'], { Ana: 'wraith' });
    const ana = t.byName('Ana').id;
    // The demon runs two stories at once. Nothing stops her.
    expectOk(t.game.claim(ana, 'seer', t.byName('Ben').id));
    expectOk(t.game.claim(ana, 'baker', t.byName('Cal').id));

    const ben = buildView(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
    const cal = buildView(t.game, { kind: 'seat', seatId: t.byName('Cal').id });
    assert.equal(ben.seats.find((s) => s.name === 'Ana')?.claimToYou?.id, 'seer');
    assert.equal(cal.seats.find((s) => s.name === 'Ana')?.claimToYou?.id, 'baker');

    // Neither of them can see what she told the other. Only comparing notes finds it.
    assert.equal(ben.seats.find((s) => s.name === 'Ana')?.publicClaim, undefined);
    assert.equal(cal.seats.find((s) => s.name === 'Ana')?.publicClaim, undefined);
    const dee = buildView(t.game, { kind: 'seat', seatId: t.byName('Dee').id });
    assert.equal(dee.seats.find((s) => s.name === 'Ana')?.claimToYou, undefined);
    assert.equal(dee.seats.find((s) => s.name === 'Ana')?.publicClaim, undefined);
  });

  it('keeps a private claim out of everyone elses log', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.claim(t.byName('Ana').id, 'seer', t.byName('Ben').id));
    const spoken = t.game.log.find((e) => e.type === 'player.claim');
    assert.ok(spoken);
    assert.equal(t.game.eventsSince(0, { kind: 'seat', seatId: t.byName('Cal').id }).includes(spoken), false);
    assert.equal(t.game.eventsSince(0, { kind: 'seat', seatId: t.byName('Ben').id }).includes(spoken), true);

    // But Cal does see that the two of them spoke.
    const observed = t.game.log.find((e) => e.type === 'player.claim.observed');
    assert.ok(observed);
    assert.equal(t.game.eventsSince(0, { kind: 'seat', seatId: t.byName('Cal').id }).includes(observed), true);
  });

  it('tells you when someone told you one thing and the town another', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    const ana = t.byName('Ana').id;
    expectOk(t.game.claim(ana, 'seer', t.byName('Ben').id));
    expectOk(t.game.claim(ana, 'baker', TOWN));

    const ben = buildView(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
    const anaSeat = ben.seats.find((s) => s.name === 'Ana');
    assert.equal(anaSeat?.claimToYou?.id, 'seer');
    assert.equal(anaSeat?.publicClaim?.id, 'baker');
    assert.equal(anaSeat?.claimToYouDiffers, true, 'Ben can see the discrepancy — he heard both');

    // Cal heard only the public one and has nothing to compare it against.
    const cal = buildView(t.game, { kind: 'seat', seatId: t.byName('Cal').id });
    assert.equal(cal.seats.find((s) => s.name === 'Ana')?.claimToYouDiffers, undefined);
  });

  it('only contests claims that were made in public', () => {
    const t = daytime(['Ana', 'Ben', 'Cal', 'Dee']);
    // Two private claims on one character are invisible to the engine, by design.
    expectOk(t.game.claim(t.byName('Ana').id, 'seer', t.byName('Cal').id));
    expectOk(t.game.claim(t.byName('Ben').id, 'seer', t.byName('Dee').id));
    assert.deepEqual(t.game.contestedClaims(), [], 'private claims are never auto-compared');

    // Said out loud, the whole town can see the clash.
    expectOk(t.game.claim(t.byName('Ana').id, 'seer', TOWN));
    expectOk(t.game.claim(t.byName('Ben').id, 'seer', TOWN));
    const contested = t.game.contestedClaims();
    assert.equal(contested.length, 1);
    assert.equal(contested[0]?.characterName, 'Seer');
    const view = buildView(t.game, { kind: 'spectator' });
    assert.equal(view.seats.find((s) => s.name === 'Ana')?.claimContested, true);
  });

  it('gives you your own ledger of what you have told whom', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    const ana = t.byName('Ana').id;
    expectOk(t.game.claim(ana, 'seer', t.byName('Ben').id));
    expectOk(t.game.claim(ana, 'baker', t.byName('Cal').id));

    const own = buildView(t.game, { kind: 'seat', seatId: ana });
    assert.deepEqual(
      own.you?.claimsMade?.map((c) => [c.toName, c.character.id]),
      [['Ben', 'seer'], ['Cal', 'baker']],
    );
    // And it is yours alone.
    const ben = buildView(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
    assert.equal(ben.seats.find((s) => s.name === 'Ana')?.claimsMade, undefined);
  });

  it('shows the Storyteller every story a player is running', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    const ana = t.byName('Ana').id;
    expectOk(t.game.claim(ana, 'seer', t.byName('Ben').id));
    expectOk(t.game.claim(ana, 'baker', TOWN));
    const st = buildView(t.game, { kind: 'storyteller' });
    assert.deepEqual(
      st.seats.find((s) => s.name === 'Ana')?.claimsMade?.map((c) => [c.toName, c.character.id]),
      [['Ben', 'seer'], [null, 'baker']],
    );
  });

  it('replaces the standing claim to that audience, not the others', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    const ana = t.byName('Ana').id;
    expectOk(t.game.claim(ana, 'seer', t.byName('Ben').id));
    expectOk(t.game.claim(ana, 'smith', t.byName('Ben').id));
    expectOk(t.game.claim(ana, 'baker', TOWN));
    assert.deepEqual(
      t.game.claimsMadeBy(ana).map((c) => c.characterId),
      ['smith', 'baker'],
    );
  });

  it('says a private claim privately and a public one publicly', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.claim(t.byName('Ana').id, 'seer', t.byName('Ben').id));
    const priv = t.game.log.filter((e) => e.type === 'player.claim').at(-1);
    assert.match(describeEvent(t.game, priv!), /Ana tells Ben privately: "I am the Seer\."/);

    expectOk(t.game.claim(t.byName('Ana').id, 'baker', TOWN));
    const pub = t.game.log.filter((e) => e.type === 'player.claim').at(-1);
    assert.match(describeEvent(t.game, pub!), /Ana claims the Baker to the whole town\./);
  });

  it('can be taken back, per audience', () => {
    const t = daytime(['Ana', 'Ben', 'Cal']);
    const ana = t.byName('Ana').id;
    expectOk(t.game.claim(ana, 'seer', t.byName('Ben').id));
    expectOk(t.game.claim(ana, 'baker', TOWN));
    expectOk(t.game.claim(ana, null, TOWN));
    assert.equal(t.game.publicClaim(ana), undefined);
    assert.equal(t.game.claimsMadeBy(ana).length, 1, 'the private one still stands');
    assert.match(expectErr(t.game.claim(ana, null, TOWN)), /have not claimed anything there/);
  });

  it('only in daylight, only from the living, only from the script', () => {
    const night = table(['Ana', 'Ben', 'Cal']);
    assert.match(expectErr(night.game.claim(night.byName('Ana').id, 'seer', TOWN)), /during the day/);

    const t = daytime(['Ana', 'Ben', 'Cal']);
    assert.match(expectErr(t.game.claim(t.byName('Ana').id, 'imp', TOWN)), /not on this script/);
    assert.match(
      expectErr(t.game.claim(t.byName('Ana').id, 'seer', t.byName('Ana').id)),
      /already know what you are/,
    );
    expectOk(t.game.stKill(t.st.id, t.byName('Cal').id, 'the demon'));
    assert.match(expectErr(t.game.claim(t.byName('Cal').id, 'seer', TOWN)), /dead do not claim/);
  });
});
