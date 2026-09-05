import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { start, type StartedServer } from '../src/main.js';
import { AgentClient, HumanClient, call, getJson, postJson } from './helpers.js';

/**
 * The vertical slice, end to end: a human Storyteller on the WebSocket the
 * browser uses, five agents on MCP, one full day/night cycle with a nomination,
 * a vote, an execution, and a called game.
 */
describe('a game with humans and agents', () => {
  let server: StartedServer;
  let port: number;

  before(async () => {
    server = await start({ PORT: '0', BOTC_HOST: '127.0.0.1' });
    port = server.port;
  });

  after(async () => {
    await server.close();
  });

  it('serves the script store', async () => {
    const { scripts } = await getJson(port, '/api/scripts');
    const ids = scripts.map((s: { id: string }) => s.id);
    assert.ok(ids.includes('trouble-brewing'), 'trouble brewing is installed');
    assert.ok(ids.includes('bad-moon-rising'));
    assert.ok(ids.includes('sects-and-violets'));
    assert.ok(ids.includes('whispers-in-the-orchard'));
    const homebrew = scripts.find((s: { id: string }) => s.id === 'whispers-in-the-orchard');
    assert.equal(homebrew.hasAbilityText, true, 'the demo script ships with ability text');
  });

  it('plays a full round', async () => {
    // The Storyteller opens a town over HTTP and connects the way a browser does.
    const created = await postJson(port, '/api/games', {
      name: 'Ravenswood Bluff',
      scriptId: 'whispers-in-the-orchard',
      storytellerName: 'Marco',
    });
    assert.ok(created.joinCode, 'a join code is issued');
    const st = await HumanClient.connect(port, created.token);

    // Five agents find the game over MCP and sit down.
    const lobby = await AgentClient.connect(port, 'scout');
    const listed = await call(lobby, 'list_games');
    assert.match(listed.text, /Ravenswood Bluff/);
    await lobby.close();

    const names = ['Ana', 'Ben', 'Cal', 'Dee', 'Eve'];
    const agents = [];
    for (const name of names) agents.push(await AgentClient.join(port, created.joinCode, name));
    const [ana, ben, cal, dee, eve] = agents as [
      AgentClient,
      AgentClient,
      AgentClient,
      AgentClient,
      AgentClient,
    ];

    await st.waitFor((messages) =>
      messages.some((m) => m.type === 'state' && (m['view'] as { seats: unknown[] }).seats.length === 5),
    );

    // The Storyteller fills the grimoire and starts the game.
    const assign = async (player: string, character: string) => {
      const reply = await st.send({ type: 'st_assign', target: player, character });
      assert.equal(reply.type, 'ok', `assigning ${character} to ${player}: ${reply['error'] ?? ''}`);
    };
    await assign('Ana', 'orchardist');
    await assign('Ben', 'beekeeper');
    await assign('Cal', 'cellarman');
    await assign('Dee', 'crowherd');
    await assign('Eve', 'blight');
    assert.equal((await st.send({ type: 'st_start' })).type, 'ok');

    // Night: only the woken player hears the Storyteller.
    assert.equal((await st.send({ type: 'st_wake', target: 'Ana', prompt: 'Open your eyes.' })).type, 'ok');
    assert.equal(
      (await st.send({ type: 'st_info', target: 'Ana', text: 'Ben or Eve — one of them is evil.' })).type,
      'ok',
    );
    const anaNight = await ana.call('await_event', { since: 0, timeout_seconds: 5 });
    assert.match(anaNight.text, /one of them is evil/);
    const benNight = await ben.call('await_event', { since: 0, timeout_seconds: 5 });
    assert.doesNotMatch(benNight.text, /one of them is evil/, 'private info stays private');

    // A player only ever sees their own character.
    const anaLook = await ana.call('look');
    assert.match(anaLook.text, /Your character: Orchardist/);
    assert.doesNotMatch(anaLook.text, /Blight/, 'Ana cannot see the demon');

    // ...but the Storyteller sees the whole grimoire.
    const stView = st.view() as { seats: { name: string; character?: { name: string } }[] };
    assert.equal(stView.seats.find((s) => s.name === 'Eve')?.character?.name, 'Blight');

    // The demon kills in the night; day breaks.
    assert.equal((await st.send({ type: 'st_kill', target: 'Cal', cause: 'the Blight' })).type, 'ok');
    assert.equal((await st.send({ type: 'st_advance_phase' })).type, 'ok');

    // Public talk reaches everyone; a whisper reaches exactly one other player.
    assert.equal((await ana.call('say', { text: 'Cal is dead. Who saw anything?' })).isError, false);
    assert.equal((await ana.call('whisper', { player: 'Ben', text: 'I think Eve is the demon.' })).isError, false);

    const benHeard = await ben.call('await_event', { since: 0, timeout_seconds: 5 });
    assert.match(benHeard.text, /I think Eve is the demon/);
    const deeHeard = await dee.call('await_event', { since: 0, timeout_seconds: 5 });
    assert.doesNotMatch(deeHeard.text, /I think Eve is the demon/, 'whispers are private');
    assert.match(deeHeard.text, /stepped aside to talk privately/, 'but the town sees they spoke');

    // Nominations, votes, execution.
    assert.equal((await st.send({ type: 'st_set_phase', phase: 'nominations' })).type, 'ok');
    const early = await eve.call('vote', { vote: true });
    assert.equal(early.isError, true, 'there is nothing to vote on yet');

    assert.equal((await ana.call('nominate', { player: 'Eve' })).isError, false);
    for (const agent of [ana, ben, dee]) {
      assert.equal((await agent.call('vote', { vote: true })).isError, false);
    }
    assert.equal((await eve.call('vote', { vote: false })).isError, false);

    const closed = await st.send({ type: 'st_close_nomination' });
    assert.equal(closed.type, 'ok');
    assert.equal((await st.send({ type: 'st_advance_phase' })).type, 'ok'); // dusk resolves it

    const afterDusk = await ana.call('look');
    assert.match(afterDusk.text, /5\. Eve — DEAD/);
    assert.match(st.texts().join('\n'), /Eve is executed/);

    // The Storyteller calls the game.
    assert.equal(
      (await st.send({ type: 'st_end_game', winner: 'good', reason: 'The Blight was executed.' })).type,
      'ok',
    );
    const final = await cal.call('look');
    assert.match(final.text, /GAME OVER — good wins/);

    for (const agent of agents) await agent.close();
    st.close();
  });

  it('hands each seat a briefing written for it', async () => {
    const created = await postJson(port, '/api/games', {
      scriptId: 'whispers-in-the-orchard',
      storytellerName: 'ST',
    });
    const st = await HumanClient.connect(port, created.token);
    const agents = [];
    for (const name of ['Ana', 'Ben', 'Cal']) {
      agents.push(await AgentClient.join(port, created.joinCode, name));
    }
    const [ana, ben] = agents as [AgentClient, AgentClient];
    await st.waitFor((m) =>
      m.some((x) => x.type === 'state' && (x['view'] as { seats: unknown[] }).seats.length === 3),
    );
    await st.send({ type: 'st_assign', target: 'Ana', character: 'blight' });
    await st.send({ type: 'st_assign', target: 'Ben', character: 'beekeeper' });

    const demon = await ana.call('briefing');
    assert.match(demon.text, /\*\*Blight\*\* — demon, evil/);
    assert.match(demon.text, /Playing the Demon/);
    assert.match(demon.text, /Deception is the game/);
    assert.match(demon.text, /Where this stops/, 'the deception licence is bounded');
    assert.doesNotMatch(demon.text, /Playing a Townsfolk/);

    const good = await ben.call('briefing');
    assert.match(good.text, /Playing a Townsfolk/);
    assert.doesNotMatch(good.text, /Playing the Demon/, 'a townsfolk is not told how the demon plays');

    // The script is public — every character on it is listed for everyone — but
    // who is playing which one is not.
    assert.match(good.text, /## The script: Whispers in the Orchard/);
    assert.match(good.text, /\*\*Blight\*\*/, 'the Blight is listed as a possibility');
    assert.doesNotMatch(good.text, /Ana[^\n]*Blight/, 'but never attached to a player');
    assert.match(demon.text, /## The script: Whispers in the Orchard/);

    // The storyteller gets a different document, with the grimoire in it.
    const briefing = await getJson(port, `/api/briefing?token=${created.token}`);
    assert.match(briefing.text, /You are the \*\*Storyteller\*\*/);
    assert.match(briefing.text, /Ana — Blight \(demon, evil\)/);

    for (const agent of agents) await agent.close();
    st.close();
  });

  it('keeps private notes private and gives them back on look', async () => {
    const created = await postJson(port, '/api/games', {
      scriptId: 'whispers-in-the-orchard',
      storytellerName: 'ST',
    });
    const st = await HumanClient.connect(port, created.token);
    const ana = await AgentClient.join(port, created.joinCode, 'Ana');
    const ben = await AgentClient.join(port, created.joinCode, 'Ben');

    const written = await ana.call('note', {
      player: 'Ben',
      alignment: 'evil',
      teams: ['minion', 'demon'],
      confidence: 'maybe',
      text: 'Would not answer about night one.',
    });
    assert.equal(written.isError, false);
    assert.match(written.text, /minion or demon/);

    const anaLook = await ana.call('look');
    assert.match(anaLook.text, /your note: evil · minion or demon · \(maybe\)/);

    const benLook = await ben.call('look');
    assert.doesNotMatch(benLook.text, /your note/, 'Ben sees no note about himself');
    const stView = st.view() as { seats: { name: string; note?: unknown }[] };
    assert.equal(stView.seats.find((s) => s.name === 'Ben')?.note, undefined);

    const forgotten = await ana.call('forget_note', { player: 'Ben' });
    assert.equal(forgotten.isError, false);
    assert.doesNotMatch((await ana.call('look')).text, /your note/);

    await ana.close();
    await ben.close();
    st.close();
  });

  it('writes a chronicle of the game', async () => {
    const created = await postJson(port, '/api/games', {
      name: 'Ravenswood Bluff',
      scriptId: 'whispers-in-the-orchard',
      storytellerName: 'ST',
    });
    const st = await HumanClient.connect(port, created.token);
    const agents = [];
    for (const name of ['Ana', 'Ben', 'Cal']) {
      agents.push(await AgentClient.join(port, created.joinCode, name));
    }
    const [ana] = agents as [AgentClient];
    await st.waitFor((m) =>
      m.some((x) => x.type === 'state' && (x['view'] as { seats: unknown[] }).seats.length === 3),
    );
    await st.send({ type: 'st_assign', target: 'Cal', character: 'blight' });
    await st.send({ type: 'st_start' });
    await st.send({ type: 'st_info', target: 'Ana', text: 'Ben and Cal — one is evil.' });
    await st.send({ type: 'st_advance_phase' });
    await ana.call('say', { text: 'Nobody died, which is worse.' });
    await st.send({ type: 'st_set_phase', phase: 'nominations' });
    await ana.call('nominate', { player: 'Cal' });
    for (const agent of agents) await agent.call('vote', { vote: true });
    await st.send({ type: 'st_close_nomination' });
    await st.send({ type: 'st_advance_phase' });
    await st.send({ type: 'st_end_game', winner: 'good', reason: 'The Blight hanged.' });

    const recap = await ana.call('recap');
    assert.match(recap.text, /# The Chronicle of Ravenswood Bluff/);
    assert.match(recap.text, /Nobody died, which is worse/);
    assert.match(recap.text, /Ben and Cal — one is evil/, 'her own night information is in it');
    assert.match(recap.text, /\*\*Cal\*\* was executed/);
    assert.match(recap.text, /## The grimoire/, 'the game is over, so it reveals');
    assert.match(recap.text, /\*\*Good won\.\*\*/);

    for (const agent of agents) await agent.close();
    st.close();
  });

  it('runs the clock so a table of agents cannot stall', async () => {
    const created = await postJson(port, '/api/games', {
      scriptId: 'whispers-in-the-orchard',
      storytellerName: 'ST',
    });
    const st = await HumanClient.connect(port, created.token);
    const agents = [];
    for (const name of ['Ana', 'Ben', 'Cal']) {
      agents.push(await AgentClient.join(port, created.joinCode, name));
    }
    const [ana] = agents as [AgentClient];
    await st.waitFor((m) =>
      m.some((x) => x.type === 'state' && (x['view'] as { seats: unknown[] }).seats.length === 3),
    );
    await st.send({ type: 'st_start' });

    // A five-second vote clock, set from the Storyteller's own transport.
    assert.equal((await st.send({ type: 'st_set_timer', key: 'vote', seconds: 5 })).type, 'ok');
    await st.send({ type: 'st_set_phase', phase: 'day' });
    await st.send({ type: 'st_set_phase', phase: 'nominations' });
    assert.equal((await ana.call('nominate', { player: 'Ben' })).isError, false);

    // The agent is told how long it has, in words.
    const look = await ana.call('look');
    assert.match(look.text, /This vote closes in \ds/);
    const cursor = Number(/Cursor: (\d+)/.exec(look.text)?.[1] ?? 0);

    // Nobody does anything. The room's own clock closes it anyway, and the
    // waiting agent is woken by it.
    const woken = await ana.call('await_event', { since: cursor, timeout_seconds: 20 });
    assert.match(woken.text, /Time is up — the vote is closed/);
    const after = await ana.call('look');
    assert.doesNotMatch(after.text, /Open execution/, 'the nomination is gone');

    for (const agent of agents) await agent.close();
    st.close();
  });

  it('puts claims on the board where everyone can weigh them', async () => {
    const created = await postJson(port, '/api/games', {
      scriptId: 'whispers-in-the-orchard',
      storytellerName: 'ST',
    });
    const st = await HumanClient.connect(port, created.token);
    const agents = [];
    for (const name of ['Ana', 'Ben', 'Cal']) {
      agents.push(await AgentClient.join(port, created.joinCode, name));
    }
    const [ana, ben, cal] = agents as [AgentClient, AgentClient, AgentClient];
    await st.waitFor((m) =>
      m.some((x) => x.type === 'state' && (x['view'] as { seats: unknown[] }).seats.length === 3),
    );
    // Ana is the demon and is about to claim she is not.
    await st.send({ type: 'st_assign', target: 'Ana', character: 'blight' });
    await st.send({ type: 'st_start' });
    await st.send({ type: 'st_set_phase', phase: 'day' });

    assert.equal((await ana.call('claim', { character: 'beekeeper' })).isError, false);
    const seen = await cal.call('look');
    assert.match(seen.text, /Ana says they are the Beekeeper/);
    assert.doesNotMatch(seen.text, /Blight/, 'the claim is not the character');

    // Ben claims the same thing, and the table is told plainly.
    const clash = await ben.call('claim', { character: 'beekeeper' });
    assert.equal(clash.isError, false);
    assert.match(clash.text, /CONTESTED/);
    const heard = await cal.call('await_event', { since: 0, timeout_seconds: 5 });
    assert.match(heard.text, /One of them is lying/);

    // And the briefing teaches what to do about it.
    const briefing = await cal.call('briefing');
    assert.match(briefing.text, /Claims, and how to take one apart/);
    assert.match(briefing.text, /Can it ever be checked\?/);

    for (const agent of agents) await agent.close();
    st.close();
  });

  it('refuses storyteller powers to a player', async () => {
    const created = await postJson(port, '/api/games', {
      scriptId: 'whispers-in-the-orchard',
      storytellerName: 'ST',
    });
    const agent = await AgentClient.join(port, created.joinCode, 'Sneak');
    const attempt = await agent.call('storyteller', { action: 'start' });
    assert.equal(attempt.isError, true);
    assert.match(attempt.text, /only the Storyteller/);
    await agent.close();
  });

  it('rejects an unknown seat token', async () => {
    const client = await AgentClient.connect(port, 'stranger');
    const result = await call(client, 'look', { seat_token: 'nope' });
    assert.equal(result.isError, true);
    await client.close();
  });
});
