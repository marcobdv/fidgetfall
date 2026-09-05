/**
 * Re-render a finished game's chronicle from its journal, with today's renderer.
 *
 *   node dist/src/rechronicle.js            # list what is on disk
 *   node dist/src/rechronicle.js <gameId>   # the Storyteller's chronicle
 *   node dist/src/rechronicle.js <gameId> <seatName>
 *
 * This is the reason the journal exists. Six separate renderer bugs were fixed in
 * one afternoon and not one of them could reach a game already played, because
 * the chronicle was generated once from state nothing kept.
 */
import { Game, writeChronicle, type AnyEvent, type Viewer } from '@botc/engine';
import { loadConfig } from './config.js';
import { Journal } from './journal.js';

const config = loadConfig(process.env);
const journal = new Journal(config.journalDir ?? 'journal');
const [gameId, seatName] = process.argv.slice(2);

if (!gameId) {
  const games = journal.list();
  if (!games.length) {
    console.error('No games on disk yet.');
    process.exit(1);
  }
  for (const g of games) {
    const when = g.startedAt ? new Date(g.startedAt).toISOString().slice(0, 16).replace('T', ' ') : '—';
    console.log(`${g.gameId}  ${when}  ${g.name} (${g.scriptId}, ${g.events} events)`);
  }
  process.exit(0);
}

const header = journal.header(gameId);
const events = journal.events(gameId);
if (!header || !events.length) {
  console.error(`No journal for game "${gameId}".`);
  process.exit(1);
}

const snapshot = journal.latestSnapshot(gameId);
if (!snapshot) {
  console.error(`Game "${gameId}" has events but no snapshot — it never reached a phase change.`);
  process.exit(1);
}

// The engine is pure and the log is the whole truth, so the chronicle run over a
// restored game is what it was on the night — plus every renderer fix since.
const game = Game.restore(snapshot);
game.log.length = 0;
game.log.push(...(events as AnyEvent[]));

const seat = seatName
  ? game.players().find((s: { name: string }) => s.name.toLowerCase() === seatName.toLowerCase())
  : undefined;
if (seatName && !seat) {
  console.error(`No player called "${seatName}" in that game.`);
  process.exit(1);
}
const viewer: Viewer = seat ? { kind: 'seat', seatId: seat.id } : { kind: 'storyteller' };
console.log(writeChronicle(game, viewer, { reveal: true }));
