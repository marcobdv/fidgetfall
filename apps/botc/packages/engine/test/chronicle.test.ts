import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { writeChronicle } from '../src/chronicle.js';
import { expectOk, table, toNominations, type Table } from './helpers.js';

/** A whole game: a night kill, a nomination that lands, an execution, a called end. */
function playedOut(): Table {
  const t = table(['Ana', 'Ben', 'Cal', 'Dee', 'Eve'], {
    Ana: 'seer',
    Ben: 'smith',
    Cal: 'baker',
    Dee: 'thief',
    Eve: 'wraith',
  });
  expectOk(t.game.stInfo(t.st.id, t.byName('Ana').id, 'Ben or Eve is evil.'));
  expectOk(t.game.stKill(t.st.id, t.byName('Cal').id, 'the Wraith'));
  expectOk(t.game.stAdvancePhase(t.st.id)); // day
  expectOk(t.game.sayPublic(t.byName('Ana').id, 'Cal is dead and I have a read.'));
  toNominations(t);
  expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Eve').id));
  for (const name of ['Ana', 'Ben', 'Dee']) expectOk(t.game.castVote(t.byName(name).id, true));
  expectOk(t.game.stCloseNomination(t.st.id));
  expectOk(t.game.stAdvancePhase(t.st.id)); // dusk executes
  expectOk(t.game.stEndGame(t.st.id, 'good', 'The Wraith was executed.'));
  return t;
}

describe('the chronicle', () => {
  it('tells the story of the game', () => {
    const t = playedOut();
    const story = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Ana').id });
    assert.match(story, /# The Chronicle of Test Town/);
    assert.match(story, /Five of them — Ana, Ben, Cal, Dee and Eve/);
    assert.match(story, /Cal/, 'the night death is in there');
    // The phrasing varies per game; the outcome must always be there.
    assert.match(story, /Eve (went to|was on) the block/, 'the vote outcome is narrated');
    assert.match(story, /\b3\b/, 'the tally is narrated');
    assert.match(story, /At dusk, \*\*Eve\*\* was executed/);
    assert.match(story, /\*\*Good won\.\*\*/);
  });

  it('opens each night and day exactly once', () => {
    const t = playedOut();
    const story = writeChronicle(t.game, { kind: 'storyteller' });
    assert.equal((story.match(/^## Night 1$/gm) ?? []).length, 1);
    assert.equal((story.match(/^## Day 1$/gm) ?? []).length, 1);
  });

  it('carries what you were shown, and not what others were', () => {
    const t = playedOut();
    const ana = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Ana').id });
    const ben = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
    assert.match(ana, /Ben or Eve is evil/);
    assert.doesNotMatch(ben, /Ben or Eve is evil/);
  });

  it('reveals the grimoire once the game is over, and not before', () => {
    const t = playedOut();
    assert.match(writeChronicle(t.game, { kind: 'storyteller' }), /## The grimoire/);

    const running = table(['Ana', 'Ben', 'Cal'], { Cal: 'wraith' });
    const story = writeChronicle(running.game, { kind: 'seat', seatId: running.byName('Ana').id });
    assert.doesNotMatch(story, /## The grimoire/);
    assert.doesNotMatch(story, /Wraith/, 'a live game does not leak the demon');
    assert.match(story, /It has not\./);
  });

  it('keeps every word said in the square, not just the first and last', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee'], { Dee: 'wraith' });
    expectOk(t.game.stAdvancePhase(t.st.id)); // day
    expectOk(t.game.sayPublic(t.byName('Ana').id, 'Morning.'));
    expectOk(t.game.sayPublic(t.byName('Ben').id, 'I am the Smith and I claim it now.'));
    expectOk(t.game.sayPublic(t.byName('Cal').id, 'Ben is lying, I am the Smith.'));
    expectOk(t.game.sayPublic(t.byName('Dee').id, 'Goodnight.'));
    const story = writeChronicle(t.game, { kind: 'storyteller' });
    // The claim in the middle is the line that decides the game.
    assert.match(story, /\*\*Ben:\*\* "I am the Smith and I claim it now\."/);
    assert.match(story, /\*\*Cal:\*\* "Ben is lying, I am the Smith\."/);
    assert.match(story, /\*\*Ana:\*\* "Morning\."/);
    assert.match(story, /\*\*Dee:\*\* "Goodnight\."/);
  });

  it('keeps what the Storyteller announced out loud', () => {
    const t = playedOut();
    expectOk(t.game.stAnnounce(t.st.id, 'Correction: the vote closed at 3 of 3 and Eve is on the block.'));
    const story = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
    assert.match(story, /The Storyteller: \*Correction: the vote closed at 3 of 3/);
  });

  it('opens everyones notes at the end and marks them against the truth', () => {
    const t = playedOut();
    const ana = t.byName('Ana').id;
    expectOk(
      t.game.setNote(ana, t.byName('Eve').id, {
        alignment: 'evil',
        teams: ['minion', 'demon'],
        confidence: 'likely',
        text: 'Never answered about night one.',
      }),
    );
    expectOk(
      t.game.setNote(ana, t.byName('Ben').id, { alignment: 'evil', text: 'Voted to save Eve.' }),
    );

    const story = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Cal').id });
    assert.match(story, /## What everyone believed/);
    // Eve really was the Wraith, so Ana's read is marked correct.
    assert.match(story, /on \*\*Eve\*\* — evil ✓, minion\/demon ✓.*they were the Wraith/);
    assert.match(story, /> Never answered about night one\./);
    // Ben was the Smith, so the same player's other read is marked wrong.
    assert.match(story, /on \*\*Ben\*\* — evil ✗, and they were the Smith/);
  });

  it('shows afterwards who told whom what', () => {
    const t = playedOut();
    // The game is over; rewind to a day so claims can be made, then re-end it.
    const live = table(['Ana', 'Ben', 'Cal'], { Ana: 'wraith', Ben: 'seer', Cal: 'baker' });
    expectOk(live.game.stAdvancePhase(live.st.id));
    expectOk(live.game.claim(live.byName('Ana').id, 'seer', live.byName('Ben').id));
    expectOk(live.game.claim(live.byName('Ana').id, 'baker', live.byName('Cal').id));
    expectOk(live.game.claim(live.byName('Ben').id, 'seer', null));
    expectOk(live.game.stEndGame(live.st.id, 'evil', 'The Wraith survived.'));

    const story = writeChronicle(live.game, { kind: 'seat', seatId: live.byName('Cal').id });
    assert.match(story, /## What everyone said they were/);
    // Both halves of the demon's double story are visible now, to everyone.
    assert.match(story, /\*\*Ana\*\* was the Wraith and said: Seer to Ben; Baker to Cal — not all of that was true/);
    // The honest player is not accused of lying.
    assert.match(story, /\*\*Ben\*\* was the Seer and said: Seer to the whole town$/m);
    assert.equal(t.game.state.phase, 'over');
  });

  it('keeps notes private while the game is still running', () => {
    const t = table(['Ana', 'Ben', 'Cal'], { Cal: 'wraith' });
    expectOk(t.game.setNote(t.byName('Ana').id, t.byName('Cal').id, { text: 'shifty' }));
    const story = writeChronicle(t.game, { kind: 'seat', seatId: t.byName('Ben').id });
    assert.doesNotMatch(story, /What everyone believed/);
    assert.doesNotMatch(story, /shifty/);
  });

  it('counts the game up at the end', () => {
    const t = playedOut();
    const story = writeChronicle(t.game, { kind: 'storyteller' });
    assert.match(story, /- 1 nomination, 1 execution/);
    assert.match(story, /- 2 of 5 dead by the end/);
  });

  it('says nothing about a town that has not opened', () => {
    const game = table(['Ana', 'Ben', 'Cal']).game;
    game.state.phase = 'lobby';
    assert.match(writeChronicle(game, { kind: 'spectator' }), /nothing to tell/);
  });
});
