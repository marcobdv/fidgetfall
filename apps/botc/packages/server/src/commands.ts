import { z } from 'zod';
import { err, ok, type Result, type Seat } from '@botc/engine';
import type { Room } from './rooms.js';

/**
 * One command vocabulary for both transports: the WebSocket client and the MCP
 * server call the same router, so a human and an agent can never diverge on the
 * rules.
 */
export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('say'), text: z.string() }),
  z.object({ type: z.literal('whisper'), target: z.string(), text: z.string() }),
  z.object({ type: z.literal('message_storyteller'), text: z.string() }),
  z.object({ type: z.literal('nominate'), target: z.string() }),
  z.object({ type: z.literal('vote'), vote: z.boolean() }),
  z.object({ type: z.literal('leave') }),
  /** A public, unverified statement of who you are. `null` retracts it. */
  z.object({ type: z.literal('claim'), character: z.string().nullable() }),

  // Private notes: one player's read on another. Never shared, never logged.
  z.object({
    type: z.literal('note_set'),
    target: z.string(),
    alignment: z.enum(['good', 'evil', 'unknown']).nullable().optional(),
    teams: z
      .array(z.enum(['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled']))
      .nullable()
      .optional(),
    characters: z.array(z.string()).nullable().optional(),
    confidence: z.enum(['maybe', 'likely', 'certain']).nullable().optional(),
    text: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('note_clear'), target: z.string() }),

  z.object({ type: z.literal('st_start') }),
  z.object({ type: z.literal('st_advance_phase') }),
  z.object({ type: z.literal('st_set_phase'), phase: z.enum(['night', 'day', 'nominations', 'dusk']) }),
  z.object({ type: z.literal('st_assign'), target: z.string(), character: z.string(), alignment: z.enum(['good', 'evil']).optional() }),
  z.object({ type: z.literal('st_set_alignment'), target: z.string(), alignment: z.enum(['good', 'evil']) }),
  z.object({ type: z.literal('st_add_reminder'), target: z.string(), label: z.string(), source: z.string().optional() }),
  z.object({ type: z.literal('st_remove_reminder'), target: z.string(), reminderId: z.string() }),
  z.object({ type: z.literal('st_set_restriction'), target: z.string(), key: z.enum(['whisper', 'nominate', 'vote']), allowed: z.boolean() }),
  z.object({ type: z.literal('st_set_traveller'), target: z.string(), isTraveller: z.boolean() }),
  z.object({ type: z.literal('st_set_ghost_vote'), target: z.string(), available: z.boolean() }),
  z.object({ type: z.literal('st_kill'), target: z.string(), cause: z.string().optional() }),
  z.object({ type: z.literal('st_revive'), target: z.string() }),
  z.object({ type: z.literal('st_wake'), target: z.string(), prompt: z.string().optional() }),
  z.object({ type: z.literal('st_sleep'), target: z.string() }),
  z.object({ type: z.literal('st_info'), target: z.string(), text: z.string() }),
  z.object({ type: z.literal('st_message'), target: z.string(), text: z.string() }),
  z.object({ type: z.literal('st_announce'), text: z.string() }),
  z.object({ type: z.literal('st_close_nomination') }),
  z.object({ type: z.literal('st_cancel_nomination') }),
  z.object({ type: z.literal('st_set_on_block'), target: z.string().nullable() }),
  z.object({ type: z.literal('st_move_seat'), target: z.string(), toIndex: z.number().int() }),
  z.object({ type: z.literal('st_end_game'), winner: z.enum(['good', 'evil']), reason: z.string() }),
  z.object({
    type: z.literal('st_set_timer'),
    key: z.enum(['night', 'day', 'nominations', 'dusk', 'vote']),
    seconds: z.number().int().nullable(),
  }),
  z.object({ type: z.literal('st_clear_timers') }),
]);

export type Command = z.infer<typeof CommandSchema>;

/** Players may be addressed by seat id, by name, or by seat number ("3"). */
export function resolveSeat(room: Room, reference: string): Seat | undefined {
  const wanted = reference.trim();
  if (!wanted) return undefined;
  const players = room.game.players();
  const byId = room.game.seat(wanted);
  if (byId) return byId;
  const lower = wanted.toLowerCase();
  const byName = players.find((s) => s.name.toLowerCase() === lower);
  if (byName) return byName;
  if (/^\d+$/.test(wanted)) {
    const index = Number(wanted) - 1;
    const bySeat = players[index];
    if (bySeat) return bySeat;
  }
  const partial = players.filter((s) => s.name.toLowerCase().startsWith(lower));
  return partial.length === 1 ? partial[0] : undefined;
}

function target(room: Room, reference: string): Result<Seat> {
  const seat = resolveSeat(room, reference);
  return seat ? ok(seat) : err(`no player matches "${reference}"`);
}

/** Commands that change nothing anyone else can see, so nobody else is woken. */
const PRIVATE_COMMANDS = new Set(['note_set', 'note_clear']);

/** Run a command as `seatId`. Notifies the room's listeners when it succeeds. */
export function execute(room: Room, seatId: string, command: Command): Result<unknown> {
  const result = dispatch(room, seatId, command);
  if (result.ok && !PRIVATE_COMMANDS.has(command.type)) room.notify();
  return result;
}

function dispatch(room: Room, seatId: string, command: Command): Result<unknown> {
  const game = room.game;
  switch (command.type) {
    case 'say':
      return game.sayPublic(seatId, command.text);
    case 'whisper': {
      const to = target(room, command.target);
      return to.ok ? game.whisper(seatId, to.value.id, command.text) : to;
    }
    case 'message_storyteller':
      return game.messageStoryteller(seatId, command.text);
    case 'nominate': {
      const to = target(room, command.target);
      return to.ok ? game.nominate(seatId, to.value.id) : to;
    }
    case 'vote':
      return game.castVote(seatId, command.vote);
    case 'leave':
      return game.leave(seatId);
    case 'claim':
      return game.claim(seatId, command.character);

    case 'note_set': {
      const to = target(room, command.target);
      if (!to.ok) return to;
      return game.setNote(seatId, to.value.id, {
        ...(command.alignment !== undefined ? { alignment: command.alignment } : {}),
        ...(command.teams !== undefined ? { teams: command.teams } : {}),
        ...(command.characters !== undefined ? { characters: command.characters } : {}),
        ...(command.confidence !== undefined ? { confidence: command.confidence } : {}),
        ...(command.text !== undefined ? { text: command.text } : {}),
      });
    }
    case 'note_clear': {
      const to = target(room, command.target);
      return to.ok ? game.clearNote(seatId, to.value.id) : to;
    }

    case 'st_start':
      return game.stStart(seatId);
    case 'st_advance_phase':
      return game.stAdvancePhase(seatId);
    case 'st_set_phase':
      return game.stSetPhase(seatId, command.phase);
    case 'st_assign': {
      const to = target(room, command.target);
      return to.ok
        ? game.stAssignCharacter(seatId, to.value.id, command.character, command.alignment)
        : to;
    }
    case 'st_set_alignment': {
      const to = target(room, command.target);
      return to.ok ? game.stSetAlignment(seatId, to.value.id, command.alignment) : to;
    }
    case 'st_add_reminder': {
      const to = target(room, command.target);
      return to.ok ? game.stAddReminder(seatId, to.value.id, command.label, command.source) : to;
    }
    case 'st_remove_reminder': {
      const to = target(room, command.target);
      return to.ok ? game.stRemoveReminder(seatId, to.value.id, command.reminderId) : to;
    }
    case 'st_set_restriction': {
      const to = target(room, command.target);
      return to.ok ? game.stSetRestriction(seatId, to.value.id, command.key, command.allowed) : to;
    }
    case 'st_set_traveller': {
      const to = target(room, command.target);
      return to.ok ? game.stSetTraveller(seatId, to.value.id, command.isTraveller) : to;
    }
    case 'st_set_ghost_vote': {
      const to = target(room, command.target);
      return to.ok ? game.stSetGhostVote(seatId, to.value.id, command.available) : to;
    }
    case 'st_kill': {
      const to = target(room, command.target);
      return to.ok ? game.stKill(seatId, to.value.id, command.cause ?? 'the Storyteller') : to;
    }
    case 'st_revive': {
      const to = target(room, command.target);
      return to.ok ? game.stRevive(seatId, to.value.id) : to;
    }
    case 'st_wake': {
      const to = target(room, command.target);
      return to.ok ? game.stWake(seatId, to.value.id, command.prompt) : to;
    }
    case 'st_sleep': {
      const to = target(room, command.target);
      return to.ok ? game.stSleep(seatId, to.value.id) : to;
    }
    case 'st_info': {
      const to = target(room, command.target);
      return to.ok ? game.stInfo(seatId, to.value.id, command.text) : to;
    }
    case 'st_message': {
      const to = target(room, command.target);
      return to.ok ? game.stMessage(seatId, to.value.id, command.text) : to;
    }
    case 'st_announce':
      return game.stAnnounce(seatId, command.text);
    case 'st_close_nomination':
      return game.stCloseNomination(seatId);
    case 'st_cancel_nomination':
      return game.stCancelNomination(seatId);
    case 'st_set_on_block': {
      if (command.target === null) return game.stSetOnBlock(seatId, null);
      const to = target(room, command.target);
      return to.ok ? game.stSetOnBlock(seatId, to.value.id) : to;
    }
    case 'st_move_seat': {
      const to = target(room, command.target);
      return to.ok ? game.stMoveSeat(seatId, to.value.id, command.toIndex) : to;
    }
    case 'st_end_game':
      return game.stEndGame(seatId, command.winner, command.reason);
    case 'st_set_timer':
      return game.stSetTimer(seatId, command.key, command.seconds);
    case 'st_clear_timers':
      return game.stClearTimers(seatId);
  }
}
