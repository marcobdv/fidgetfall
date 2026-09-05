import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { writeChronicle, type AnyEvent } from '@botc/engine';
import { RECAP_PROMPT, writeBriefing } from './briefing.js';
import { CommandSchema, execute, resolveSeat, type Command } from './commands.js';
import { renderEvents, renderNote, renderScriptCharacters, renderView } from './render.js';
import type { Room, RoomManager } from './rooms.js';
import type { ScriptStore } from './scriptStore.js';
import type { Config } from './config.js';

export interface McpDeps {
  config: Config;
  rooms: RoomManager;
  scripts: ScriptStore;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] });
const fail = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }], isError: true });

const SEAT_TOKEN = z
  .string()
  .describe('The seat token you were given by join_game or create_game. It identifies you.');

/** Wait until this seat can see something new, or the deadline passes. */
async function waitForVisible(
  room: Room,
  seatId: string,
  since: number,
  timeoutMs: number,
): Promise<{ events: AnyEvent[]; cursor: number }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = room.events(seatId, since);
    if (events.length) return { events, cursor: room.game.log.length };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { events: [], cursor: room.game.log.length };
    await room.waitForEvents(room.game.log.length, remaining);
  }
}

const ST_ACTIONS = [
  'start',
  'advance_phase',
  'set_phase',
  'assign',
  'set_alignment',
  'add_reminder',
  'remove_reminder',
  'set_restriction',
  'set_traveller',
  'set_ghost_vote',
  'kill',
  'revive',
  'wake',
  'sleep',
  'info',
  'message',
  'announce',
  'close_nomination',
  'cancel_nomination',
  'set_on_block',
  'move_seat',
  'end_game',
  'set_timer',
  'clear_timers',
] as const;

type StAction = (typeof ST_ACTIONS)[number];

interface StArgs {
  action: StAction;
  player?: string | undefined;
  text?: string | undefined;
  character?: string | undefined;
  alignment?: 'good' | 'evil' | undefined;
  phase?: 'night' | 'day' | 'nominations' | 'dusk' | undefined;
  label?: string | undefined;
  reminder_id?: string | undefined;
  restriction?: 'whisper' | 'nominate' | 'vote' | undefined;
  allowed?: boolean | undefined;
  winner?: 'good' | 'evil' | undefined;
  to_index?: number | undefined;
  timer?: 'night' | 'day' | 'nominations' | 'dusk' | 'vote' | undefined;
  seconds?: number | null | undefined;
}

/** Flatten the Storyteller tool's arguments into an engine command. */
function toCommand(args: StArgs): { ok: true; command: Command } | { ok: false; error: string } {
  const need = <T>(value: T | undefined, field: string): T | undefined => {
    if (value === undefined || value === null || value === '') {
      missing = field;
      return undefined;
    }
    return value;
  };
  let missing: string | null = null;
  let raw: unknown;

  switch (args.action) {
    case 'start':
      raw = { type: 'st_start' };
      break;
    case 'advance_phase':
      raw = { type: 'st_advance_phase' };
      break;
    case 'set_phase':
      raw = { type: 'st_set_phase', phase: need(args.phase, 'phase') };
      break;
    case 'assign':
      raw = {
        type: 'st_assign',
        target: need(args.player, 'player'),
        character: need(args.character, 'character'),
        ...(args.alignment ? { alignment: args.alignment } : {}),
      };
      break;
    case 'set_alignment':
      raw = {
        type: 'st_set_alignment',
        target: need(args.player, 'player'),
        alignment: need(args.alignment, 'alignment'),
      };
      break;
    case 'add_reminder':
      raw = { type: 'st_add_reminder', target: need(args.player, 'player'), label: need(args.label, 'label') };
      break;
    case 'remove_reminder':
      raw = {
        type: 'st_remove_reminder',
        target: need(args.player, 'player'),
        reminderId: need(args.reminder_id, 'reminder_id'),
      };
      break;
    case 'set_restriction':
      raw = {
        type: 'st_set_restriction',
        target: need(args.player, 'player'),
        key: need(args.restriction, 'restriction'),
        allowed: args.allowed ?? false,
      };
      break;
    case 'set_traveller':
      raw = { type: 'st_set_traveller', target: need(args.player, 'player'), isTraveller: args.allowed ?? true };
      break;
    case 'set_ghost_vote':
      raw = { type: 'st_set_ghost_vote', target: need(args.player, 'player'), available: args.allowed ?? true };
      break;
    case 'kill':
      raw = {
        type: 'st_kill',
        target: need(args.player, 'player'),
        ...(args.text ? { cause: args.text } : {}),
      };
      break;
    case 'revive':
      raw = { type: 'st_revive', target: need(args.player, 'player') };
      break;
    case 'wake':
      raw = {
        type: 'st_wake',
        target: need(args.player, 'player'),
        ...(args.text ? { prompt: args.text } : {}),
      };
      break;
    case 'sleep':
      raw = { type: 'st_sleep', target: need(args.player, 'player') };
      break;
    case 'info':
      raw = { type: 'st_info', target: need(args.player, 'player'), text: need(args.text, 'text') };
      break;
    case 'message':
      raw = { type: 'st_message', target: need(args.player, 'player'), text: need(args.text, 'text') };
      break;
    case 'announce':
      raw = { type: 'st_announce', text: need(args.text, 'text') };
      break;
    case 'close_nomination':
      raw = { type: 'st_close_nomination' };
      break;
    case 'cancel_nomination':
      raw = { type: 'st_cancel_nomination' };
      break;
    case 'set_on_block':
      raw = { type: 'st_set_on_block', target: args.player ?? null };
      break;
    case 'move_seat':
      raw = {
        type: 'st_move_seat',
        target: need(args.player, 'player'),
        toIndex: need(args.to_index, 'to_index') ?? 0,
      };
      break;
    case 'set_timer':
      raw = {
        type: 'st_set_timer',
        key: need(args.timer, 'timer'),
        seconds: args.seconds === undefined ? null : args.seconds,
      };
      break;
    case 'clear_timers':
      raw = { type: 'st_clear_timers' };
      break;
    case 'end_game':
      raw = {
        type: 'st_end_game',
        winner: need(args.winner, 'winner'),
        reason: args.text ?? 'The Storyteller called the game.',
      };
      break;
  }

  if (missing) return { ok: false, error: `the "${args.action}" action needs a "${missing}" argument` };
  const parsed = CommandSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid arguments' };
  return { ok: true, command: parsed.data };
}

export function buildMcpServer(deps: McpDeps): McpServer {
  const { rooms, scripts } = deps;
  const server = new McpServer(
    { name: 'botc', version: '0.1.0' },
    {
      instructions:
        'Blood on the Clocktower. Join a town, then loop: await_event to wait for something to ' +
        'happen, look to re-read the situation, and say/whisper/nominate/vote to act. The ' +
        'Storyteller (a human or another agent) rules on every character ability — ask them ' +
        'through message_storyteller rather than assuming.',
    },
  );

  const seated = (token: string): { room: Room; seatId: string } | undefined => {
    const resolved = rooms.resolve(token);
    return resolved ? { room: resolved.room, seatId: resolved.session.seatId } : undefined;
  };

  const run = (token: string, command: Command, after: (room: Room, seatId: string) => string): ToolResult => {
    const found = seated(token);
    if (!found) return fail('That seat token is not valid. Join the game again.');
    const result = execute(found.room, found.seatId, command);
    if (!result.ok) return fail(result.error);
    return text(after(found.room, found.seatId));
  };

  server.registerTool(
    'list_scripts',
    {
      title: 'List scripts',
      description: 'The scripts this server can run a game on.',
      inputSchema: {},
    },
    async () =>
      text(
        scripts
          .summaries()
          .map(
            (s) =>
              `- ${s.id}: ${s.name}${s.author ? ` by ${s.author}` : ''} — ${s.characters} characters${s.hasAbilityText ? '' : ' (no ability text on this server)'}`,
          )
          .join('\n') || 'No scripts are installed.',
      ),
  );

  server.registerTool(
    'list_games',
    {
      title: 'List games',
      description: 'Games running on this server, with their join codes.',
      inputSchema: {},
    },
    async () => {
      const games = rooms.list();
      if (!games.length) return text('No games are running. Use create_game to start one.');
      return text(
        games
          .map(
            (room) =>
              `- ${room.game.state.name} (join code ${room.game.state.joinCode}) — ${room.game.state.phase}, ` +
              `${room.game.players().length} players, script ${room.game.state.script.name}, storyteller ${room.game.storyteller.name}`,
          )
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'create_game',
    {
      title: 'Create a game',
      description:
        'Open a new town and take the Storyteller seat. Returns your seat token and the join code to share.',
      inputSchema: {
        script_id: z.string().describe('Script id from list_scripts.'),
        storyteller_name: z.string().describe('Your name as Storyteller.'),
        name: z.string().optional().describe('Name for the town. Defaults to the script name.'),
      },
    },
    async ({ script_id, storyteller_name, name }) => {
      if (deps.config.adminToken) {
        return fail('This server requires an admin token to create games; ask the operator to open one for you.');
      }
      const stored = scripts.get(script_id);
      if (!stored) return fail(`No script "${script_id}". Call list_scripts first.`);
      const { room, session } = rooms.create({
        name: name ?? stored.script.name,
        script: stored.script,
        storytellerName: storyteller_name,
        storytellerKind: 'agent',
      });
      return text(
        [
          `Created "${room.game.state.name}" on ${stored.script.name}.`,
          `Join code: ${room.game.state.joinCode}`,
          `Your seat token (keep it, it is your identity): ${session.token}`,
          `Web players can join at ${deps.config.publicUrl}/?code=${room.game.state.joinCode}`,
          '',
          'Wait for players with await_event, then use storyteller(action:"start") when the town is full.',
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'join_game',
    {
      title: 'Join a game',
      description: 'Take a seat in a town as a player. Returns your seat token.',
      inputSchema: {
        game: z.string().describe('Join code or game id, from list_games.'),
        name: z.string().describe('The name you want at the table.'),
      },
    },
    async ({ game, name }) => {
      const room = rooms.find(game);
      if (!room) return fail(`No game matches "${game}". Call list_games.`);
      const joined = room.game.join(name, 'agent');
      if (!joined.ok) return fail(joined.error);
      const session = rooms.issue(room, joined.value.id);
      room.notify();
      return text(
        [
          `You are seated in "${room.game.state.name}" as ${joined.value.name}, seat ${joined.value.index + 1}.`,
          `Your seat token (keep it, it is your identity): ${session.token}`,
          '',
          renderView(room.view(joined.value.id)),
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'look',
    {
      title: 'Look around',
      description:
        'The whole situation from your seat: phase, every player, votes, the open nomination, and your own character. Read this before acting.',
      inputSchema: { seat_token: SEAT_TOKEN },
    },
    async ({ seat_token }) => {
      const found = seated(seat_token);
      if (!found) return fail('That seat token is not valid.');
      return text(renderView(found.room.view(found.seatId)));
    },
  );

  server.registerTool(
    'read_script',
    {
      title: 'Read the script',
      description: 'Every character that could be in play, by team.',
      inputSchema: { seat_token: SEAT_TOKEN },
    },
    async ({ seat_token }) => {
      const found = seated(seat_token);
      if (!found) return fail('That seat token is not valid.');
      return text(renderScriptCharacters(found.room.view(found.seatId)));
    },
  );

  server.registerTool(
    'await_event',
    {
      title: 'Wait for something to happen',
      description:
        'Blocks until something you can see happens, then returns those events. This is how you wait your turn — do not poll look in a loop.',
      inputSchema: {
        seat_token: SEAT_TOKEN,
        since: z
          .number()
          .int()
          .min(0)
          .describe('Cursor from your last look or await_event. Use 0 to read the game from the start.'),
        timeout_seconds: z.number().int().min(1).max(120).optional().describe('Default 45.'),
      },
    },
    async ({ seat_token, since, timeout_seconds }) => {
      const found = seated(seat_token);
      if (!found) return fail('That seat token is not valid.');
      const { events, cursor } = await waitForVisible(
        found.room,
        found.seatId,
        since,
        (timeout_seconds ?? 45) * 1000,
      );
      if (!events.length) return text(`Nothing happened. Cursor: ${cursor}. Call await_event again.`);
      return text(`${renderEvents(found.room, events)}\n\nCursor: ${cursor}`);
    },
  );

  server.registerTool(
    'say',
    {
      title: 'Speak in the town square',
      description: 'Say something everyone hears. Only during the day.',
      inputSchema: { seat_token: SEAT_TOKEN, text: z.string() },
    },
    async ({ seat_token, text: body }) =>
      run(seat_token, { type: 'say', text: body }, () => 'The town heard you.'),
  );

  server.registerTool(
    'whisper',
    {
      title: 'Whisper to one player',
      description:
        'A private word with one player during the day. The town sees that you stepped aside, but not what was said.',
      inputSchema: {
        seat_token: SEAT_TOKEN,
        player: z.string().describe('Their name or seat number.'),
        text: z.string(),
      },
    },
    async ({ seat_token, player, text: body }) =>
      run(seat_token, { type: 'whisper', target: player, text: body }, () => `You whispered to ${player}.`),
  );

  server.registerTool(
    'message_storyteller',
    {
      title: 'Message the Storyteller',
      description:
        'A private line to the Storyteller: use your ability, ask how a rule works, or make a choice they asked for.',
      inputSchema: { seat_token: SEAT_TOKEN, text: z.string() },
    },
    async ({ seat_token, text: body }) =>
      run(seat_token, { type: 'message_storyteller', text: body }, () => 'The Storyteller has your message.'),
  );

  server.registerTool(
    'nominate',
    {
      title: 'Nominate a player',
      description:
        'Nominate someone for execution during the nominations phase. Once per day, and each player can only be nominated once per day.',
      inputSchema: { seat_token: SEAT_TOKEN, player: z.string().describe('Their name or seat number.') },
    },
    async ({ seat_token, player }) =>
      run(seat_token, { type: 'nominate', target: player }, (room, seatId) =>
        renderView(room.view(seatId)),
      ),
  );

  server.registerTool(
    'vote',
    {
      title: 'Vote on the open nomination',
      description:
        'Vote yes or no. If you are dead, a yes spends your one ghost vote for the rest of the game.',
      inputSchema: { seat_token: SEAT_TOKEN, vote: z.boolean().describe('true for yes, false for no.') },
    },
    async ({ seat_token, vote }) =>
      run(seat_token, { type: 'vote', vote }, (room, seatId) => renderView(room.view(seatId))),
  );

  server.registerTool(
    'briefing',
    {
      title: 'Read your briefing',
      description:
        'Your full instructions for this seat: the rules, your character, how your team wins, how to play it, and how far you are expected to go in deceiving the other players. Read this once when you sit down, and again if the Storyteller changes your character.',
      inputSchema: { seat_token: SEAT_TOKEN },
    },
    async ({ seat_token }) => {
      const found = seated(seat_token);
      if (!found) return fail('That seat token is not valid.');
      return text(writeBriefing(found.room, found.seatId));
    },
  );

  server.registerTool(
    'note',
    {
      title: 'Write a private note on a player',
      description:
        'Your own read on someone, private to you and invisible to everyone including the Storyteller. Record more than one team when you are unsure — "evil, but minion or demon" is exactly what this is for. Fields you leave out keep their current value; pass null to clear one. Your notes come back with every look.',
      inputSchema: {
        seat_token: SEAT_TOKEN,
        player: z.string().describe('Their name or seat number.'),
        alignment: z
          .enum(['good', 'evil', 'unknown'])
          .nullable()
          .optional()
          .describe('"unknown" means you looked and cannot tell — different from having no note.'),
        teams: z
          .array(z.enum(['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled']))
          .nullable()
          .optional()
          .describe('Every group they could still be. List several while you are narrowing it down.'),
        characters: z.array(z.string()).nullable().optional().describe('Suspected character ids from the script.'),
        confidence: z.enum(['maybe', 'likely', 'certain']).nullable().optional(),
        text: z.string().nullable().optional().describe('Why you think so. Write the reasoning, not just the conclusion.'),
      },
    },
    async ({ seat_token, player, ...patch }) => {
      const found = seated(seat_token);
      if (!found) return fail('That seat token is not valid.');
      const result = execute(found.room, found.seatId, {
        type: 'note_set',
        target: player,
        ...patch,
      } as Command);
      if (!result.ok) return fail(result.error);
      const seat = resolveSeat(found.room, player);
      const note = seat ? found.room.game.note(found.seatId, seat.id) : undefined;
      return text(`Noted on ${seat?.name ?? player}: ${note ? renderNote(note) : 'cleared'}`);
    },
  );

  server.registerTool(
    'forget_note',
    {
      title: 'Delete a note',
      description: 'Throw away your note on a player.',
      inputSchema: { seat_token: SEAT_TOKEN, player: z.string() },
    },
    async ({ seat_token, player }) =>
      run(seat_token, { type: 'note_clear', target: player }, () => `Note on ${player} discarded.`),
  );

  server.registerTool(
    'recap',
    {
      title: 'Read the chronicle',
      description:
        'The story of the game so far, from your seat: the nights, the deaths, the nominations and their tallies, and what you personally were shown. Once the game is over it also reveals the grimoire. Useful mid-game to catch up, and at the end to tell the table what happened.',
      inputSchema: { seat_token: SEAT_TOKEN },
    },
    async ({ seat_token }) => {
      const found = seated(seat_token);
      if (!found) return fail('That seat token is not valid.');
      return text(writeChronicle(found.room.game, found.room.viewerFor(found.seatId)));
    },
  );

  server.registerTool(
    'storyteller',
    {
      title: 'Storyteller action',
      description:
        [
          'Everything only the Storyteller may do. Pick an action:',
          '  start — begin the game once everyone is seated',
          '  assign (player, character, alignment?) — put a character in the grimoire',
          '  advance_phase / set_phase (phase) — night -> day -> nominations -> dusk',
          '  wake (player, text? as the prompt) / sleep (player)',
          '  info (player, text) — give a player what their ability shows them',
          '  message (player, text) — a private word; announce (text) — tell the whole town',
          '  kill (player, text? as the cause) / revive (player)',
          '  add_reminder (player, label) / remove_reminder (player, reminder_id)',
          '  set_alignment (player, alignment) / set_traveller (player, allowed) / set_ghost_vote (player, allowed)',
          '  set_restriction (player, restriction, allowed) — take away whisper/nominate/vote',
          '  close_nomination / cancel_nomination / set_on_block (player, omit to clear)',
          '  move_seat (player, to_index) — reorder the circle',
          '  set_timer (timer, seconds) — put a clock on a phase (night/day/nominations/dusk) or on',
          '    a single vote; omit seconds to switch that clock off. The phase then advances itself,',
          '    and votes close themselves, so a table of agents cannot stall. Try day 300, vote 90.',
          '  clear_timers — hand every phase back to your own pacing',
          '  end_game (winner, text? as the reason)',
        ].join('\n'),
      inputSchema: {
        seat_token: SEAT_TOKEN,
        action: z.enum(ST_ACTIONS),
        player: z.string().optional().describe('Name or seat number of the player this acts on.'),
        text: z.string().optional().describe('Message, info, prompt, cause or reason, depending on the action.'),
        character: z.string().optional().describe('Character id, for assign.'),
        alignment: z.enum(['good', 'evil']).optional(),
        phase: z.enum(['night', 'day', 'nominations', 'dusk']).optional(),
        label: z.string().optional().describe('Reminder token text.'),
        reminder_id: z.string().optional(),
        restriction: z.enum(['whisper', 'nominate', 'vote']).optional(),
        allowed: z.boolean().optional(),
        winner: z.enum(['good', 'evil']).optional(),
        to_index: z.number().int().optional(),
        timer: z.enum(['night', 'day', 'nominations', 'dusk', 'vote']).optional(),
        seconds: z.number().int().nullable().optional().describe('5-3600. Omit to switch that clock off.'),
      },
    },
    async (args) => {
      const built = toCommand(args as StArgs);
      if (!built.ok) return fail(built.error);
      return run(args.seat_token, built.command, (room, seatId) => renderView(room.view(seatId)));
    },
  );

  // Prompts, for hosts that surface them: the same briefing and a recap writer.
  server.registerPrompt(
    'play',
    {
      title: 'Play this seat',
      description: 'The full system prompt for your seat: rules, character, team, and how to play it.',
      argsSchema: { seat_token: z.string() },
    },
    ({ seat_token }) => {
      const found = seated(seat_token);
      const body = found
        ? writeBriefing(found.room, found.seatId)
        : 'That seat token is not valid. Call join_game first.';
      return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: body } }] };
    },
  );

  server.registerPrompt(
    'tell_the_story',
    {
      title: 'Retell the game',
      description: 'Turn the chronicle of this game into a short story worth reading aloud.',
      argsSchema: { seat_token: z.string() },
    },
    ({ seat_token }) => {
      const found = seated(seat_token);
      const chronicle = found
        ? writeChronicle(found.room.game, found.room.viewerFor(found.seatId))
        : '(no game — the seat token was not valid)';
      return {
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: `${RECAP_PROMPT}\n\n---\n\n${chronicle}` },
          },
        ],
      };
    },
  );

  return server;
}

/** Stateless streamable-HTTP MCP endpoint: one server instance per request. */
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  deps: McpDeps,
): Promise<void> {
  const server = buildMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
