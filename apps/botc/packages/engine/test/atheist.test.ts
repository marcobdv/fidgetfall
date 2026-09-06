import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { parseScript, buildCharacterIndex } from '../src/scripts.js';
import { buildView, describeEvent } from '../src/views.js';
import { expectOk, expectErr, demoScript } from './helpers.js';

/**
 * The Atheist. There is no evil in the bag; the Storyteller invents all of it, and
 * the town's only win is to put the Storyteller up and execute them. What is being
 * tested here is that the token on the sheet is what opens that door — not a flag,
 * not a briefing, the script itself.
 */

const atheistScript = parseScript(
  'demo-atheist',
  [
    { id: '_meta', name: 'Demo, and the Atheist' },
    { id: 'seer', name: 'Seer', team: 'townsfolk', ability: 'Each night, learn a thing.', firstNight: 10, otherNight: 10 },
    { id: 'smith', name: 'Smith', team: 'townsfolk', ability: 'You are hard to kill.' },
    { id: 'baker', name: 'Baker', team: 'townsfolk', ability: 'You bake.' },
    { id: 'oaf', name: 'Oaf', team: 'outsider', ability: 'You are clumsy.' },
    { id: 'thief', name: 'Thief', team: 'minion', ability: 'You steal.', otherNight: 5 },
    { id: 'wraith', name: 'Wraith', team: 'demon', ability: 'Each night*, choose a player: they die.', otherNight: 20 },
    { id: 'atheist', name: 'Atheist', team: 'townsfolk', ability: 'The Storyteller can break the game rules.' },
  ],
  buildCharacterIndex(),
).script;

let counter = 0;

function town(names: string[], script = atheistScript) {
  counter = 0;
  const game = new Game({
    id: 'g1',
    name: 'Test Town',
    joinCode: 'ABCD',
    script,
    storytellerName: 'Claude',
    now: () => 1_700_000_000_000,
    makeId: (prefix) => `${prefix}${++counter}`,
  });
  const seats = names.map((name) => expectOk(game.join(name, 'agent')));
  return { game, st: game.storyteller, seats };
}

/** Seat everyone, deal an all-good bag, and walk to nominations. */
function atheistGame(names: string[]) {
  const t = town(names);
  const bag = ['atheist', 'oaf', ...names.slice(2).map(() => 'baker')];
  expectOk(t.game.stDeal(t.st.id, bag, 'no-gods'));
  expectOk(t.game.stStart(t.st.id));
  while (t.game.state.phase !== 'nominations') expectOk(t.game.stAdvancePhase(t.st.id));
  return t;
}

test('the Atheist on the sheet is what makes the Storyteller nominable', () => {
  assert.equal(town(['Ana', 'Ben', 'Cal']).game.storytellerIsNominable(), true);
  assert.equal(town(['Ana', 'Ben', 'Cal'], demoScript).game.storytellerIsNominable(), false);
});

test('on a script without the Atheist the Storyteller cannot be nominated', () => {
  const t = town(['Ana', 'Ben', 'Cal'], demoScript);
  expectOk(t.game.stStart(t.st.id));
  while (t.game.state.phase !== 'nominations') expectOk(t.game.stAdvancePhase(t.st.id));
  assert.match(expectErr(t.game.nominate(t.seats[0]!.id, t.st.id)), /not a player/);
});

test('a living player may nominate the Storyteller', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  const nom = expectOk(t.game.nominate(t.seats[0]!.id, t.st.id));
  assert.equal(nom.kind, 'storyteller');
  assert.equal(nom.nomineeSeatId, t.st.id);
});

test('the threshold is half the living players, and the Storyteller is not one of them', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  expectOk(t.game.nominate(t.seats[0]!.id, t.st.id));
  for (const seat of t.seats.slice(0, 3)) expectOk(t.game.castVote(seat.id, true));
  const closed = expectOk(t.game.stCloseNomination(t.st.id));
  assert.equal(closed.threshold, 3, 'five alive should need three');
  assert.equal(closed.result, 'on-block');
  assert.equal(t.game.state.onBlockSeatId, t.st.id);
});

test('executing the Storyteller does not kill a seat, and tells them good has won', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  expectOk(t.game.nominate(t.seats[0]!.id, t.st.id));
  for (const seat of t.seats.slice(0, 3)) expectOk(t.game.castVote(seat.id, true));
  expectOk(t.game.stCloseNomination(t.st.id));
  expectOk(t.game.stSetPhase(t.st.id, 'dusk'));

  assert.equal(t.game.players().filter((s) => s.alive).length, 5, 'nobody should have died');
  assert.equal(t.st.alive, true);
  const notice = t.game.log.filter((e) => e.type === 'system.notice').at(-1);
  assert.match((notice?.data as { text: string }).text, /good has won/);
  const execution = t.game.log.find((e) => e.type === 'execution' && (e.data as { seatId: string | null }).seatId === t.st.id);
  assert.ok(execution, 'the execution should be announced publicly');
});

test('the town is told plainly what a Storyteller nomination means', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  expectOk(t.game.nominate(t.seats[0]!.id, t.st.id));
  const made = t.game.log.find((e) => e.type === 'nomination.made');
  const line = describeEvent(t.game, made!);
  assert.match(line, /nominates the STORYTELLER/);
  assert.match(line, /good wins/);
});

test('a dead player spends their ghost vote on the Storyteller like any execution', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  const ana = t.seats[0]!;
  expectOk(t.game.stKill(t.st.id, ana.id));
  expectOk(t.game.nominate(t.seats[1]!.id, t.st.id));
  expectOk(t.game.castVote(ana.id, true));
  assert.equal(ana.ghostVote, false, 'a yes vote on the Storyteller must cost the ghost vote');
  assert.match(expectErr(t.game.castVote(ana.id, true)), /already voted/);
});

test('two alive and nothing evil in the bag warns that good has run out of town', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  for (const seat of t.seats.slice(0, 3)) expectOk(t.game.stKill(t.st.id, seat.id));
  const notice = t.game.log.filter((e) => e.type === 'system.notice').at(-1);
  assert.match((notice?.data as { text: string }).text, /no evil in this game/);
});

test('the deal can announce counts it does not hold, and records that it lied', () => {
  const t = town(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  expectOk(
    t.game.stDeal(t.st.id, ['atheist', 'oaf', 'baker', 'baker', 'smith'], 'no-gods', {
      townsfolk: 3,
      outsider: 1,
      minion: 1,
      demon: 0,
      traveller: 0,
    }),
  );
  const dealt = t.game.log.find((e) => e.type === 'game.dealt');
  assert.equal((dealt?.data as { counts: { minion: number } }).counts.minion, 1, 'the town hears the lie');
  assert.equal(dealt?.visibility.kind, 'public');

  const record = t.game.log.find((e) => e.type === 'st.record');
  assert.ok(record, 'a false announcement must leave the truth in the record');
  assert.equal(record.visibility.kind, 'storyteller');
  assert.match((record.data as { text: string }).text, /nothing evil/);

  // And the bag really was all good.
  assert.ok(t.game.players().every((s) => s.alignment === 'good'));
});

test('an honest deal writes no such record', () => {
  const t = town(['Ana', 'Ben', 'Cal']);
  expectOk(t.game.stDeal(t.st.id, ['atheist', 'oaf', 'baker'], 'seed'));
  assert.equal(t.game.log.some((e) => e.type === 'st.record'), false);
});

test('a bargain the Storyteller kept is named at the end', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  expectOk(t.game.stEndGame(t.st.id, 'evil', 'The town never put me up.', [t.seats[1]!.id, t.seats[3]!.id]));
  const ended = t.game.log.find((e) => e.type === 'game.ended');
  assert.deepEqual(
    (ended?.data as { alsoWon: { name: string }[] }).alsoWon.map((a) => a.name),
    ['Ben', 'Dee'],
  );
  const line = describeEvent(t.game, ended!);
  assert.match(line, /bargain the Storyteller made and kept: Ben, Dee/);
});

test('a bargain naming somebody who is not at the table is refused', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  assert.match(expectErr(t.game.stEndGame(t.st.id, 'good', 'x', ['seat_nobody'])), /no such seat/);
  assert.notEqual(t.game.state.phase, 'over', 'a refused end must not end the game');
});

test('the Storyteller cannot be nominated twice in a day', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  expectOk(t.game.nominate(t.seats[0]!.id, t.st.id));
  expectOk(t.game.stCloseNomination(t.st.id));
  assert.match(expectErr(t.game.nominate(t.seats[1]!.id, t.st.id)), /already been nominated today/);
});

test('a new day lets the town come back for the Storyteller', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  expectOk(t.game.nominate(t.seats[0]!.id, t.st.id));
  expectOk(t.game.stCloseNomination(t.st.id));
  // Still today until the phase actually moves on.
  expectOk(t.game.stAdvancePhase(t.st.id));
  while (t.game.state.phase !== 'nominations') expectOk(t.game.stAdvancePhase(t.st.id));
  assert.equal(t.game.state.day, 2);
  expectOk(t.game.nominate(t.seats[1]!.id, t.st.id));
});

test('the Storyteller can be nominated but still cannot vote', () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  expectOk(t.game.nominate(t.seats[0]!.id, t.st.id));
  assert.match(expectErr(t.game.castVote(t.st.id, true)), /not a player/);
  // Speaking in the square is theirs by right — that is how a Storyteller runs a
  // town — and being on the block does not take it away. They get a defence.
  expectOk(t.game.sayPublic(t.st.id, 'I will say this once.'));
});

test("a player's view never shows the Storyteller as a seat to be read", () => {
  const t = atheistGame(['Ana', 'Ben', 'Cal', 'Dee', 'Eli']);
  const view = buildView(t.game, { kind: 'seat', seatId: t.seats[0]!.id });
  assert.equal(view.seats.length, 5);
  assert.equal(view.seats.some((s) => s.id === t.st.id), false);
});
