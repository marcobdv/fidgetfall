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
  toldYou: string[];
  wokeYou: number;
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
  toldYou: [],
  wokeYou: 0,
  notices: [],
});

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
      case 'chat.whisper.observed': {
        const pair = [name(d['fromSeatId']), name(d['toSeatId'])].sort().join(' & ');
        current.whispers.set(pair, (current.whispers.get(pair) ?? 0) + 1);
        break;
      }
      case 'st.info':
        current.toldYou.push(String(d['text']));
        break;
      case 'st.wake':
        current.wokeYou += 1;
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

function narrateNight(act: Act, pick: ReturnType<typeof picker>, index: number): string[] {
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
  if (act.wokeYou) {
    lines.push(
      act.wokeYou === 1
        ? 'The Storyteller woke you once.'
        : `The Storyteller woke you ${act.wokeYou} times.`,
    );
  }
  for (const told of act.toldYou) lines.push(`You were shown: *${told}*`);

  for (const notice of act.notices) lines.push(`The Storyteller: *${notice}*`);

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
          `${death.name} did not wake. ${capitalise(death.cause)} had come in the night.`,
          `${death.name} was found dead — ${death.cause}.`,
          `${death.name}'s seat was empty at dawn. The cause, ${death.cause}.`,
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

  const opener = act.said[0];
  if (opener) lines.push(`${opener.name} opened: *"${trim(opener.text)}"*`);

  // What the Storyteller said out loud is part of the record, not scaffolding.
  for (const notice of act.notices) lines.push(`The Storyteller: *${notice}*`);

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

  const closer = act.said.length > 1 ? act.said.at(-1) : undefined;
  if (closer) lines.push(`Last word before dusk, ${closer.name}: *"${trim(closer.text)}"*`);

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

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const trim = (text: string): string => (text.length > 160 ? `${text.slice(0, 157)}…` : text);

export function writeChronicle(game: Game, viewer: Viewer, options: ChronicleOptions = {}): string {
  const state = game.state;
  const reveal = options.reveal ?? state.phase === 'over';
  const events = game.eventsSince(0, viewer);
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
    const character = game.character(you.characterId);
    out.push(
      character
        ? `You sat ${you.index + 1}${nth(you.index + 1)}, as the ${character.name}.`
        : `You sat ${you.index + 1}${nth(you.index + 1)}.`,
    );
  }

  for (const [index, act] of acts.entries()) {
    const lines =
      act.kind === 'night' ? narrateNight(act, pick, index) : narrateDay(act, pick, index);
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
    out.push('', '## The grimoire', '', '| Seat | Player | Character | Team | Fate |', '|---|---|---|---|---|');
    for (const seat of game.players()) {
      const character = game.character(seat.characterId);
      out.push(
        `| ${seat.index + 1} | ${seat.name} | ${character?.name ?? '—'} | ${character?.team ?? '—'}${seat.alignment ? ` (${seat.alignment})` : ''} | ${seat.alive ? 'survived' : 'died'} |`,
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

const nth = (n: number): string => {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
};
