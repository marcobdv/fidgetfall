import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Game } from '../src/game.js';
import { buildView } from '../src/views.js';
import { canSee } from '../src/events.js';
import { describeEvent } from '../src/views.js';
import { demoScript, expectErr, expectOk, table, toNominations } from './helpers.js';

describe('seating and setup', () => {
  it('seats players in order and keeps the storyteller out of the circle', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    assert.equal(t.game.players().length, 3);
    assert.deepEqual(t.game.players().map((s) => s.index), [0, 1, 2]);
    assert.ok(t.game.storyteller.isStoryteller);
    assert.equal(t.game.players().some((s) => s.isStoryteller), false);
  });

  it('rejects duplicate names', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    assert.match(expectErr(t.game.join('ana', 'human')), /already taken/);
  });

  it('refuses to start below the minimum table size', () => {
    const game = new Game({
      id: 'g',
      name: 'Tiny',
      joinCode: 'AAAA',
      script: demoScript,
      storytellerName: 'ST',
    });
    expectOk(game.join('Solo', 'human'));
    assert.match(expectErr(game.stStart(game.storyteller.id)), /at least 3/);
  });

  it('only the storyteller can drive the game', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    assert.match(expectErr(t.game.stAdvancePhase(t.byName('Ana').id)), /only the Storyteller/);
  });

  it('seats a late joiner as a traveller', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    const late = expectOk(t.game.join('Dee', 'agent'));
    assert.equal(late.isTraveller, true);
  });
});

describe('phases', () => {
  it('cycles night -> day -> gather -> nominations -> dusk -> night and counts days', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    assert.equal(t.game.state.phase, 'night');
    assert.equal(t.game.state.day, 1);
    assert.equal(expectOk(t.game.stAdvancePhase(t.st.id)), 'day');
    assert.equal(expectOk(t.game.stAdvancePhase(t.st.id)), 'gather');
    assert.equal(expectOk(t.game.stAdvancePhase(t.st.id)), 'nominations');
    assert.equal(expectOk(t.game.stAdvancePhase(t.st.id)), 'dusk');
    assert.equal(expectOk(t.game.stAdvancePhase(t.st.id)), 'night');
    assert.equal(t.game.state.day, 2);
  });

  it('clears per-day nomination flags at the start of a new day', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    expectOk(t.game.stCloseNomination(t.st.id));
    assert.equal(t.byName('Ana').hasNominatedToday, true);
    expectOk(t.game.stAdvancePhase(t.st.id)); // dusk
    expectOk(t.game.stAdvancePhase(t.st.id)); // night, day 2
    assert.equal(t.byName('Ana').hasNominatedToday, false);
    assert.equal(t.byName('Ben').hasBeenNominatedToday, false);
  });
});

describe('chat', () => {
  it('silences the town square at night but never the storyteller', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    assert.match(expectErr(t.game.sayPublic(t.byName('Ana').id, 'hello')), /silent at night/);
    expectOk(t.game.sayPublic(t.st.id, 'Everyone, go to sleep.'));
  });

  it('keeps whispers between the two players (and the storyteller)', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.stAdvancePhase(t.st.id)); // day
    expectOk(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'I am the Seer'));
    const whisper = t.game.log.find((e) => e.type === 'chat.whisper');
    assert.ok(whisper);
    assert.equal(canSee(whisper, { kind: 'seat', seatId: t.byName('Ana').id }), true);
    assert.equal(canSee(whisper, { kind: 'seat', seatId: t.byName('Ben').id }), true);
    assert.equal(canSee(whisper, { kind: 'seat', seatId: t.byName('Cal').id }), false);
    assert.equal(canSee(whisper, { kind: 'storyteller' }), true);
    assert.equal(canSee(whisper, { kind: 'spectator' }), false);

    // ...but the town sees that they stepped aside.
    const observed = t.game.log.find((e) => e.type === 'conversation.opened');
    assert.ok(observed);
    assert.equal(canSee(observed, { kind: 'seat', seatId: t.byName('Cal').id }), true);
  });

  it('does not allow whispering at night', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    assert.match(expectErr(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'psst')), /during the day/);
  });

  it('honours a storyteller-imposed whisper restriction', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.stAdvancePhase(t.st.id));
    expectOk(t.game.stSetRestriction(t.st.id, t.byName('Ana').id, 'whisper', false));
    assert.match(expectErr(t.game.whisper(t.byName('Ana').id, [t.byName('Ben').id], 'psst')), /cannot whisper/);
  });

  it('keeps storyteller info private to its recipient', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.stInfo(t.st.id, t.byName('Ana').id, 'You see two evil players.'));
    const info = t.game.log.find((e) => e.type === 'st.info');
    assert.ok(info);
    assert.equal(canSee(info, { kind: 'seat', seatId: t.byName('Ana').id }), true);
    assert.equal(canSee(info, { kind: 'seat', seatId: t.byName('Ben').id }), false);
  });
});

describe('nominations and votes', () => {
  it('needs the nominations phase', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    assert.match(expectErr(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id)), /not open/);
  });

  it('allows one nomination per nominator and one per nominee per day', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee']);
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    expectOk(t.game.stCloseNomination(t.st.id));
    assert.match(expectErr(t.game.nominate(t.byName('Ana').id, t.byName('Cal').id)), /already nominated today/);
    assert.match(
      expectErr(t.game.nominate(t.byName('Cal').id, t.byName('Ben').id)),
      /already been nominated today/,
    );
  });

  it('puts a player on the block when the vote clears half the living', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee', 'Eve']);
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    for (const name of ['Ana', 'Cal', 'Dee']) expectOk(t.game.castVote(t.byName(name).id, true));
    const nomination = expectOk(t.game.stCloseNomination(t.st.id));
    assert.equal(nomination.tally, 3);
    assert.equal(nomination.threshold, 3); // ceil(5 / 2)
    assert.equal(nomination.result, 'on-block');
    assert.equal(t.game.state.onBlockSeatId, t.byName('Ben').id);
  });

  it('leaves the block empty on a tie', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee', 'Eve']);
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    for (const name of ['Ana', 'Cal', 'Dee']) expectOk(t.game.castVote(t.byName(name).id, true));
    expectOk(t.game.stCloseNomination(t.st.id));

    expectOk(t.game.nominate(t.byName('Ben').id, t.byName('Cal').id));
    for (const name of ['Ana', 'Ben', 'Dee']) expectOk(t.game.castVote(t.byName(name).id, true));
    const second = expectOk(t.game.stCloseNomination(t.st.id));
    assert.equal(second.result, 'tied');
    assert.equal(t.game.state.onBlockSeatId, undefined);
  });

  it('does not unseat the leader with a smaller tally', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee', 'Eve']);
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    for (const name of ['Ana', 'Cal', 'Dee', 'Eve']) expectOk(t.game.castVote(t.byName(name).id, true));
    expectOk(t.game.stCloseNomination(t.st.id));

    expectOk(t.game.nominate(t.byName('Ben').id, t.byName('Cal').id));
    for (const name of ['Ana', 'Ben', 'Dee']) expectOk(t.game.castVote(t.byName(name).id, true));
    const second = expectOk(t.game.stCloseNomination(t.st.id));
    assert.equal(second.result, 'insufficient');
    assert.equal(t.game.state.onBlockSeatId, t.byName('Ben').id);
  });

  it('rejects a second vote from the same player', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    expectOk(t.game.castVote(t.byName('Cal').id, true));
    assert.match(expectErr(t.game.castVote(t.byName('Cal').id, false)), /already voted/);
  });

  it('spends a ghost vote on a yes and only once', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee', 'Eve']);
    expectOk(t.game.stKill(t.st.id, t.byName('Eve').id, 'the demon'));
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    expectOk(t.game.castVote(t.byName('Eve').id, true));
    assert.equal(t.byName('Eve').ghostVote, false);
    expectOk(t.game.stCloseNomination(t.st.id));

    expectOk(t.game.nominate(t.byName('Ben').id, t.byName('Cal').id));
    assert.match(expectErr(t.game.castVote(t.byName('Eve').id, true)), /already spent/);
  });

  it('lets the dead vote no without spending the token', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stKill(t.st.id, t.byName('Dee').id, 'the demon'));
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    expectOk(t.game.castVote(t.byName('Dee').id, false));
    assert.equal(t.byName('Dee').ghostVote, true);
  });

  it('stops the dead from nominating', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stKill(t.st.id, t.byName('Dee').id, 'the demon'));
    toNominations(t);
    assert.match(expectErr(t.game.nominate(t.byName('Dee').id, t.byName('Ben').id)), /dead cannot nominate/);
  });
});

describe('reporting deaths and votes', () => {
  it('never lets a death read as a role reveal', () => {
    // "Edith is dead (the Imp)" was read by two separate players as "Edith WAS
    // the Imp", and both then disbelieved their own true briefing all game.
    const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'seer' });
    expectOk(t.game.stKill(t.st.id, t.byName('Ana').id, 'the Imp'));
    const death = t.game.log.find((e) => e.type === 'player.died');
    assert.ok(death);
    const line = describeEvent(t.game, death);
    assert.equal(line, 'Ana is dead, killed by the Imp.');
    assert.doesNotMatch(line, /\(the Imp\)/, 'no bare parenthetical to misread');
  });

  it('names the town as the killer for an execution', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee', 'Eve']);
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    for (const name of ['Ana', 'Cal', 'Dee']) expectOk(t.game.castVote(t.byName(name).id, true));
    expectOk(t.game.stCloseNomination(t.st.id));
    expectOk(t.game.stAdvancePhase(t.st.id));
    const death = t.game.log.filter((e) => e.type === 'player.died').at(-1);
    assert.equal(describeEvent(t.game, death!), 'Ben is dead, executed by the town.');
  });

  it('counts the dead who still hold a ghost vote as yet to vote', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stKill(t.st.id, t.byName('Dee').id, 'the demon'));
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    expectOk(t.game.castVote(t.byName('Ana').id, true));
    const vote = t.game.log.filter((e) => e.type === 'vote.cast').at(-1);
    // 3 living plus Dee, who can still spend a ghost vote, minus the one cast.
    assert.match(describeEvent(t.game, vote!), /3 yet to vote/);
  });

  it('carries the running count on every vote', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee', 'Eve']);
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    expectOk(t.game.castVote(t.byName('Ana').id, true));
    expectOk(t.game.castVote(t.byName('Cal').id, false));
    const vote = t.game.log.filter((e) => e.type === 'vote.cast').at(-1);
    assert.ok(vote);
    assert.match(
      describeEvent(t.game, vote),
      /Cal votes no\. Running count: 1 yes, 1 no — 3 needed, 3 yet to vote\./,
    );
  });
});

describe('execution', () => {
  it('kills whoever is on the block at dusk', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee', 'Eve']);
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    for (const name of ['Ana', 'Cal', 'Dee']) expectOk(t.game.castVote(t.byName(name).id, true));
    expectOk(t.game.stCloseNomination(t.st.id));
    expectOk(t.game.stAdvancePhase(t.st.id)); // dusk
    assert.equal(t.byName('Ben').alive, false);
    const execution = t.game.log.find((e) => e.type === 'execution');
    assert.equal((execution?.data as { name: string | null }).name, 'Ben');
  });

  it('executes nobody when the block is empty', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    toNominations(t);
    expectOk(t.game.stAdvancePhase(t.st.id));
    const execution = t.game.log.find((e) => e.type === 'execution');
    assert.equal((execution?.data as { seatId: string | null }).seatId, null);
    assert.equal(t.game.alivePlayers().length, 3);
  });

  it('closes an open nomination before resolving dusk', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    toNominations(t);
    expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Ben').id));
    for (const name of ['Ana', 'Cal']) expectOk(t.game.castVote(t.byName(name).id, true));
    expectOk(t.game.stAdvancePhase(t.st.id)); // dusk, without an explicit close
    assert.equal(t.byName('Ben').alive, false);
  });
});

describe('travellers', () => {
  it('exiles a traveller on a majority of the whole table', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee']);
    expectOk(t.game.stSetTraveller(t.st.id, t.byName('Dee').id, true));
    toNominations(t);
    const nomination = expectOk(t.game.nominate(t.byName('Ana').id, t.byName('Dee').id));
    assert.equal(nomination.kind, 'exile');
    for (const name of ['Ana', 'Ben']) expectOk(t.game.castVote(t.byName(name).id, true));
    const closed = expectOk(t.game.stCloseNomination(t.st.id));
    assert.equal(closed.threshold, 2); // ceil(4 / 2)
    assert.equal(closed.result, 'exiled');
    assert.equal(t.byName('Dee').alive, false);
  });
});

describe('views', () => {
  it('hides other players characters but shows the storyteller everything', () => {
    const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'wraith' });
    const anaView = buildView(t.game, { kind: 'seat', seatId: t.byName('Ana').id });
    assert.equal(anaView.you?.character?.id, 'seer');
    assert.equal(anaView.seats.find((s) => s.name === 'Ben')?.character, undefined);
    assert.equal(anaView.joinCode, undefined);

    const stView = buildView(t.game, { kind: 'storyteller' });
    assert.equal(stView.seats.find((s) => s.name === 'Ben')?.character?.id, 'wraith');
    assert.equal(stView.seats.find((s) => s.name === 'Ben')?.alignment, 'evil');
    assert.equal(stView.joinCode, 'ABCD');
  });

  it('derives alignment from the character team', () => {
    const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'thief', Cal: 'wraith' });
    const st = buildView(t.game, { kind: 'storyteller' });
    assert.equal(st.seats.find((s) => s.name === 'Ana')?.alignment, 'good');
    assert.equal(st.seats.find((s) => s.name === 'Ben')?.alignment, 'evil');
    assert.equal(st.seats.find((s) => s.name === 'Cal')?.alignment, 'evil');
  });

  it('works out for the Storyteller which characters are not in play', () => {
    const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'smith', Cal: 'wraith' });
    const spare = t.game.charactersNotInPlay().map((c) => c.id);
    assert.deepEqual(spare.sort(), ['baker', 'oaf', 'pilgrim', 'thief']);

    const st = buildView(t.game, { kind: 'storyteller' });
    assert.deepEqual(st.notInPlay?.map((c) => c.id).sort(), ['baker', 'oaf', 'pilgrim', 'thief']);

    // It is a Storyteller tool: no player sees the bluff pool.
    const ana = buildView(t.game, { kind: 'seat', seatId: t.byName('Ana').id });
    assert.equal(ana.notInPlay, undefined);
  });

  it('reports the votes needed to execute', () => {
    const t = table(['Ana', 'Ben', 'Cal', 'Dee', 'Eve']);
    assert.equal(buildView(t.game, { kind: 'spectator' }).votesToExecute, 3);
    expectOk(t.game.stKill(t.st.id, t.byName('Eve').id, 'the demon'));
    assert.equal(buildView(t.game, { kind: 'spectator' }).votesToExecute, 2);
  });

  it('tells the storyteller when the demon is dead', () => {
    const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'seer', Ben: 'smith', Cal: 'wraith' });
    expectOk(t.game.stKill(t.st.id, t.byName('Cal').id, 'execution'));
    const notice = t.game.log.filter((e) => e.type === 'system.notice');
    assert.ok(notice.some((e) => (e.data as { text: string }).text.includes('No living Demon')));
    assert.equal(t.game.state.phase !== 'over', true); // the storyteller still has to call it
  });
});

describe('showing the grimoire', () => {
  it('sends the whole thing to one player and nobody else', () => {
    const t = table(['Ana', 'Ben', 'Cal'], { Ana: 'thief', Ben: 'smith', Cal: 'wraith' });
    expectOk(t.game.stAddReminder(t.st.id, t.byName('Ben').id, 'Poisoned'));
    expectOk(t.game.stShowGrimoire(t.st.id, t.byName('Ana').id));

    const shown = t.game.log.find((e) => e.type === 'st.grimoire.shown');
    assert.ok(shown);
    assert.equal(canSee(shown, { kind: 'seat', seatId: t.byName('Ana').id }), true);
    assert.equal(canSee(shown, { kind: 'seat', seatId: t.byName('Ben').id }), false);
    assert.equal(canSee(shown, { kind: 'spectator' }), false);

    const text = describeEvent(t.game, shown);
    assert.match(text, /3\. Cal — Wraith \(evil\)/, 'the Spy reads the demon straight off it');
    assert.match(text, /2\. Ben — Smith \(good\) · Poisoned/, 'reminder tokens included');
  });

  it('is a Storyteller power', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    assert.match(
      expectErr(t.game.stShowGrimoire(t.byName('Ana').id, t.byName('Ben').id)),
      /only the Storyteller/,
    );
  });
});

describe('ending', () => {
  it('records the winner', () => {
    const t = table(['Ana', 'Ben', 'Cal']);
    expectOk(t.game.stEndGame(t.st.id, 'good', 'The demon was executed.'));
    assert.equal(t.game.state.phase, 'over');
    assert.equal(t.game.state.winner, 'good');
    assert.match(expectErr(t.game.stAdvancePhase(t.st.id)), /over/);
  });
});

