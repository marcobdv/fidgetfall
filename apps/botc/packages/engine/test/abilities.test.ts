import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView, describeEvent } from '../src/views.js';
import { canSee } from '../src/events.js';
import { writeChronicle } from '../src/chronicle.js';
import { table, expectOk, expectErr } from './helpers.js';

/**
 * Abilities that happen in the square rather than at night — a Gossip's statement,
 * a Slayer's shot. Said in `say` they are a sentence the Storyteller has to catch
 * going past; declared properly they are an act of the day that cannot be missed.
 */

function day(names: string[], characters: Record<string, string> = {}) {
  const t = table(names, characters);
  expectOk(t.game.stSetPhase(t.st.id, 'day'));
  return t;
}

test('using an ability is public, and names who it was aimed at', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.useAbility(t.byName('Ana').id, [t.byName('Ben').id], 'I am the Slayer.'));

  const event = t.game.log.find((e) => e.type === 'player.ability');
  assert.ok(event);
  assert.equal(canSee(event, { kind: 'seat', seatId: t.byName('Cal').id }), true);
  assert.match(
    describeEvent(t.game, event),
    /Ana USES THEIR ABILITY on Ben, out loud, in front of the whole town\. — "I am the Slayer\."/,
  );
});

test('it waits in front of the Storyteller until they rule on it', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.useAbility(t.byName('Ana').id, [t.byName('Ben').id]));

  const before = buildView(t.game, { kind: 'storyteller' });
  assert.equal(before.pendingAbilities?.length, 1);
  assert.deepEqual(before.pendingAbilities?.[0]?.targetNames, ['Ben']);
  // Players do not get a to-do list; they saw it happen and that is all.
  assert.equal(buildView(t.game, { kind: 'seat', seatId: t.byName('Cal').id }).pendingAbilities, undefined);

  expectOk(t.game.stResolveAbility(t.st.id, undefined, 'Ben is not the Demon. Nothing happens.'));
  assert.equal(buildView(t.game, { kind: 'storyteller' }).pendingAbilities?.length, 0);
});

test('the ruling is announced to the whole town', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.useAbility(t.byName('Ana').id, [t.byName('Ben').id]));
  expectOk(t.game.stResolveAbility(t.st.id, undefined, 'Nothing happens.'));

  const ruling = t.game.log.find((e) => e.type === 'player.ability.resolved');
  assert.ok(ruling);
  assert.equal(canSee(ruling, { kind: 'seat', seatId: t.byName('Cal').id }), true);
  assert.match(describeEvent(t.game, ruling), /rules on Ana's ability: Nothing happens\./);
});

test('the Storyteller can clear the oldest without naming it, and is told when there is nothing', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.useAbility(t.byName('Ana').id, [], 'first'));
  expectOk(t.game.useAbility(t.byName('Ben').id, [], 'second'));
  expectOk(t.game.stResolveAbility(t.st.id));
  assert.deepEqual(
    buildView(t.game, { kind: 'storyteller' }).pendingAbilities?.map((u) => u.name),
    ['Ben'],
  );
  expectOk(t.game.stResolveAbility(t.st.id));
  assert.match(expectErr(t.game.stResolveAbility(t.st.id)), /nothing is waiting on you/);
});

test('night abilities are sent back to the private channel', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  assert.match(
    expectErr(t.game.useAbility(t.byName('Ana').id, [t.byName('Ben').id])),
    /night abilities go to the Storyteller privately/,
  );
});

test('the dead may still use an ability, because some characters act by dying', () => {
  const t = day(['Ana', 'Ben', 'Cal'], { Ana: 'oaf', Ben: 'wraith' });
  expectOk(t.game.stKill(t.st.id, t.byName('Ana').id, 'the wraith'));
  expectOk(t.game.useAbility(t.byName('Ana').id, [t.byName('Ben').id], 'I name Ben.'));
  assert.equal(buildView(t.game, { kind: 'storyteller' }).pendingAbilities?.length, 1);
});

test('the chronicle records it as an act of the day, not as chatter', () => {
  const t = day(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'wraith' });
  expectOk(t.game.useAbility(t.byName('Ana').id, [t.byName('Ben').id], 'I shoot Ben.'));
  expectOk(t.game.stResolveAbility(t.st.id, undefined, 'Nothing happens. Ben is unharmed.'));
  expectOk(t.game.stEndGame(t.st.id, 'evil', 'done'));

  const story = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Cal').id }, { reveal: true });
  assert.match(story, /In the open/);
  assert.match(story, /\*\*Ana\*\* used their ability on Ben — "I shoot Ben\."/);
  assert.match(story, /Nothing happens\. Ben is unharmed\./);
});

/**
 * The Storyteller's private record. Everything they are itching to announce and
 * must not, kept until the reveal, when it costs nobody anything.
 */
test('a record is invisible during the game and in every chronicle after it', () => {
  // Written at NIGHT, which is when a Storyteller most wants to say something and
  // must not — and which is the act the first version of this failed to render.
  const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'oaf', Ben: 'wraith' });
  expectOk(t.game.stRecord(t.st.id, 'Ana named three people tonight and killed nobody.'));

  // Mid-game: the Storyteller has it, the players have nothing — not even a hint
  // that something was written.
  const during = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Cal').id }, { reveal: false });
  assert.ok(!during.includes('killed nobody'), 'a live recap must not carry it');
  assert.ok(!during.includes('>'), 'nor show that anything was withheld');
  const mine = writeChronicle(t.game, { kind: 'storyteller' }, { reveal: false });
  assert.match(mine, /> Ana named three people tonight and killed nobody\./);

  // At the reveal it joins everybody's copy.
  expectOk(t.game.stEndGame(t.st.id, 'good', 'done'));
  const after = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Cal').id }, { reveal: true });
  assert.match(after, /> Ana named three people tonight and killed nobody\./);
});

test('only the Storyteller may write the record', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  assert.match(expectErr(t.game.stRecord(t.byName('Ana').id, 'let me in')), /[Ss]toryteller/);
});
