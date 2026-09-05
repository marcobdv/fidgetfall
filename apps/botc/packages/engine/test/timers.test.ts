import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildView } from '../src/views.js';
import { Game } from '../src/game.js';
import { demoScript, expectErr, expectOk } from './helpers.js';

/** A table whose clock we control, so expiry is exact rather than flaky. */
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
  return {
    game,
    st: game.storyteller.id,
    seat: (name: string) => {
      const found = seats.find((s) => s.name === name);
      if (!found) throw new Error(name);
      return found.id;
    },
    advance: (seconds: number) => {
      now += seconds * 1000;
      return now;
    },
    now: () => now,
  };
}

describe('the clock', () => {
  it('is off until the Storyteller sets one', () => {
    const t = clocked(['Ana', 'Ben', 'Cal']);
    assert.equal(t.game.secondsLeft(), undefined);
    t.advance(3600);
    assert.equal(t.game.tick(t.now()), false, 'nothing moves on its own');
    assert.equal(t.game.state.phase, 'night');
  });

  it('starts running the moment it is applied to the current phase', () => {
    const t = clocked(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.stSetTimer(t.st, 'night', 60));
    assert.equal(t.game.secondsLeft(), 60);
    t.advance(20);
    assert.equal(t.game.secondsLeft(t.now()), 40);
  });

  it('advances the phase by itself when it runs out', () => {
    const t = clocked(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.stSetTimer(t.st, 'night', 60));
    t.advance(59);
    assert.equal(t.game.tick(t.now()), false);
    assert.equal(t.game.state.phase, 'night');
    t.advance(2);
    assert.equal(t.game.tick(t.now()), true);
    assert.equal(t.game.state.phase, 'day');
    assert.ok(
      t.game.log.some((e) => e.type === 'timer.expired'),
      'the table is told the clock ran out',
    );
  });

  it('carries the clock into the next phase when that phase has one too', () => {
    const t = clocked(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.stSetTimer(t.st, 'night', 30));
    expectOk(t.game.stSetTimer(t.st, 'day', 120));
    t.advance(31);
    t.game.tick(t.now());
    assert.equal(t.game.state.phase, 'day');
    assert.equal(t.game.secondsLeft(t.now()), 120);
  });

  it('closes a vote that runs out of time', () => {
    const t = clocked(['Ana', 'Ben', 'Cal', 'Dee', 'Eve']);
    expectOk(t.game.stSetTimer(t.st, 'vote', 45));
    expectOk(t.game.stSetPhase(t.st, 'day'));
    expectOk(t.game.stSetPhase(t.st, 'nominations'));
    expectOk(t.game.nominate(t.seat('Ana'), t.seat('Ben')));
    assert.equal(t.game.voteSecondsLeft(t.now()), 45);
    for (const name of ['Ana', 'Cal', 'Dee']) expectOk(t.game.castVote(t.seat(name), true));

    t.advance(46);
    assert.equal(t.game.tick(t.now()), true);
    assert.equal(t.game.activeNomination(), undefined, 'the vote closed itself');
    assert.equal(t.game.state.onBlockSeatId, t.seat('Ben'), 'and it still counted');
  });

  it('shows the time left to everyone', () => {
    const t = clocked(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.stSetTimer(t.st, 'night', 90));
    const view = buildView(t.game, { kind: 'seat', seatId: t.seat('Ana') });
    assert.equal(view.secondsLeft, 90);
    assert.equal(view.timers.night, 90);
  });

  it('hands the phase back when a clock is cleared', () => {
    const t = clocked(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.stSetTimer(t.st, 'night', 30));
    expectOk(t.game.stClearTimers(t.st));
    assert.equal(t.game.secondsLeft(), undefined);
    t.advance(600);
    assert.equal(t.game.tick(t.now()), false);
    assert.equal(t.game.state.phase, 'night');
  });

  it('refuses absurd durations, and only from the Storyteller', () => {
    const t = clocked(['Ana', 'Ben', 'Cal']);
    assert.match(expectErr(t.game.stSetTimer(t.st, 'day', 2)), /between 5 and 3600/);
    assert.match(expectErr(t.game.stSetTimer(t.seat('Ana'), 'day', 60)), /only the Storyteller/);
  });

  it('never runs the clock in the lobby or after the game ends', () => {
    const t = clocked(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.stSetTimer(t.st, 'night', 30));
    expectOk(t.game.stEndGame(t.st, 'good', 'done'));
    t.advance(600);
    assert.equal(t.game.tick(t.now()), false);
    assert.equal(t.game.state.phase, 'over');
  });
});
