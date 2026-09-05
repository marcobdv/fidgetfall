import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView, describeEvent } from '../src/views.js';
import { canSee } from '../src/events.js';
import { writeChronicle } from '../src/chronicle.js';
import { table, expectOk, expectErr } from './helpers.js';

/**
 * The three for three: you offer a player three characters you could be and ask
 * for three back. Neither of you commits, both of you get something to check
 * against everyone else, and evil can bury one lie between two truths.
 */

function day(names: string[], characters: Record<string, string> = {}) {
  const t = table(names, characters);
  expectOk(t.game.stSetPhase(t.st.id, 'day'));
  return t;
}

test('an offer of three reaches only the player it was made to', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.claim(t.byName('Ana').id, ['seer', 'smith', 'baker'], t.byName('Ben').id));

  const ben = buildView(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
  const toBen = ben.seats.find((s) => s.name === 'Ana');
  assert.deepEqual(toBen?.claimToYou?.map((c) => c.id), ['seer', 'smith', 'baker']);

  const cal = buildView(t.game, { kind: 'seat', seatId: t.byName('Cal').id });
  const toCal = cal.seats.find((s) => s.name === 'Ana');
  assert.equal(toCal?.claimToYou, undefined);
  assert.equal(toCal?.publicClaim, undefined);
});

test('an offer nobody answered is flagged to the person who made it', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.claim(t.byName('Ana').id, ['seer', 'smith', 'baker'], t.byName('Ben').id));

  const ana = buildView(t.game, { kind: 'seat', seatId: t.byName('Ana').id });
  const ben = ana.seats.find((s) => s.name === 'Ben');
  assert.equal(ben?.claimUnanswered, true, 'Ana should see that Ben owes her an answer');

  // Ben answers, and the flag gives way to what he actually said.
  expectOk(t.game.claim(t.byName('Ben').id, ['oaf', 'baker'], t.byName('Ana').id));
  const after = buildView(t.game, { kind: 'seat', seatId: t.byName('Ana').id });
  const benAfter = after.seats.find((s) => s.name === 'Ben');
  assert.equal(benAfter?.claimUnanswered, undefined);
  assert.deepEqual(benAfter?.claimToYou?.map((c) => c.id), ['oaf', 'baker']);
});

test('two hedges that overlap do not contest each other', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.claim(t.byName('Ana').id, ['seer', 'smith'], null));
  expectOk(t.game.claim(t.byName('Ben').id, ['seer', 'baker'], null));

  const cal = buildView(t.game, { kind: 'seat', seatId: t.byName('Cal').id });
  assert.equal(cal.seats.find((s) => s.name === 'Ana')?.claimContested, undefined);
  assert.equal(cal.seats.find((s) => s.name === 'Ben')?.claimContested, undefined);
});

test('two commitments to the same character still contest', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.claim(t.byName('Ana').id, ['seer'], null));
  expectOk(t.game.claim(t.byName('Ben').id, ['seer'], null));

  const cal = buildView(t.game, { kind: 'seat', seatId: t.byName('Cal').id });
  assert.equal(cal.seats.find((s) => s.name === 'Ana')?.claimContested, true);
  assert.equal(cal.seats.find((s) => s.name === 'Ben')?.claimContested, true);
});

test('a hedge that contains what they told the town is not a discrepancy', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.claim(t.byName('Ana').id, ['seer'], null));
  expectOk(t.game.claim(t.byName('Ana').id, ['seer', 'baker'], t.byName('Ben').id));

  const ben = buildView(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
  assert.equal(ben.seats.find((s) => s.name === 'Ana')?.claimToYouDiffers, undefined);
});

test('a hedge with none of what they told the town is a discrepancy', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.claim(t.byName('Ana').id, ['seer'], null));
  expectOk(t.game.claim(t.byName('Ana').id, ['oaf', 'baker'], t.byName('Ben').id));

  const ben = buildView(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
  assert.equal(ben.seats.find((s) => s.name === 'Ana')?.claimToYouDiffers, true);
});

test('a hedge is refused when it is empty or absurdly wide', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  assert.match(expectErr(t.game.claim(t.byName('Ana').id, [], null)), /at least one character/);
  assert.match(
    expectErr(
      t.game.claim(t.byName('Ana').id, ['seer', 'smith', 'baker', 'oaf', 'thief', 'wraith'], null),
    ),
    /at most 5 characters/,
  );
});

test('duplicates collapse rather than padding a hedge', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.claim(t.byName('Ana').id, ['seer', 'seer', 'baker'], null));
  const ben = buildView(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
  assert.deepEqual(
    ben.seats.find((s) => s.name === 'Ana')?.publicClaim?.map((c) => c.id),
    ['seer', 'baker'],
  );
});

test('the chronicle counts a hedge honest when the truth was inside it', () => {
  const t = day(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'wraith', Cal: 'baker' });
  // Ana really is the Seer and hid it among two others: honest.
  expectOk(t.game.claim(t.byName('Ana').id, ['seer', 'smith'], t.byName('Cal').id));
  // Ben is the Wraith and offered neither: not honest.
  expectOk(t.game.claim(t.byName('Ben').id, ['baker', 'smith'], t.byName('Cal').id));
  expectOk(t.game.stEndGame(t.st.id, 'good', 'done'));

  const story = writeChronicle(t.game, { kind: 'storyteller' }, { reveal: true });
  assert.match(story, /\*\*Ana\*\* was the Seer and said: one of Seer and Smith to Cal$/m);
  assert.match(story, /\*\*Ben\*\* was the Wraith and said: .* — not all of that was true/);
});

/**
 * Travellers: a shared pool the Storyteller seats on top of any script, usually
 * for someone joining a game already running. They are public — the whole point
 * of the trade — and they are exiled rather than executed.
 */
test('a traveller is public: everyone sees exactly what they are', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ana').id, 'pilgrim'));
  expectOk(t.game.stAssignCharacter(t.st.id, t.byName('Ben').id, 'seer'));

  const cal = buildView(t.game, { kind: 'seat', seatId: t.byName('Cal').id });
  const ana = cal.seats.find((s) => s.name === 'Ana');
  assert.equal(ana?.isTraveller, true);
  assert.equal(ana?.character?.id, 'pilgrim', 'a traveller is known to the whole table');
  assert.equal(ana?.alignment, undefined, 'but their alignment is still their own');

  // A normal player is still hidden from everyone but themselves.
  assert.equal(cal.seats.find((s) => s.name === 'Ben')?.character, undefined);
});

/**
 * A huddle: the same private channel, aimed at a few people at once. Real tables
 * do this constantly — "put your faith in one or two players and talk in secret
 * with them" is the standard good opening, and the engine could not express it.
 */
test('a huddle reaches everyone named and nobody else', () => {
  const t = day(['Ana', 'Ben', 'Cal', 'Dee']);
  expectOk(
    t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id, t.byName('Cal').id], 'We three only.'),
  );
  const said = t.game.log.find((e) => e.type === 'chat.whisper');
  assert.ok(said);
  for (const who of ['Ana', 'Ben', 'Cal']) {
    assert.equal(
      canSee(said, { kind: 'seat', seatId: t.byName(who).id }),
      true,
      `${who} was in the huddle and should have heard it`,
    );
  }
  assert.equal(canSee(said, { kind: 'seat', seatId: t.byName('Dee').id }), false, 'Dee heard it');

  // But Dee can see that it happened, and that three of them were in it.
  const observed = t.game.log.find((e) => e.type === 'chat.whisper.observed');
  assert.ok(observed);
  assert.equal(canSee(observed, { kind: 'seat', seatId: t.byName('Dee').id }), true);
  assert.match(describeEvent(t.game, observed), /Ana pulled Ben and Cal aside together — 3 of them/);
});

test('a huddle is capped, and cannot include yourself', () => {
  const t = day(['Ana', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay']);
  const others = ['Ben', 'Cal', 'Dee', 'Eve', 'Fay'].map((n) => t.byName(n).id);
  assert.match(expectErr(t.game.whisper(t.byName('Ana').id, others, 'all of you')), /at most 4/);
  assert.match(expectErr(t.game.whisper(t.byName('Ana').id, [], 'nobody')), /at least one player/);
  assert.match(
    expectErr(t.game.whisper(t.byName('Ana').id, [t.byName('Ana').id], 'myself')),
    /cannot whisper to yourself/,
  );
});

test('naming the same player twice is one seat in the huddle, not two', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  const ben = t.byName('Ben').id;
  expectOk(t.game.whisper(t.byName('Ana').id, [ben, ben], 'once'));
  const observed = t.game.log.find((e) => e.type === 'chat.whisper.observed');
  assert.ok(observed);
  // Two people stepped aside, not three, so it reads as an ordinary whisper.
  assert.match(describeEvent(t.game, observed), /Ana and Ben stepped aside to talk privately/);
});
