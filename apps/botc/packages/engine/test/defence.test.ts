import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeEvent } from '../src/views.js';
import { Game } from '../src/game.js';
import { demoScript, expectErr, expectOk } from './helpers.js';

function clocked(names: string[]) {
  let now = 1_700_000_000_000;
  let counter = 0;
  const game = new Game({
    id: 'g1',
    name: 'Test Town',
    joinCode: 'ABCD',
    script: demoScript,
    storytellerName: 'ST',
    now: () => now,
    makeId: (prefix) => `${prefix}${++counter}`,
  });
  const seats = names.map((name) => expectOk(game.join(name, 'agent')));
  expectOk(game.stStart(game.storyteller.id));
  const st = game.storyteller.id;
  const seat = (name: string) => {
    const found = seats.find((s) => s.name === name);
    if (!found) throw new Error(name);
    return found.id;
  };
  return { game, st, seat, advance: (s: number) => (now += s * 1000), now: () => now };
}

describe('the defence', () => {
  it('holds every hand down until the accused has answered', () => {
    const t = clocked(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stSetTimer(t.st, 'defence', 60));
    expectOk(t.game.stSetPhase(t.st, 'day'));
    expectOk(t.game.stSetPhase(t.st, 'nominations'));

    const nomination = expectOk(t.game.nominate(t.seat('Ana'), t.seat('Ben')));
    assert.equal(nomination.state, 'defence');
    assert.match(
      expectErr(t.game.castVote(t.seat('Cal'), true)),
      /Ben is still answering the charge/,
    );
    // The accused can speak, which is the entire point of the window.
    expectOk(t.game.sayPublic(t.seat('Ben'), 'I am the Smith and Ana knows it.'));
  });

  it('opens the floor when the defence clock runs out', () => {
    const t = clocked(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stSetTimer(t.st, 'defence', 60));
    expectOk(t.game.stSetTimer(t.st, 'vote', 90));
    expectOk(t.game.stSetPhase(t.st, 'day'));
    expectOk(t.game.stSetPhase(t.st, 'nominations'));
    expectOk(t.game.nominate(t.seat('Ana'), t.seat('Ben')));

    t.advance(61);
    assert.equal(t.game.tick(t.now()), true);
    assert.equal(t.game.activeNomination()?.state, 'voting');
    expectOk(t.game.castVote(t.seat('Cal'), true));

    const opened = t.game.log.find((e) => e.type === 'nomination.voting');
    assert.match(describeEvent(t.game, opened!), /Hands up on Ben\. 2 votes carry it\./);
  });

  it('lets the Storyteller cut a defence short', () => {
    const t = clocked(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stSetTimer(t.st, 'defence', 300));
    expectOk(t.game.stSetPhase(t.st, 'day'));
    expectOk(t.game.stSetPhase(t.st, 'nominations'));
    expectOk(t.game.nominate(t.seat('Ana'), t.seat('Ben')));
    expectOk(t.game.stOpenVoting(t.st));
    assert.equal(t.game.activeNomination()?.state, 'voting');
    expectOk(t.game.castVote(t.seat('Cal'), true));
    assert.match(expectErr(t.game.stOpenVoting(t.st)), /nobody is defending/);
  });

  it('takes the vote immediately when no defence clock is set', () => {
    const t = clocked(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stSetPhase(t.st, 'day'));
    expectOk(t.game.stSetPhase(t.st, 'nominations'));
    const nomination = expectOk(t.game.nominate(t.seat('Ana'), t.seat('Ben')));
    assert.equal(nomination.state, 'voting');
    expectOk(t.game.castVote(t.seat('Cal'), true));
  });

  it('tells the town the floor is still open after a vote', () => {
    const t = clocked(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stSetPhase(t.st, 'day'));
    expectOk(t.game.stSetPhase(t.st, 'nominations'));
    expectOk(t.game.nominate(t.seat('Ana'), t.seat('Ben')));
    expectOk(t.game.stCloseNomination(t.st));
    const floor = t.game.log.find((e) => e.type === 'nomination.floor');
    assert.ok(floor, 'the town is told it can still nominate');
    assert.match(describeEvent(t.game, floor), /3 players have not nominated today/);
  });

  it('holds the day open while a nomination is still live', () => {
    // The phase clock expiring mid-defence used to close the vote at 0, so a
    // correct nomination died without anyone being able to vote on it.
    const t = clocked(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stSetTimer(t.st, 'nominations', 120));
    expectOk(t.game.stSetTimer(t.st, 'defence', 60));
    expectOk(t.game.stSetTimer(t.st, 'vote', 90));
    expectOk(t.game.stSetPhase(t.st, 'day'));
    expectOk(t.game.stSetPhase(t.st, 'nominations'));

    t.advance(100);
    expectOk(t.game.nominate(t.seat('Ana'), t.seat('Ben')));

    // The nominations clock runs out while Ben is still answering.
    t.advance(30);
    t.game.tick(t.now());
    assert.equal(t.game.state.phase, 'nominations', 'the day waits');
    assert.equal(t.game.activeNomination()?.state, 'defence');

    // The defence ends, the vote is taken, and only then may the day close.
    t.advance(35);
    t.game.tick(t.now());
    assert.equal(t.game.activeNomination()?.state, 'voting');
    expectOk(t.game.castVote(t.seat('Cal'), true));
    expectOk(t.game.castVote(t.seat('Dee'), true));
    // The vote clock runs out: the nomination resolves and only then does the
    // overdue day close, in the same tick.
    t.advance(95);
    t.game.tick(t.now());
    assert.equal(t.game.activeNomination(), undefined, 'the vote resolved');
    assert.equal(t.game.state.phase, 'dusk', 'and only then did the day end');
    assert.equal(t.game.seat(t.seat('Ben'))?.alive, false, 'the votes counted');
  });

  it('says nothing about the floor once the day is over', () => {
    const t = clocked(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stSetPhase(t.st, 'day'));
    expectOk(t.game.stSetPhase(t.st, 'nominations'));
    expectOk(t.game.nominate(t.seat('Ana'), t.seat('Ben')));
    expectOk(t.game.stSetPhase(t.st, 'dusk'));
    assert.equal(t.game.log.some((e) => e.type === 'nomination.floor'), false);
  });
});
