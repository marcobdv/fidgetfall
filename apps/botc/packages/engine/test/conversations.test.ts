import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from '../src/views.js';
import { writeChronicle } from '../src/chronicle.js';
import { table, expectOk, expectErr } from './helpers.js';

/**
 * You can only be in one conversation at a time, because at a real table you have
 * to walk over and stand there. That scarcity is the point: it is what makes "who
 * has Ewan spent his day with" worth watching, and what makes a huddle a decision
 * rather than a free extra.
 */

function day(names: string[]) {
  const t = table(names);
  expectOk(t.game.stSetPhase(t.st.id, 'day'));
  return t;
}

test('a whisper takes you both out of circulation', () => {
  const t = day(['Ana', 'Ben', 'Cal', 'Dee']);
  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'psst'));

  // Ana cannot start a second conversation.
  assert.match(
    expectErr(t.game.whisper(t.byName('Ana').id, [t.byName('Cal').id], 'you too')),
    /already talking with Ben/,
  );
  // And nobody else can reach Ben.
  assert.match(
    expectErr(t.game.whisper(t.byName('Cal').id, [t.byName('Ben').id], 'hello')),
    /Ben is already talking with Ana/,
  );
  // Cal and Dee are both free, so they can talk to each other.
  expectOk(t.game.whisper(t.byName('Cal').id, [t.byName('Dee').id], 'they are busy'));
});

test('being told who someone is busy with is itself information', () => {
  const t = day(['Ana', 'Ben', 'Cal', 'Dee']);
  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id, t.byName('Cal').id], 'we three'));
  const error = expectErr(t.game.whisper(t.byName('Dee').id, [t.byName('Cal').id], 'hi'));
  assert.match(error, /Cal is already talking with Ana and Ben/);
});

test('you keep talking to whoever you are standing with, by naming nobody', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'first'));
  expectOk(t.game.whisper(t.byName('Ana').id, [], 'second'));
  expectOk(t.game.whisper(t.byName('Ben').id, [], 'and back'));

  const cal = buildView(t.game, { kind: 'seat', seatId: t.byName('Cal').id });
  assert.equal(cal.talkingWith, undefined);
  // One conversation opened, not three.
  assert.equal(t.game.log.filter((e) => e.type === 'conversation.opened').length, 1);
});

test('leaving frees everyone in it', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'psst'));
  expectOk(t.game.leaveConversation(t.byName('Ben').id));

  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Cal').id], 'free again'));
  assert.match(expectErr(t.game.leaveConversation(t.byName('Ben').id)), /not in a private conversation/);
});

test('your own view names who you are standing with; nobody else sees the words', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'I am the Seer'));

  const ana = buildView(t.game, { kind: 'seat', seatId: t.byName('Ana').id });
  assert.deepEqual(ana.talkingWith, ['Ben']);

  // Cal sees that it is happening, and who, and nothing else.
  const cal = buildView(t.game, { kind: 'seat', seatId: t.byName('Cal').id });
  assert.deepEqual(cal.openConversations, [{ names: ['Ana', 'Ben'] }]);
  assert.equal(cal.talkingWith, undefined);
});

test('the town keeps a running tally of who met whom today', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  for (let i = 0; i < 3; i += 1) {
    expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], `round ${i}`));
    expectOk(t.game.leaveConversation(t.byName('Ana').id));
  }
  expectOk(t.game.whisper(t.byName('Cal').id, [t.byName('Ben').id], 'once'));

  const cal = buildView(t.game, { kind: 'seat', seatId: t.byName('Cal').id });
  assert.deepEqual(cal.metToday[0], { names: ['Ana', 'Ben'], count: 3 });
  assert.equal(cal.metToday.length, 2);
});

test('the tally is wiped when a new day begins', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'today'));
  expectOk(t.game.stSetPhase(t.st.id, 'night'));
  assert.deepEqual(buildView(t.game, { kind: 'storyteller' }).metToday, []);
});

test('a phase change breaks every huddle up', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'psst'));
  expectOk(t.game.stSetPhase(t.st.id, 'gather'));
  assert.equal(t.game.openConversations().length, 0);
  assert.equal(buildView(t.game, { kind: 'seat', seatId: t.byName('Ana').id }).talkingWith, undefined);
});

test('an abandoned conversation is swept up rather than trapping people in it', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'and then nothing'));
  assert.equal(t.game.tick(1_700_000_000_000 + 60_000), false, 'a minute is not abandoned yet');
  assert.equal(t.game.tick(1_700_000_000_000 + 200_000), true);
  assert.equal(t.game.openConversations().length, 0);
});

test('when the town is gathered there are no private words at all', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stSetPhase(t.st.id, 'gather'));
  assert.match(
    expectErr(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'psst')),
    /the town is gathered/,
  );
  // But you can still stand up and claim to everyone.
  expectOk(t.game.sayPublic(t.byName('Ana').id, 'I am the Seer.'));
  expectOk(t.game.claim(t.byName('Ana').id, ['seer'], null));
  assert.match(
    expectErr(t.game.claim(t.byName('Ana').id, ['baker'], t.byName('Ben').id)),
    /made to everyone or not at all/,
  );
});

test('the Storyteller chronicle carries the private conversations; a bystander sees none', () => {
  const t = day(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'I am bluffing the Baker.'));
  expectOk(t.game.stEndGame(t.st.id, 'good', 'done'));

  const st = writeChronicle(t.game, { kind: 'storyteller' }, { reveal: true });
  assert.match(st, /Out of earshot/);
  assert.match(st, /\*\*Ana\*\* to \*\*Ben:\*\* "I am bluffing the Baker\."/);

  const cal = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Cal').id }, { reveal: true });
  assert.ok(!cal.includes('bluffing the Baker'), 'Cal was not in that conversation');
});

test('a wake keeps its prompt in the chronicle, not just a tally', () => {
  const t = table(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stWake(t.st.id, t.byName('Ana').id, 'Your demon is Ben. Your fellow minion is Cal.'));
  expectOk(t.game.stEndGame(t.st.id, 'evil', 'done'));
  const own = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Ana').id }, { reveal: true });
  assert.match(own, /Your demon is Ben\. Your fellow minion is Cal\./);
  assert.ok(!own.includes('shown nothing'), 'a wake with a prompt is not nothing');
});
