import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCharacterIndex, nightOrder, parseScript, setupCounts } from '../src/scripts.js';

const index = buildCharacterIndex([
  { id: 'washerwoman', name: 'Washerwoman', team: 'townsfolk' },
  { id: 'imp', name: 'Imp', team: 'demon' },
]);

describe('script parsing', () => {
  it('reads the script-tool shape: _meta plus character ids', () => {
    const { script, unresolved } = parseScript(
      'trouble-brewing',
      [{ id: '_meta', name: 'Trouble Brewing', author: 'TPI' }, 'washerwoman', 'imp'],
      index,
    );
    assert.equal(script.name, 'Trouble Brewing');
    assert.equal(script.author, 'TPI');
    assert.deepEqual(script.characters.map((c) => c.id), ['washerwoman', 'imp']);
    assert.deepEqual(unresolved, []);
  });

  it('flags ids the character index does not know instead of inventing them', () => {
    const { script, unresolved } = parseScript('x', [{ id: '_meta', name: 'X' }, 'nosuchrole'], index);
    assert.deepEqual(unresolved, ['nosuchrole']);
    assert.equal(script.characters[0]?.unresolved, true);
  });

  it('accepts inline homebrew characters with full text', () => {
    const { script } = parseScript(
      'home',
      [
        { id: '_meta', name: 'Homebrew' },
        { id: 'blight', name: 'Blight', team: 'demon', ability: 'Each night*, choose a player: they die.', otherNight: 20 },
      ],
      index,
    );
    assert.equal(script.characters[0]?.ability, 'Each night*, choose a player: they die.');
    assert.equal(script.characters[0]?.team, 'demon');
  });

  it('merges index data under inline overrides', () => {
    const { script } = parseScript('m', [{ id: '_meta', name: 'M' }, { id: 'imp', ability: 'Homebrew text' }], index);
    assert.equal(script.characters[0]?.name, 'Imp');
    assert.equal(script.characters[0]?.ability, 'Homebrew text');
  });

  it('lets an enrichment file add ability text without reassigning teams', () => {
    // A roles.json that only carries ability text must not turn the Imp into a townsfolk.
    const enriched = buildCharacterIndex(
      [
        { id: 'imp', name: 'Imp', team: 'demon' },
        { id: 'poisoner', name: 'Poisoner', team: 'minion' },
      ],
      [
        { id: 'imp', ability: 'Each night*, choose a player: they die.' },
        { id: 'poisoner', ability: 'Each night, choose a player: they are poisoned.' },
      ],
    );
    assert.equal(enriched.get('imp')?.team, 'demon');
    assert.equal(enriched.get('imp')?.ability, 'Each night*, choose a player: they die.');
    assert.equal(enriched.get('poisoner')?.team, 'minion');
    assert.equal(enriched.get('poisoner')?.name, 'Poisoner');
  });

  it('still defaults a team when nothing ever supplied one', () => {
    const index = buildCharacterIndex([{ id: 'mystery', ability: 'Unknown.' }]);
    assert.equal(index.get('mystery')?.team, 'townsfolk');
    assert.equal(index.get('mystery')?.name, 'Mystery');
  });

  it('de-duplicates repeated ids', () => {
    const { script } = parseScript('d', [{ id: '_meta', name: 'D' }, 'imp', 'imp'], index);
    assert.equal(script.characters.length, 1);
  });

  it('orders the night by firstNight then otherNight', () => {
    const { script } = parseScript(
      'n',
      [
        { id: '_meta', name: 'N' },
        { id: 'a', name: 'A', team: 'townsfolk', firstNight: 5, otherNight: 30 },
        { id: 'b', name: 'B', team: 'minion', firstNight: 2, otherNight: 10 },
        { id: 'c', name: 'C', team: 'townsfolk' },
      ],
      index,
    );
    assert.deepEqual(nightOrder(script, true).map((c) => c.id), ['b', 'a']);
    assert.deepEqual(nightOrder(script, false).map((c) => c.id), ['b', 'a']);
  });
});

describe('setup table', () => {
  it('matches the rulebook for 5 to 15 players', () => {
    const expected: Record<number, [number, number, number, number]> = {
      5: [3, 0, 1, 1],
      6: [3, 1, 1, 1],
      7: [5, 0, 1, 1],
      8: [5, 1, 1, 1],
      9: [5, 2, 1, 1],
      10: [7, 0, 2, 1],
      11: [7, 1, 2, 1],
      12: [7, 2, 2, 1],
      13: [9, 0, 3, 1],
      14: [9, 1, 3, 1],
      15: [9, 2, 3, 1],
    };
    for (const [players, want] of Object.entries(expected)) {
      const got = setupCounts(Number(players));
      assert.deepEqual([got.townsfolk, got.outsiders, got.minions, got.demons], want, `${players} players`);
    }
  });
});
