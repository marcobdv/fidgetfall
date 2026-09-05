import type { AnyEvent, Viewer } from './events.js';
import type { Game } from './game.js';

/**
 * Turns a game's event log into something worth reading afterwards.
 *
 * A chronicle is written from one viewer's log, so it carries what that seat
 * actually witnessed — the information the Storyteller showed *you*, the
 * whispers *you* were part of. Other people's secrets stay theirs even after the
 * game; what `reveal` adds is the grimoire, not everyone's private conversations.
 */
export interface ChronicleOptions {
  /** Show who was really who. Defaults to true once the game is over. */
  reveal?: boolean;
}

interface Act {
  kind: 'night' | 'day';
  day: number;
  deaths: { name: string; cause: string }[];
  revivals: string[];
  executions: (string | null)[];
  exiles: string[];
  nominations: {
    nominator: string;
    nominee: string;
    tally?: number;
    threshold?: number;
    result?: string;
  }[];
  said: { name: string; text: string }[];
  whispers: Map<string, number>;
  overheard: { from: string; to: string[]; text: string }[];
  abilities: string[];
  records: string[];
  /** Who was woken in the night, and what each of them was shown. */
  woken: { seatId: string; name: string; wakes: number; told: string[] }[];
  notices: string[];
}

const emptyAct = (kind: Act['kind'], day: number): Act => ({
  kind,
  day,
  deaths: [],
  revivals: [],
  executions: [],
  exiles: [],
  nominations: [],
  said: [],
  whispers: new Map(),
  overheard: [],
  abilities: [],
  records: [],
  woken: [],
  notices: [],
});

/** " (Gambler)", but only for a reader entitled to know it. */
function roleTag(ctx: { game: Game; namesRoles: boolean }, seatId: string): string {
  if (!ctx.namesRoles) return '';
  const seat = ctx.game.seat(seatId);
  const character = ctx.game.character(seat?.characterId);
  if (!character) return '';
  const believed = ctx.game.character(seat?.believedCharacterId);
  return believed ? ` (${character.name}, who thinks they are the ${believed.name})` : ` (${character.name})`;
}

/** One row per player woken that night, in the order they were first woken. */
function wokenEntry(act: Act, game: Game, seatId: string): Act['woken'][number] {
  const found = act.woken.find((entry) => entry.seatId === seatId);
  if (found) return found;
  const entry = { seatId, name: game.seat(seatId)?.name ?? '?', wakes: 0, told: [] as string[] };
  act.woken.push(entry);
  return entry;
}

/** Deterministic per-game variety: the same game always reads the same way. */
function picker(seed: string): (index: number, options: string[]) => string {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (index, options) => {
    const value = Math.abs((hash ^ Math.imul(index + 1, 2654435761)) >>> 0);
    return options[value % options.length] ?? options[0] ?? '';
  };
}

const list = (items: string[]): string => {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
};

const CARDINALS = [
  'Nobody', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven',
  'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
];
const cardinal = (n: number): string => CARDINALS[n] ?? String(n);

function collect(game: Game, events: AnyEvent[]): Act[] {
  const acts: Act[] = [];
  // Day 0 marks the pre-game placeholder; the filter at the end drops it.
  let current = emptyAct('night', 0);
  let started = false;
  const name = (seatId: unknown) =>
    (typeof seatId === 'string' ? game.seat(seatId)?.name : undefined) ?? 'someone';

  for (const event of events) {
    const d = event.data as Record<string, unknown>;
    if (event.type === 'phase.changed') {
      const phase = d['phase'] as string;
      const day = d['day'] as number;
      if (phase === 'night' || (phase === 'day' && current.kind === 'night')) {
        if (started) acts.push(current);
        current = emptyAct(phase === 'night' ? 'night' : 'day', day);
        started = true;
      }
      continue;
    }
    if (!started && event.type !== 'game.created') started = true;

    switch (event.type) {
      case 'player.died':
        current.deaths.push({ name: String(d['name']), cause: String(d['cause']) });
        break;
      case 'player.revived':
        current.revivals.push(String(d['name']));
        break;
      case 'execution':
        current.executions.push(d['name'] === null ? null : String(d['name']));
        break;
      case 'exile':
        current.exiles.push(String(d['name']));
        break;
      case 'nomination.made':
        current.nominations.push({
          nominator: String(d['nominatorName']),
          nominee: String(d['nomineeName']),
        });
        break;
      case 'nomination.closed': {
        const last = current.nominations.at(-1);
        if (last) {
          last.tally = d['tally'] as number;
          last.threshold = d['threshold'] as number;
          last.result = d['result'] as string;
        }
        break;
      }
      case 'chat.public':
        current.said.push({ name: String(d['fromName']), text: String(d['text']) });
        break;
      case 'chat.whisper':
        // You only ever reach this if you were in the conversation — or you are the
        // Storyteller, who hears everything. Either way it belongs in your record.
        current.overheard.push({
          from: String(d['fromName']),
          to: ((d['toNames'] as string[]) ?? []).map(String),
          text: String(d['text']),
        });
        break;
      case 'player.ability': {
        const targets = ((d['targetNames'] as string[]) ?? []).map(String);
        current.abilities.push(
          `**${d['name']}** used their ability${targets.length ? ` on ${targets.join(' and ')}` : ''}${d['text'] ? ` — "${d['text']}"` : ''}`,
        );
        break;
      }
      case 'player.ability.resolved':
        if (d['text']) current.abilities.push(`The Storyteller: *${d['text']}*`);
        break;
      case 'conversation.opened': {
        const names = ((d['names'] as string[]) ?? []).map(String);
        const group = [...names].sort().join(' & ');
        current.whispers.set(group, (current.whispers.get(group) ?? 0) + 1);
        break;
      }
      case 'st.info':
        wokenEntry(current, game, String(d['seatId'])).told.push(String(d['text']));
        break;
      case 'st.wake': {
        // A wake carries a prompt, and the prompt is usually the whole substance of
        // the waking — "your demon is X, your fellow minion is Y". Counting the wake
        // and throwing the words away rendered every one of them as "shown nothing".
        const entry = wokenEntry(current, game, String(d['seatId']));
        entry.wakes += 1;
        if (d['prompt']) entry.told.push(String(d['prompt']));
        break;
      }
      case 'st.record':
        current.records.push(String(d['text']));
        break;
      case 'system.notice':
        current.notices.push(String(d['text']));
        break;
      default:
        break;
    }
  }
  if (started) acts.push(current);
  return acts.filter((act) => act.day > 0);
}

function narrateNight(
  act: Act,
  pick: ReturnType<typeof picker>,
  index: number,
  ctx: { game: Game; viewerSeatId?: string; namesRoles: boolean },
): string[] {
  const lines: string[] = [];
  if (act.day === 1) {
    lines.push(
      pick(index, [
        'The first night was the quiet one — the night the town was made.',
        'On the first night nothing was taken, only assigned.',
        'The town went to sleep strangers and woke up suspects.',
      ]),
    );
  }
  // A bare count of wakings tells you nothing, and it is not all one person's night —
  // the Storyteller sees every wake, so each one is named for whoever it happened to.
  // Each entry is one paragraph: the caller separates them with a blank line, so a
  // list must be a single joined string or every bullet grows a gap.
  for (const entry of act.woken) {
    const mine = entry.seatId === ctx.viewerSeatId;
    const who = mine ? 'You' : `${entry.name}${roleTag(ctx, entry.seatId)}`;
    const was = mine ? 'were' : 'was';
    if (entry.told.length) {
      lines.push(
        [`**${who} ${was} woken, and shown this:**`, ...entry.told.map((told) => `- *${told}*`)].join(
          '\n',
        ),
      );
    } else {
      lines.push(
        `${who} ${was} woken${entry.wakes > 1 ? ` ${entry.wakes} times` : ''}, and shown nothing.`,
      );
    }
  }

  for (const notice of act.notices) lines.push(`The Storyteller: *${notice}*`);
  for (const record of act.records) lines.push(`> ${record}`);

  if (act.deaths.length === 0) {
    if (act.day > 1) {
      lines.push(
        pick(index + 100, [
          'Nobody died. Everybody noticed.',
          'The night passed without a body, which is its own kind of information.',
          'Morning came and the count was unchanged — the town would have to explain that.',
        ]),
      );
    }
  } else {
    for (const death of act.deaths) {
      lines.push(
        pick(index + death.name.length, [
          `${death.name} did not wake — ${death.cause}.`,
          `${death.name} was found dead at dawn — ${death.cause}.`,
          `${death.name}'s seat was empty in the morning. The cause: ${death.cause}.`,
        ]),
      );
    }
  }
  return lines;
}

function narrateDay(act: Act, pick: ReturnType<typeof picker>, index: number): string[] {
  const lines: string[] = [];

  if (act.said.length === 0 && act.nominations.length === 0) {
    lines.push(
      pick(index, [
        'The day passed with almost nothing said aloud.',
        'A short day. Nobody wanted to go first.',
      ]),
    );
  }

  // Everything said in the square, in order. The line that decides a game is
  // almost never the first or the last one.
  if (act.said.length) {
    const shown = act.said.slice(0, MAX_QUOTED_PER_DAY);
    lines.push(
      ['**In the square:**', ...shown.map((s) => `- **${s.name}:** "${trim(s.text)}"`)].join('\n'),
    );
    if (act.said.length > shown.length) {
      lines.push(`…and ${act.said.length - shown.length} more things said that day.`);
    }
  }

  // What the Storyteller said out loud is part of the record, not scaffolding.
  for (const notice of act.notices) lines.push(`The Storyteller: *${notice}*`);
  for (const record of act.records) lines.push(`> ${record}`);

  // Abilities used in the open are acts of the day, not chatter, and read as such.
  if (act.abilities.length) {
    lines.push(['**In the open:**', ...act.abilities.map((line) => `- ${line}`)].join('\n'));
  }

  // The private layer. For a player this is only what they were standing in; for the
  // Storyteller it is all of it, which is where the Demon's bluffs live.
  if (act.overheard.length) {
    const quoted = act.overheard
      .slice(0, MAX_QUOTED_PER_DAY)
      .map((line) => `- **${line.from}** to **${line.to.join(' and ')}:** "${line.text}"`);
    if (act.overheard.length > MAX_QUOTED_PER_DAY) {
      quoted.push(`- *…and ${act.overheard.length - MAX_QUOTED_PER_DAY} more.*`);
    }
    lines.push(['**Out of earshot:**', ...quoted].join('\n'));
  }

  const whispers = [...act.whispers.entries()].sort((a, b) => b[1] - a[1]);
  if (whispers.length) {
    const total = whispers.reduce((sum, [, count]) => sum + count, 0);
    const busiest = whispers[0];
    lines.push(
      `${total} private ${total === 1 ? 'conversation' : 'conversations'} happened where the town could see them but not hear them` +
        (busiest && busiest[1] > 1 ? ` — ${busiest[0]} stepped aside ${busiest[1]} times.` : '.'),
    );
  }

  for (const nomination of act.nominations) {
    if (nomination.result === 'on-block') {
      lines.push(
        pick(index + nomination.nominee.length, [
          `${nomination.nominator} rose against ${nomination.nominee}. ${nomination.tally} hands went up where ${nomination.threshold} were needed, and ${nomination.nominee} went to the block.`,
          `${nomination.nominator} named ${nomination.nominee}, and the town agreed — ${nomination.tally} votes where ${nomination.threshold} would have done. ${nomination.nominee} was on the block.`,
        ]),
      );
    } else if (nomination.result === 'tied') {
      lines.push(
        `${nomination.nominator} nominated ${nomination.nominee} and drew level at ${nomination.tally}. A tie clears the block, so it cleared — and nobody was condemned.`,
      );
    } else if (nomination.result === 'exiled') {
      lines.push(
        `${nomination.nominator} called for ${nomination.nominee}'s exile, and the table gave it — ${nomination.tally} votes where ${nomination.threshold} were needed.`,
      );
    } else if (nomination.result === 'not-exiled') {
      lines.push(`${nomination.nominator} moved to exile ${nomination.nominee}. The table would not have it.`);
    } else {
      lines.push(
        pick(index + nomination.nominator.length, [
          `${nomination.nominator}'s nomination of ${nomination.nominee} died on the floor — ${nomination.tally} of the ${nomination.threshold} it needed.`,
          `${nomination.nominator} went after ${nomination.nominee} and found no company — ${nomination.tally} votes where ${nomination.threshold} were needed.`,
        ]),
      );
    }
  }

  for (const execution of act.executions) {
    lines.push(
      execution === null
        ? pick(index + 7, [
            'Dusk came and nobody was executed. A whole day spent, and the town had nothing to show for it.',
            'No execution. The town let the day go.',
          ])
        : `At dusk, **${execution}** was executed.`,
    );
  }
  for (const exile of act.exiles) lines.push(`**${exile}** was exiled from the town.`);
  for (const revival of act.revivals) lines.push(`${revival} was among the living again.`);

  return lines;
}

const MAX_QUOTED_PER_DAY = 60;

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const trim = (text: string): string => (text.length > 240 ? `${text.slice(0, 237)}…` : text);

export function writeChronicle(game: Game, viewer: Viewer, options: ChronicleOptions = {}): string {
  const state = game.state;
  const reveal = options.reveal ?? state.phase === 'over';
  let events = game.eventsSince(0, viewer);
  // The Storyteller's private notes are exactly the things they were right not to say
  // out loud. At the reveal they belong in everybody's copy — that is the whole point
  // of writing them down instead of announcing them.
  if (reveal && viewer.kind !== 'storyteller') {
    const records = game
      .eventsSince(0, { kind: 'storyteller' })
      .filter((event) => event.type === 'st.record');
    events = [...events, ...records].sort((a, b) => a.seq - b.seq);
  }
  const acts = collect(game, events);
  const pick = picker(state.id);

  const out: string[] = [];
  out.push(`# The Chronicle of ${state.name}`);
  out.push(
    `*${state.script.name} · ${game.players().length} players · told by ${game.storyteller.name}*`,
  );

  if (state.phase === 'lobby') {
    out.push('', 'The town has not opened yet. There is nothing to tell.');
    return out.join('\n');
  }

  out.push('', '## The town');
  const count = game.players().length;
  out.push(
    `${cardinal(count)} of them — ${list(game.players().map((s) => s.name))} — took ${count === 1 ? 'a seat' : 'their seats'} around the square.`,
  );
  const you = viewer.kind === 'seat' ? game.seat(viewer.seatId) : undefined;
  if (you) {
    const seatNo = `${you.index + 1}${nth(you.index + 1)}`;
    const truth = game.character(you.characterId);
    const believed = game.character(you.believedCharacterId);
    // Until the reveal you get the game you thought you played, which for a Drunk is
    // the only one they had. Afterwards, the sentence that recontextualises all of it.
    if (believed && reveal && truth) {
      out.push(`You sat ${seatNo}, as the ${believed.name}. You were never the ${believed.name}. You were the ${truth.name}, and every word I whispered to you was false.`);
    } else if (believed) {
      out.push(`You sat ${seatNo}, as the ${believed.name}.`);
    } else {
      out.push(truth ? `You sat ${seatNo}, as the ${truth.name}.` : `You sat ${seatNo}.`);
    }
  }

  for (const [index, act] of acts.entries()) {
    const lines =
      act.kind === 'night'
        ? narrateNight(act, pick, index, {
            game,
            ...(viewer.kind === 'seat' ? { viewerSeatId: viewer.seatId } : {}),
            // Only somebody entitled to know a character may see it in the margin.
            namesRoles: viewer.kind === 'storyteller' || reveal,
          })
        : narrateDay(act, pick, index);
    if (!lines.length) continue;
    out.push('', `## ${act.kind === 'night' ? 'Night' : 'Day'} ${act.day}`);
    out.push(lines.join('\n\n'));
  }

  out.push('', '## How it ended');
  if (state.phase === 'over' && state.winner) {
    out.push(
      `**${capitalise(state.winner)} won.** ${state.endedReason ?? ''}`.trim(),
      '',
      pick(999, [
        'The clocktower kept its time, as it always does, and the town went home.',
        'Whatever was true stopped mattering the moment it was said out loud.',
        'Somebody had been right the whole time. That is the part nobody remembers.',
      ]),
    );
  } else {
    out.push(
      `It has not. The town is at ${state.phase}, day ${state.day}, with ${game.alivePlayers().length} of ${game.players().length} still breathing.`,
    );
  }

  if (reveal) {
    out.push(...postMortem(game));
    out.push('', '## The grimoire', '', '| Seat | Player | Character | Team | Fate |', '|---|---|---|---|---|');
    for (const seat of game.players()) {
      const character = game.character(seat.characterId);
      const believed = game.character(seat.believedCharacterId);
      const name = believed
        ? `${character?.name ?? '—'} — thought they were the ${believed.name}`
        : (character?.name ?? '—');
      out.push(
        `| ${seat.index + 1} | ${seat.name} | ${name} | ${character?.team ?? '—'}${seat.alignment ? ` (${seat.alignment})` : ''} | ${seat.alive ? 'survived' : 'died'} |`,
      );
    }
  }

  const nominations = acts.reduce((sum, act) => sum + act.nominations.length, 0);
  const executions = acts.reduce(
    (sum, act) => sum + act.executions.filter((name) => name !== null).length,
    0,
  );
  const whispers = acts.reduce(
    (sum, act) => sum + [...act.whispers.values()].reduce((inner, count) => inner + count, 0),
    0,
  );
  const spoken = acts.reduce((sum, act) => sum + act.said.length, 0);
  out.push(
    '',
    '## By the numbers',
    '',
    `- ${state.day} ${state.day === 1 ? 'day' : 'days'}`,
    `- ${nominations} ${nominations === 1 ? 'nomination' : 'nominations'}, ${executions} ${executions === 1 ? 'execution' : 'executions'}`,
    `- ${spoken} ${spoken === 1 ? 'thing' : 'things'} said in the square, ${whispers} said out of earshot`,
    `- ${game.players().filter((s) => !s.alive).length} of ${game.players().length} dead by the end`,
  );

  return out.join('\n');
}

/**
 * What each player actually thought, laid against what was true. Their notes
 * are private for the whole game and open at the end — which is the moment you
 * find out whether anyone was reasoning or just voting.
 */
function postMortem(game: Game): string[] {
  const out: string[] = [];
  const players = game.players();

  const beliefs: string[] = [];
  for (const seat of players) {
    const notes = game.notesFor(seat.id);
    if (!notes.length) continue;
    const own = game.character(seat.characterId);
    const thought = game.character(seat.believedCharacterId);
    beliefs.push(
      '',
      `**${seat.name}** — ${own ? `${own.name}, ${seat.alignment ?? 'good'}` : 'no character'}${thought ? ` (believed they were the ${thought.name}, so read every line below knowing they were working from lies)` : ''}`,
    );
    for (const note of notes) {
      const target = game.seat(note.targetSeatId);
      if (!target) continue;
      const truth = game.character(target.characterId);
      const said: string[] = [];
      if (note.alignment) {
        const right = note.alignment !== 'unknown' && note.alignment === target.alignment;
        said.push(`${note.alignment} ${note.alignment === 'unknown' ? '' : right ? '✓' : '✗'}`.trim());
      }
      if (note.teams.length) {
        const right = truth ? note.teams.includes(truth.team) : false;
        said.push(`${note.teams.join('/')} ${right ? '✓' : '✗'}`);
      }
      if (note.characters.length) {
        const right = truth ? note.characters.includes(truth.id) : false;
        said.push(
          `${note.characters.map((id) => game.character(id)?.name ?? id).join('/')} ${right ? '✓' : '✗'}`,
        );
      }
      if (note.confidence) said.push(`(${note.confidence})`);
      beliefs.push(
        `- on **${target.name}** — ${said.join(', ') || 'no read'}${
          truth ? `, and they were the ${truth.name}` : ''
        }`,
      );
      if (note.text) beliefs.push(`  > ${note.text}`);
    }
  }
  if (beliefs.length) {
    out.push(
      '',
      '## What everyone believed',
      '',
      'Every private note, opened at the end and marked against the grimoire.',
      ...beliefs,
    );
  }

  const stories: string[] = [];
  for (const seat of players) {
    const claims = game.claimsMadeBy(seat.id);
    if (!claims.length) continue;
    const truth = game.character(seat.characterId);
    const told = claims.map((c) => {
      const names = c.characterIds.map((id) => game.character(id)?.name ?? id);
      const audience = c.toSeatId ? (game.seat(c.toSeatId)?.name ?? '?') : 'the whole town';
      // A hedge reads as what it was: "one of X, Y or Z", not three separate lies.
      const what = names.length > 1 ? `one of ${list(names)}` : (names[0] ?? '—');
      return `${what} to ${audience}`;
    });
    // A hedge is honest if the truth was somewhere inside it.
    const honest = claims.every((c) => c.characterIds.includes(seat.characterId ?? ''));
    stories.push(
      `- **${seat.name}** was the ${truth?.name ?? 'unassigned'} and said: ${told.join('; ')}${
        honest ? '' : ' — not all of that was true'
      }`,
    );
  }
  if (stories.length) {
    out.push(
      '',
      '## What everyone said they were',
      '',
      'Including the versions only one person heard.',
      ...stories,
    );
  }

  return out;
}

const nth = (n: number): string => {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
};
