import {
  PUBLIC,
  ST_ONLY,
  toSeats,
  type AnyEvent,
  type EventPayloads,
  type EventType,
  type GameEvent,
  type Viewer,
  type Visibility,
  canSee,
} from './events.js';
import { nightOrder } from './scripts.js';
import {
  type AbilityUse,
  type Conversation,
  PHASE_CYCLE,
  err,
  ok,
  type Alignment,
  type Character,
  type GameScript,
  type GameState,
  type Nomination,
  type Phase,
  type Restrictions,
  type Claim,
  type Result,
  type Seat,
  type SeatKind,
  type SeatNote,
  type Team,
  type TimerKey,
  type Timers,
} from './types.js';

export interface GameOptions {
  id: string;
  name: string;
  joinCode: string;
  script: GameScript;
  storytellerName: string;
  storytellerKind?: SeatKind;
  /** Injected so tests are deterministic. */
  now?: () => number;
  makeId?: (prefix: string) => string;
}

const MIN_PLAYERS = 3;
const RECOMMENDED_MIN_PLAYERS = 5;
const MAX_MESSAGE = 2000;
/** A "three for three" is three. Past a handful a hedge stops being information. */
const MAX_CLAIMED = 5;
/** Whisper to one, or huddle with a few. Past four people it is not private. */
const MAX_HUDDLE = 4;
/** An abandoned conversation is swept up rather than trapping everyone in it. */
const CONVERSATION_IDLE_MS = 120_000;
/** The five-second call, so a phase never simply vanishes mid-sentence. */
const LAST_CALL_MS = 5_000;

const defaultRestrictions = (): Restrictions => ({ whisper: true, nominate: true, vote: true });

/**
 * The authoritative game. Pure: it owns state and rules but performs no I/O, so
 * the WebSocket server, the MCP server, and the tests all drive the same object.
 *
 * Abilities are *not* automated. The engine runs the town — seating, phases,
 * chat, nominations, votes, deaths, the grimoire — and the Storyteller rules on
 * what characters actually do, exactly as at a physical table.
 */
export class Game {
  readonly state: GameState;
  readonly log: AnyEvent[] = [];

  private readonly now: () => number;
  private readonly makeId: (prefix: string) => string;
  private counter = 0;

  constructor(options: GameOptions) {
    this.now = options.now ?? (() => Date.now());
    this.makeId =
      options.makeId ??
      ((prefix: string) => `${prefix}_${(++this.counter).toString(36)}${Math.random().toString(36).slice(2, 8)}`);

    const storyteller: Seat = {
      id: this.makeId('seat'),
      index: -1,
      name: options.storytellerName,
      kind: options.storytellerKind ?? 'human',
      isStoryteller: true,
      isTraveller: false,
      alive: true,
      ghostVote: false,
      connected: false,
      reminders: [],
      hasNominatedToday: false,
      hasBeenNominatedToday: false,
      restrictions: defaultRestrictions(),
    };

    this.state = {
      id: options.id,
      name: options.name,
      joinCode: options.joinCode,
      createdAt: this.now(),
      phase: 'lobby',
      day: 0,
      script: options.script,
      seats: [storyteller],
      storytellerSeatId: storyteller.id,
      nominations: [],
      claims: [],
      highestTally: 0,
      timers: {},
      notes: new Map(),
      conversations: [],
      abilityUses: [],
      metToday: [],
    };

    this.emit(
      'game.created',
      { name: options.name, scriptId: options.script.id, scriptName: options.script.name },
      PUBLIC,
    );
  }

  // ---------------------------------------------------------------- helpers

  private emit<T extends EventType>(
    type: T,
    data: EventPayloads[T],
    visibility: Visibility,
    actorSeatId?: string,
  ): GameEvent<T> {
    const event = {
      seq: this.log.length + 1,
      at: this.now(),
      type,
      data,
      visibility,
      ...(actorSeatId ? { actorSeatId } : {}),
    } as GameEvent<T>;
    this.log.push(event as AnyEvent);
    return event;
  }

  seat(seatId: string | undefined): Seat | undefined {
    if (!seatId) return undefined;
    return this.state.seats.find((s) => s.id === seatId);
  }

  /** Everyone in the circle: the Storyteller is not a player. */
  players(): Seat[] {
    return this.state.seats.filter((s) => !s.isStoryteller).sort((a, b) => a.index - b.index);
  }

  alivePlayers(): Seat[] {
    return this.players().filter((s) => s.alive);
  }

  get storyteller(): Seat {
    const seat = this.seat(this.state.storytellerSeatId);
    if (!seat) throw new Error('game has no storyteller seat');
    return seat;
  }

  character(characterId: string | undefined): Character | undefined {
    if (!characterId) return undefined;
    return this.state.script.characters.find((c) => c.id === characterId);
  }

  /**
   * Script characters nobody has been given. The good ones are exactly the
   * Demon's safe bluffs, so the Storyteller should not have to work them out by
   * hand at three in the morning.
   */
  charactersNotInPlay(): Character[] {
    const assigned = new Set(
      this.state.seats.map((seat) => seat.characterId).filter((id): id is string => Boolean(id)),
    );
    return this.state.script.characters.filter((c) => !assigned.has(c.id));
  }

  nightOrder(): Character[] {
    return nightOrder(this.state.script, this.state.day <= 1);
  }

  activeNomination(): Nomination | undefined {
    return this.state.nominations.find((n) => n.id === this.state.activeNominationId);
  }

  eventsSince(seq: number, viewer: Viewer): AnyEvent[] {
    return this.log.filter((event) => event.seq > seq && canSee(event, viewer));
  }

  private requireSeat(seatId: string): Result<Seat> {
    const seat = this.seat(seatId);
    return seat ? ok(seat) : err('no such seat');
  }

  private requireStoryteller(seatId: string): Result<Seat> {
    const seat = this.seat(seatId);
    if (!seat) return err('no such seat');
    if (!seat.isStoryteller) return err('only the Storyteller can do that');
    return ok(seat);
  }

  private requirePlayer(seatId: string): Result<Seat> {
    const seat = this.seat(seatId);
    if (!seat) return err('no such seat');
    if (seat.isStoryteller) return err('the Storyteller is not a player');
    return ok(seat);
  }

  private cleanText(text: string): Result<string> {
    const trimmed = text.trim();
    if (!trimmed) return err('message is empty');
    if (trimmed.length > MAX_MESSAGE) return err(`message is longer than ${MAX_MESSAGE} characters`);
    return ok(trimmed);
  }

  // ------------------------------------------------------------ seating

  join(name: string, kind: SeatKind): Result<Seat> {
    const clean = name.trim();
    if (!clean) return err('a name is required');
    if (clean.length > 40) return err('name is too long');
    if (this.state.seats.some((s) => s.name.toLowerCase() === clean.toLowerCase())) {
      return err(`the name "${clean}" is already taken in this game`);
    }
    if (this.state.phase === 'over') return err('this game is over');

    const seat: Seat = {
      id: this.makeId('seat'),
      index: this.players().length,
      name: clean,
      kind,
      isStoryteller: false,
      isTraveller: this.state.phase !== 'lobby',
      alive: true,
      ghostVote: true,
      connected: true,
      reminders: [],
      hasNominatedToday: false,
      hasBeenNominatedToday: false,
      restrictions: defaultRestrictions(),
    };
    this.state.seats.push(seat);
    this.emit(
      'player.joined',
      { seatId: seat.id, name: seat.name, kind: seat.kind, isStoryteller: false },
      PUBLIC,
      seat.id,
    );
    if (seat.isTraveller) {
      this.emit(
        'system.notice',
        { text: `${seat.name} joined mid-game and is seated as a Traveller.` },
        PUBLIC,
      );
    }
    return ok(seat);
  }

  /** A seat the Storyteller claims — used when the Storyteller reconnects. */
  claimStoryteller(kind: SeatKind): Seat {
    const seat = this.storyteller;
    seat.kind = kind;
    return seat;
  }

  leave(seatId: string): Result<void> {
    const found = this.requireSeat(seatId);
    if (!found.ok) return found;
    const seat = found.value;
    if (seat.isStoryteller) return err('the Storyteller cannot leave; end the game instead');
    if (this.state.phase !== 'lobby') {
      // Mid-game departures keep the seat so the grimoire stays intact.
      seat.connected = false;
      this.emit('player.connection', { seatId: seat.id, connected: false }, PUBLIC);
      return ok(undefined);
    }
    this.state.seats = this.state.seats.filter((s) => s.id !== seatId);
    this.players().forEach((s, i) => (s.index = i));
    this.emit('player.left', { seatId: seat.id, name: seat.name }, PUBLIC);
    return ok(undefined);
  }

  setConnected(seatId: string, connected: boolean): Result<void> {
    const found = this.requireSeat(seatId);
    if (!found.ok) return found;
    if (found.value.connected === connected) return ok(undefined);
    found.value.connected = connected;
    this.emit('player.connection', { seatId, connected }, PUBLIC);
    return ok(undefined);
  }

  stMoveSeat(actorSeatId: string, seatId: string, toIndex: number): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const players = this.players();
    const current = players.findIndex((s) => s.id === seatId);
    if (current < 0) return err('no such player');
    const target = Math.max(0, Math.min(players.length - 1, Math.trunc(toIndex)));
    const [moved] = players.splice(current, 1);
    if (!moved) return err('no such player');
    players.splice(target, 0, moved);
    players.forEach((s, i) => (s.index = i));
    this.emit('seating.changed', { order: players.map((s) => s.id) }, PUBLIC, actorSeatId);
    return ok(undefined);
  }

  // ------------------------------------------------------------ lifecycle

  stStart(actorSeatId: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    if (this.state.phase !== 'lobby') return err('the game has already started');
    const players = this.players();
    if (players.length < MIN_PLAYERS) return err(`need at least ${MIN_PLAYERS} players to start`);

    this.state.phase = 'night';
    this.state.day = 1;
    this.resetDay();
    this.emit('game.started', { day: 1, seats: players.length }, PUBLIC, actorSeatId);
    this.emit('phase.changed', { phase: 'night', day: 1, previous: 'lobby' }, PUBLIC, actorSeatId);
    this.startPhaseClock('night');
    if (players.length < RECOMMENDED_MIN_PLAYERS) {
      this.emit(
        'system.notice',
        { text: `Started with ${players.length} players; the game is designed for ${RECOMMENDED_MIN_PLAYERS}+.` },
        ST_ONLY,
      );
    }
    return ok(undefined);
  }

  /** Step to the next phase in the night -> day -> nominations -> dusk cycle. */
  stAdvancePhase(actorSeatId: string): Result<Phase> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    if (this.state.phase === 'lobby') return err('start the game first');
    if (this.state.phase === 'over') return err('this game is over');

    const index = PHASE_CYCLE.indexOf(this.state.phase);
    const next = PHASE_CYCLE[(index + 1) % PHASE_CYCLE.length];
    if (!next) return err('cannot determine the next phase');
    return this.stSetPhase(actorSeatId, next);
  }

  stSetPhase(actorSeatId: string, next: Phase): Result<Phase> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    if (next === 'lobby') return err('cannot return to the lobby');
    if (next === 'over') return err('use end_game to finish the game');
    if (this.state.phase === 'over') return err('this game is over');
    if (this.state.phase === 'lobby') return err('start the game first');

    const previous = this.state.phase;
    // Close any nomination still on the floor first: it may put someone on the block.
    if (this.activeNomination()) this.closeNominationInternal(actorSeatId, false);
    if (previous === 'nominations' && next === 'dusk') this.resolveExecution(actorSeatId);

    if (next === 'night' && previous !== 'night') {
      this.state.day += 1;
      this.resetDay();
    }
    // Wherever the day goes next, everyone comes back into the square first.
    if (previous === 'day' || previous === 'nominations') {
      this.closeAllConversations(
        next === 'gather' ? 'the Storyteller called the town together' : 'the day moved on',
      );
    }
    this.state.phase = next;
    this.emit('phase.changed', { phase: next, day: this.state.day, previous }, PUBLIC, actorSeatId);
    this.startPhaseClock(next);
    return ok(next);
  }

  stEndGame(actorSeatId: string, winner: Alignment, reason: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    if (this.state.phase === 'over') return err('this game is already over');
    this.state.phase = 'over';
    this.state.winner = winner;
    this.state.endedReason = reason;
    this.emit('game.ended', { winner, reason }, PUBLIC, actorSeatId);
    // The roll call. Every table does this and the server should not make the
    // Storyteller type it out: once the game is over, everyone is named.
    this.emit(
      'game.rollcall',
      {
        seats: this.players().map((seat) => {
          const character = this.character(seat.characterId);
          const believed = this.character(seat.believedCharacterId);
          return {
            index: seat.index + 1,
            name: seat.name,
            characterName: character?.name ?? 'unassigned',
            team: character?.team ?? 'unknown',
            alignment: seat.alignment ?? 'unknown',
            ...(believed ? { believedCharacterName: believed.name } : {}),
            alive: seat.alive,
          };
        }),
      },
      PUBLIC,
      actorSeatId,
    );
    return ok(undefined);
  }

  private resetDay(): void {
    for (const seat of this.state.seats) {
      seat.hasNominatedToday = false;
      seat.hasBeenNominatedToday = false;
    }
    this.state.onBlockSeatId = undefined;
    this.state.highestTally = 0;
    this.state.metToday = [];
  }

  // ------------------------------------------------------------ chat

  sayPublic(actorSeatId: string, text: string): Result<void> {
    const found = this.requireSeat(actorSeatId);
    if (!found.ok) return found;
    const seat = found.value;
    const clean = this.cleanText(text);
    if (!clean.ok) return clean;

    if (!seat.isStoryteller) {
      if (this.state.phase === 'night') return err('the town square is silent at night');
      if (this.state.phase === 'over') return err('this game is over');
    }
    this.emit(
      'chat.public',
      { fromSeatId: seat.id, fromName: seat.name, text: clean.value },
      PUBLIC,
      seat.id,
    );
    return ok(undefined);
  }

  /** The conversation this player is currently standing in, if any. */
  conversationOf(seatId: string): Conversation | undefined {
    return this.state.conversations.find((c) => c.seatIds.includes(seatId));
  }

  /** Every conversation standing apart right now, for the Storyteller and the view. */
  openConversations(): Conversation[] {
    return this.state.conversations;
  }

  /** Who has stepped aside with whom today, most-frequent first. */
  metToday(): { names: string[]; count: number }[] {
    return [...this.state.metToday]
      .sort((a, b) => b.count - a.count)
      .map((entry) => ({
        names: entry.seatIds.map((id: string) => this.seat(id)?.name ?? '?'),
        count: entry.count,
      }));
  }

  private recordMeeting(seatIds: string[]): void {
    const key = [...seatIds].sort().join('|');
    const found = this.state.metToday.find((e) => [...e.seatIds].sort().join('|') === key);
    if (found) found.count += 1;
    else this.state.metToday.push({ seatIds: [...seatIds], count: 1 });
  }

  /**
   * A private word with one player, or with a few at once. You can only be in ONE
   * conversation at a time — in the real game you have to walk over and stand there,
   * and that scarcity is the whole reason "who has Ewan spent his day with" is worth
   * watching. The first whisper opens the conversation; after that you are speaking
   * to whoever you are standing with until you `leave`.
   *
   * The square sees people step apart, and how many. It never hears a word.
   */
  whisper(actorSeatId: string, targetSeatIds: string[], text: string): Result<void> {
    const from = this.requirePlayer(actorSeatId);
    if (!from.ok) return from;
    const clean = this.cleanText(text);
    if (!clean.ok) return clean;
    if (this.state.phase !== 'day' && this.state.phase !== 'nominations') {
      return this.state.phase === 'gather'
        ? err('the town is gathered — say it where everyone can hear it')
        : err('private conversations only happen during the day');
    }
    if (!from.value.restrictions.whisper) return err('you cannot whisper');

    const standing = this.conversationOf(from.value.id);
    if (standing) {
      // Already in one. You may name exactly the people you are with, or nobody.
      const unique = [...new Set(targetSeatIds)].filter((id: string) => id !== from.value.id);
      const others = standing.seatIds.filter((id: string) => id !== from.value.id);
      const mismatch =
        unique.length > 0 &&
        (unique.length !== others.length || unique.some((id) => !others.includes(id)));
      if (mismatch) {
        const names = others.map((id: string) => this.seat(id)?.name ?? '?').join(' and ');
        return err(
          `you are already talking with ${names} — leave that conversation before starting another`,
        );
      }
      return this.speakInto(standing, from.value, clean.value);
    }

    const unique = [...new Set(targetSeatIds)];
    if (!unique.length) return err('name at least one player to talk to');
    if (unique.length > MAX_HUDDLE) {
      return err(`a huddle is at most ${MAX_HUDDLE} others — past that, just say it out loud`);
    }
    const targets: Seat[] = [];
    for (const id of unique) {
      const to = this.requireSeat(id);
      if (!to.ok) return to;
      if (to.value.isStoryteller) {
        return err('use the Storyteller channel to talk to the Storyteller');
      }
      if (to.value.id === from.value.id) return err('you cannot whisper to yourself');
      const busy = this.conversationOf(to.value.id);
      if (busy) {
        const with_ = busy.seatIds
          .filter((sid: string) => sid !== to.value.id)
          .map((sid: string) => this.seat(sid)?.name ?? '?')
          .join(' and ');
        return err(`${to.value.name} is already talking with ${with_} — wait, or talk to someone else`);
      }
      targets.push(to.value);
    }

    const seatIds = [from.value.id, ...targets.map((t) => t.id)];
    const conversation: Conversation = {
      id: this.makeId('conv'),
      seatIds,
      openedBy: from.value.id,
      openedAt: this.now(),
      lastSpokeAt: this.now(),
    };
    this.state.conversations.push(conversation);
    this.recordMeeting(seatIds);
    this.emit(
      'conversation.opened',
      {
        conversationId: conversation.id,
        seatIds,
        names: seatIds.map((id: string) => this.seat(id)?.name ?? '?'),
      },
      PUBLIC,
      from.value.id,
    );
    return this.speakInto(conversation, from.value, clean.value);
  }

  private speakInto(conversation: Conversation, from: Seat, text: string): Result<void> {
    conversation.lastSpokeAt = this.now();
    const others = conversation.seatIds.filter((id: string) => id !== from.id);
    this.emit(
      'chat.whisper',
      {
        fromSeatId: from.id,
        fromName: from.name,
        toSeatIds: others,
        toNames: others.map((id: string) => this.seat(id)?.name ?? '?'),
        text,
      },
      toSeats(...conversation.seatIds),
      from.id,
    );
    return ok(undefined);
  }

  /** Step back into the square. Anyone may end a conversation they are standing in. */
  leaveConversation(actorSeatId: string): Result<void> {
    const from = this.requirePlayer(actorSeatId);
    if (!from.ok) return from;
    const standing = this.conversationOf(from.value.id);
    if (!standing) return err('you are not in a private conversation');
    this.closeConversation(standing, `${from.value.name} stepped back into the square`);
    return ok(undefined);
  }

  private closeConversation(conversation: Conversation, reason: string): void {
    this.state.conversations = this.state.conversations.filter((c) => c.id !== conversation.id);
    this.emit(
      'conversation.closed',
      {
        conversationId: conversation.id,
        seatIds: conversation.seatIds,
        names: conversation.seatIds.map((id: string) => this.seat(id)?.name ?? '?'),
        reason,
      },
      PUBLIC,
      conversation.openedBy,
    );
  }

  /** Break up every huddle — at a phase change, or when one is simply abandoned. */
  private closeAllConversations(reason: string): void {
    for (const conversation of [...this.state.conversations]) {
      this.closeConversation(conversation, reason);
    }
  }

  /**
   * Use a character ability out loud, in front of everybody. This is for the
   * abilities that are not night actions and are not just talking: the Gossip's
   * statement, a Chandler publicly choosing someone, a Slayer taking their shot.
   *
   * The engine does not know what any of them do — the Storyteller rules on it, as
   * ever. What the engine does is make sure it cannot be missed: the square sees it,
   * it goes on the record as an action rather than a sentence, and it sits in the
   * Storyteller's view until they have dealt with it.
   */
  useAbility(actorSeatId: string, targetSeatIds: string[], text?: string): Result<AbilityUse> {
    const from = this.requirePlayer(actorSeatId);
    if (!from.ok) return from;
    if (this.state.phase === 'night') {
      return err('night abilities go to the Storyteller privately — use message_storyteller');
    }
    if (this.state.phase === 'lobby' || this.state.phase === 'over') {
      return err('there is no game to use an ability in');
    }
    // The dead use abilities too — a Moonchild acts *because* they died.
    const unique = [...new Set(targetSeatIds)];
    const targets: Seat[] = [];
    for (const id of unique) {
      const to = this.requirePlayer(id);
      if (!to.ok) return to;
      targets.push(to.value);
    }
    let clean: string | undefined;
    if (text !== undefined && text !== '') {
      const checked = this.cleanText(text);
      if (!checked.ok) return checked;
      clean = checked.value;
    }

    const use: AbilityUse = {
      id: this.makeId('use'),
      seatId: from.value.id,
      targetSeatIds: targets.map((t) => t.id),
      ...(clean ? { text: clean } : {}),
      day: this.state.day,
      at: this.now(),
    };
    this.state.abilityUses.push(use);
    this.emit(
      'player.ability',
      {
        abilityId: use.id,
        seatId: from.value.id,
        name: from.value.name,
        targetSeatIds: use.targetSeatIds,
        targetNames: targets.map((t) => t.name),
        ...(clean ? { text: clean } : {}),
      },
      PUBLIC,
      from.value.id,
    );
    this.emit(
      'system.notice',
      {
        text: `${from.value.name} has used an ability in the square and is waiting on your ruling.`,
      },
      ST_ONLY,
    );
    return ok(use);
  }

  /**
   * Write something into the record without saying it. The town never hears it and
   * never sees that it happened; it appears in every chronicle once the game is over.
   *
   * This exists because the temptation to narrate what only you know is real and the
   * reason for it is usually that the moment is too good to lose. It is not lost —
   * put it here. "Delia named three people tonight and none of it did anything" is a
   * wonderful line in a recap and a catastrophe said out loud on the day.
   */
  stRecord(actorSeatId: string, text: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const clean = this.cleanText(text);
    if (!clean.ok) return clean;
    this.emit('st.record', { text: clean.value }, ST_ONLY, actorSeatId);
    return ok(undefined);
  }

  /** Everything declared out loud that the Storyteller has not yet dealt with. */
  pendingAbilities(): AbilityUse[] {
    return this.state.abilityUses.filter((use) => !use.resolvedAt);
  }

  /**
   * Close one off. Any `text` is announced to the whole town — the private half of a
   * ruling, if there is one, goes through `info` to the player as usual.
   */
  stResolveAbility(actorSeatId: string, abilityId?: string, text?: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const pending = this.pendingAbilities();
    const use = abilityId ? pending.find((u) => u.id === abilityId) : pending[0];
    if (!use) {
      return err(abilityId ? 'no ability is waiting under that id' : 'nothing is waiting on you');
    }
    let clean: string | undefined;
    if (text !== undefined && text !== '') {
      const checked = this.cleanText(text);
      if (!checked.ok) return checked;
      clean = checked.value;
    }
    use.resolvedAt = this.now();
    const seat = this.seat(use.seatId);
    this.emit(
      'player.ability.resolved',
      {
        abilityId: use.id,
        seatId: use.seatId,
        name: seat?.name ?? '?',
        ...(clean ? { text: clean } : {}),
      },
      PUBLIC,
      actorSeatId,
    );
    return ok(undefined);
  }

  /** A player's private line to the Storyteller (and the Storyteller's reply). */
  messageStoryteller(actorSeatId: string, text: string): Result<void> {
    const from = this.requirePlayer(actorSeatId);
    if (!from.ok) return from;
    const clean = this.cleanText(text);
    if (!clean.ok) return clean;
    this.emit(
      'chat.storyteller',
      {
        fromSeatId: from.value.id,
        toSeatId: this.state.storytellerSeatId,
        text: clean.value,
        fromStoryteller: false,
      },
      toSeats(from.value.id),
      from.value.id,
    );
    return ok(undefined);
  }

  stMessage(actorSeatId: string, targetSeatId: string, text: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    const clean = this.cleanText(text);
    if (!clean.ok) return clean;
    this.emit(
      'chat.storyteller',
      { fromSeatId: st.value.id, toSeatId: to.value.id, text: clean.value, fromStoryteller: true },
      toSeats(to.value.id),
      st.value.id,
    );
    return ok(undefined);
  }

  stAnnounce(actorSeatId: string, text: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const clean = this.cleanText(text);
    if (!clean.ok) return clean;
    this.emit('system.notice', { text: clean.value }, PUBLIC, actorSeatId);
    return ok(undefined);
  }

  // ------------------------------------------------------------ claims

  /**
   * Tell someone what character you are — the whole town, or one player in
   * private. Nothing verifies it, and nothing stops you telling two people two
   * different things. Working out that you have is the town's job: the engine
   * shows each player only what was said *to* them, and never compares one
   * private claim against another.
   */
  claim(
    actorSeatId: string,
    characterIds: string[] | null,
    toSeatId: string | null,
  ): Result<void> {
    const from = this.requirePlayer(actorSeatId);
    if (!from.ok) return from;
    // When the town is gathered you may still stand up and claim to everyone —
    // that is what a gathering is for. You just cannot take anyone aside.
    const gathered = this.state.phase === 'gather';
    if (this.state.phase !== 'day' && this.state.phase !== 'nominations' && !gathered) {
      return err('you can only claim a character during the day');
    }
    if (gathered && toSeatId !== null) {
      return err('the town is gathered — a claim now is made to everyone or not at all');
    }
    if (!from.value.alive) return err('the dead do not claim');

    let to: Seat | undefined;
    if (toSeatId !== null) {
      const found = this.requirePlayer(toSeatId);
      if (!found.ok) return found;
      if (found.value.id === from.value.id) return err('you already know what you are');
      to = found.value;
    }

    if (characterIds !== null && characterIds.length === 0) {
      return err('name at least one character, or omit it to take your claim back');
    }
    if (characterIds !== null && characterIds.length > MAX_CLAIMED) {
      return err(`name at most ${MAX_CLAIMED} characters — a hedge that wide says nothing`);
    }

    if (characterIds === null) {
      const before = this.state.claims.length;
      this.state.claims = this.state.claims.filter(
        (c) => !(c.fromSeatId === from.value.id && c.toSeatId === (to?.id ?? null)),
      );
      if (this.state.claims.length === before) return err('you have not claimed anything there');
      this.emit(
        'player.claim',
        {
          seatId: from.value.id,
          name: from.value.name,
          toSeatId: to?.id ?? null,
          toName: to?.name ?? null,
          characterIds: [],
          characterNames: [],
          contestedBy: [],
        },
        to ? toSeats(from.value.id, to.id) : PUBLIC,
        from.value.id,
      );
      return ok(undefined);
    }

    const unique = [...new Set(characterIds)];
    const characters = unique.map((id) => this.character(id));
    const missing = unique.find((id, i) => !characters[i]);
    if (missing) return err(`"${missing}" is not on this script`);
    const named = characters as Character[];

    // One standing claim per audience; a new one replaces it.
    this.state.claims = this.state.claims.filter(
      (c) => !(c.fromSeatId === from.value.id && c.toSeatId === (to?.id ?? null)),
    );
    const claim: Claim = {
      id: this.makeId('claim'),
      fromSeatId: from.value.id,
      toSeatId: to?.id ?? null,
      characterIds: named.map((c) => c.id),
      day: this.state.day,
      at: this.now(),
    };
    this.state.claims.push(claim);

    // Only a public claim can be publicly contested; private ones are private. And
    // only a commitment can be contested — two players who each say "I am one of
    // these three" have not contradicted each other, however much they overlap.
    const contestedBy =
      to || named.length !== 1
        ? []
        : this.players()
            .filter((s) => {
              if (s.id === from.value.id || !s.alive) return false;
              const theirs = this.publicClaim(s.id);
              return theirs?.characterIds.length === 1 && theirs.characterIds[0] === named[0]?.id;
            })
            .map((s) => s.name);

    this.emit(
      'player.claim',
      {
        seatId: from.value.id,
        name: from.value.name,
        toSeatId: to?.id ?? null,
        toName: to?.name ?? null,
        characterIds: named.map((c) => c.id),
        characterNames: named.map((c) => c.name),
        contestedBy,
      },
      to ? toSeats(from.value.id, to.id) : PUBLIC,
      from.value.id,
    );
    if (to) {
      // The town sees them step aside, exactly as with a whisper.
      this.emit(
        'player.claim.observed',
        { fromSeatId: from.value.id, toSeatId: to.id },
        PUBLIC,
        from.value.id,
      );
      // Stepping aside to claim is stepping aside. It belongs in the day's tally of
      // who met whom, exactly as a whisper does.
      this.recordMeeting([from.value.id, to.id]);
    }
    return ok(undefined);
  }

  /** What this player has told the whole town they are, if anything. */
  publicClaim(seatId: string): Claim | undefined {
    return this.state.claims.find((c) => c.fromSeatId === seatId && c.toSeatId === null);
  }

  /** What this player has been told privately, by whom. */
  claimsMadeTo(seatId: string): Claim[] {
    return this.state.claims.filter((c) => c.toSeatId === seatId);
  }

  /** Everything this player has claimed, to anyone — their own ledger of stories. */
  claimsMadeBy(seatId: string): Claim[] {
    return this.state.claims.filter((c) => c.fromSeatId === seatId);
  }
  /**
   * The two halves of a "three for three": what you offered this player, and what
   * they offered back. An offer that was never answered is information too — you
   * showed them yours and got nothing, and they know you know.
   */
  exchange(seatId: string, otherSeatId: string): { offered?: Claim; answered?: Claim } {
    const offered = this.state.claims.find(
      (c) => c.fromSeatId === seatId && c.toSeatId === otherSeatId,
    );
    const answered = this.state.claims.find(
      (c) => c.fromSeatId === otherSeatId && c.toSeatId === seatId,
    );
    return { ...(offered ? { offered } : {}), ...(answered ? { answered } : {}) };
  }


  /** Characters more than one living player is claiming *in public*. */
  contestedClaims(): { characterId: string; characterName: string; seatIds: string[] }[] {
    const byCharacter = new Map<string, string[]>();
    for (const seat of this.players()) {
      const claim = seat.alive ? this.publicClaim(seat.id) : undefined;
      // A hedge contests nothing — "I am one of three" is not a claim on any of them.
      if (!claim || claim.characterIds.length !== 1) continue;
      const characterId = claim.characterIds[0] as string;
      const list = byCharacter.get(characterId) ?? [];
      list.push(seat.id);
      byCharacter.set(characterId, list);
    }
    return [...byCharacter.entries()]
      .filter(([, seatIds]) => seatIds.length > 1)
      .map(([characterId, seatIds]) => ({
        characterId,
        characterName: this.character(characterId)?.name ?? characterId,
        seatIds,
      }));
  }

  // ------------------------------------------------------------ night

  stWake(actorSeatId: string, targetSeatId: string, prompt?: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    this.emit(
      'st.wake',
      { seatId: to.value.id, ...(prompt ? { prompt } : {}) },
      toSeats(to.value.id),
      actorSeatId,
    );
    return ok(undefined);
  }

  stSleep(actorSeatId: string, targetSeatId: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    this.emit('st.sleep', { seatId: to.value.id }, toSeats(to.value.id), actorSeatId);
    return ok(undefined);
  }

  /** Give a player information. This is how every ability result reaches a player. */
  stInfo(actorSeatId: string, targetSeatId: string, text: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    const clean = this.cleanText(text);
    if (!clean.ok) return clean;
    this.emit('st.info', { seatId: to.value.id, text: clean.value }, toSeats(to.value.id), actorSeatId);
    return ok(undefined);
  }

  /**
   * Show one player the whole grimoire. Some characters read it directly — a Spy,
   * a Widow — and the Storyteller should not have to retype it every night.
   * It is a snapshot: what was true the moment you showed them.
   */
  stShowGrimoire(actorSeatId: string, targetSeatId: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;

    this.emit(
      'st.grimoire.shown',
      {
        seatId: to.value.id,
        seats: this.players().map((seat) => {
          const character = this.character(seat.characterId);
          return {
            index: seat.index,
            name: seat.name,
            characterName: character?.name ?? null,
            team: character?.team ?? null,
            alignment: seat.alignment ?? null,
            alive: seat.alive,
            reminders: seat.reminders.map((r) => r.label),
          };
        }),
      },
      toSeats(to.value.id),
      actorSeatId,
    );
    return ok(undefined);
  }

  // ------------------------------------------------------------ grimoire

  stAssignCharacter(
    actorSeatId: string,
    targetSeatId: string,
    characterId: string,
    alignment?: Alignment,
    believesCharacterId?: string,
  ): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    const character = this.character(characterId);
    if (!character) return err(`"${characterId}" is not on this script`);
    // The Drunk and the Sleeper are told they are somebody else. The grimoire keeps
    // the truth; the player's own view is handed the lie, and never the two together.
    const believed = believesCharacterId ? this.character(believesCharacterId) : undefined;
    if (believesCharacterId && !believed) return err(`"${believesCharacterId}" is not on this script`);
    if (believed && believed.id === character.id) {
      return err(`${to.value.name} already is the ${character.name} — leave "believes" off`);
    }

    to.value.characterId = character.id;
    to.value.believedCharacterId = believed?.id;
    to.value.alignment =
      alignment ?? (character.team === 'minion' || character.team === 'demon' ? 'evil' : 'good');
    if (character.team === 'traveller') to.value.isTraveller = true;

    // What the seat is told. For a Drunk this is the lie, and it is all they ever see.
    const shown = believed ?? character;
    this.emit(
      'player.character',
      {
        seatId: to.value.id,
        characterId: shown.id,
        characterName: shown.name,
        team: shown.team,
      },
      toSeats(to.value.id),
      actorSeatId,
    );
    this.emit(
      'st.grimoire',
      {
        seatId: to.value.id,
        change: believed
          ? `${to.value.name} is the ${character.name} (${to.value.alignment}), and thinks they are the ${believed.name}`
          : `${to.value.name} is the ${character.name} (${to.value.alignment})`,
      },
      ST_ONLY,
      actorSeatId,
    );
    return ok(undefined);
  }

  stSetAlignment(actorSeatId: string, targetSeatId: string, alignment: Alignment): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    to.value.alignment = alignment;
    this.emit(
      'st.grimoire',
      { seatId: to.value.id, change: `${to.value.name} is now ${alignment}` },
      ST_ONLY,
      actorSeatId,
    );
    return ok(undefined);
  }

  stAddReminder(
    actorSeatId: string,
    targetSeatId: string,
    label: string,
    sourceCharacterId?: string,
  ): Result<string> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    const clean = this.cleanText(label);
    if (!clean.ok) return clean;
    const id = this.makeId('rem');
    to.value.reminders.push({
      id,
      label: clean.value,
      ...(sourceCharacterId ? { sourceCharacterId } : {}),
    });
    this.emit(
      'st.grimoire',
      { seatId: to.value.id, change: `reminder "${clean.value}" on ${to.value.name}` },
      ST_ONLY,
      actorSeatId,
    );
    return ok(id);
  }

  stRemoveReminder(actorSeatId: string, targetSeatId: string, reminderId: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    const before = to.value.reminders.length;
    to.value.reminders = to.value.reminders.filter((r) => r.id !== reminderId);
    if (to.value.reminders.length === before) return err('no such reminder');
    this.emit(
      'st.grimoire',
      { seatId: to.value.id, change: `reminder removed from ${to.value.name}` },
      ST_ONLY,
      actorSeatId,
    );
    return ok(undefined);
  }

  stSetRestriction(
    actorSeatId: string,
    targetSeatId: string,
    key: keyof Restrictions,
    allowed: boolean,
  ): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    to.value.restrictions[key] = allowed;
    this.emit(
      'st.grimoire',
      { seatId: to.value.id, change: `${to.value.name} ${allowed ? 'may' : 'may not'} ${key}` },
      ST_ONLY,
      actorSeatId,
    );
    return ok(undefined);
  }

  stSetTraveller(actorSeatId: string, targetSeatId: string, isTraveller: boolean): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    to.value.isTraveller = isTraveller;
    this.emit(
      'system.notice',
      { text: `${to.value.name} is ${isTraveller ? 'now' : 'no longer'} a Traveller.` },
      PUBLIC,
      actorSeatId,
    );
    return ok(undefined);
  }

  stSetGhostVote(actorSeatId: string, targetSeatId: string, available: boolean): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    to.value.ghostVote = available;
    this.emit(
      'st.grimoire',
      { seatId: to.value.id, change: `${to.value.name} ${available ? 'has' : 'has spent'} their ghost vote` },
      ST_ONLY,
      actorSeatId,
    );
    return ok(undefined);
  }

  // ------------------------------------------------------------ the clock

  /**
   * Set how long a phase runs before the clock moves the game on, or how long a
   * vote stays open. `null` clears it and hands that phase back to the
   * Storyteller. Timers are what stop a table of agents waiting on each other
   * forever; a Storyteller who wants to drive by hand simply sets none.
   */
  stSetTimer(actorSeatId: string, key: TimerKey, seconds: number | null): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    if (seconds !== null && (!Number.isFinite(seconds) || seconds < 5 || seconds > 3600)) {
      return err('a timer must be between 5 and 3600 seconds, or null to clear it');
    }
    if (seconds === null) delete this.state.timers[key];
    else this.state.timers[key] = Math.trunc(seconds);

    this.emit('timer.set', { key, seconds: seconds === null ? null : Math.trunc(seconds) }, PUBLIC, actorSeatId);
    // Applying a timer to the phase already running starts it immediately.
    if (key === this.state.phase) this.startPhaseClock(this.state.phase);
    if (key === 'vote') {
      const nomination = this.activeNomination();
      if (nomination?.open) this.startVoteClock(nomination);
    }
    return ok(undefined);
  }

  stClearTimers(actorSeatId: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    this.state.timers = {};
    this.state.phaseEndsAt = undefined;
    const nomination = this.activeNomination();
    if (nomination) delete nomination.endsAt;
    this.emit('timer.set', { key: 'all', seconds: null }, PUBLIC, actorSeatId);
    return ok(undefined);
  }

  timers(): Timers {
    return { ...this.state.timers };
  }

  /** Seconds left on the phase clock, or undefined when none is running. */
  secondsLeft(now = this.now()): number | undefined {
    if (this.state.phaseEndsAt === undefined) return undefined;
    return Math.max(0, Math.ceil((this.state.phaseEndsAt - now) / 1000));
  }

  voteSecondsLeft(now = this.now()): number | undefined {
    const endsAt = this.activeNomination()?.endsAt;
    if (endsAt === undefined) return undefined;
    return Math.max(0, Math.ceil((endsAt - now) / 1000));
  }

  private startPhaseClock(phase: Phase): void {
    this.state.lastCallAt = undefined;
    // The floor opens on a short fuse: the town gets `opening` seconds to put up
    // a first name, not the whole nominations phase. The moment somebody does,
    // the full clock replaces it — see nominate().
    const seconds =
      phase === 'over' || phase === 'lobby'
        ? undefined
        : phase === 'nominations'
          ? (this.state.timers.opening ?? this.state.timers.nominations)
          : this.state.timers[phase as TimerKey];
    if (!seconds) {
      this.state.phaseEndsAt = undefined;
      return;
    }
    this.state.phaseEndsAt = this.now() + seconds * 1000;
    this.emit(
      'timer.started',
      { key: phase, seconds, endsAt: this.state.phaseEndsAt },
      PUBLIC,
    );
  }

  private startVoteClock(nomination: Nomination): void {
    const seconds = this.state.timers.vote;
    if (!seconds) {
      delete nomination.endsAt;
      return;
    }
    nomination.endsAt = this.now() + seconds * 1000;
    this.emit('timer.started', { key: 'vote', seconds, endsAt: nomination.endsAt }, PUBLIC);
  }

  /**
   * Advance any clock that has run out. The engine has no timer of its own — the
   * server calls this, so the rules stay pure and the tests stay deterministic.
   * Returns true when something changed.
   */
  tick(now = this.now()): boolean {
    if (this.state.phase === 'lobby' || this.state.phase === 'over') return false;
    let changed = false;

    const nomination = this.activeNomination();
    if (nomination?.open && nomination.endsAt !== undefined && now >= nomination.endsAt) {
      if (nomination.state === 'defence') {
        this.emit('timer.expired', { key: 'defence', consequence: 'hands go up' }, PUBLIC);
        this.openVoting(nomination);
      } else {
        this.emit('timer.expired', { key: 'vote', consequence: 'the vote is closed' }, PUBLIC);
        this.closeNominationInternal(this.state.storytellerSeatId);
      }
      changed = true;
    }

    // A nomination in progress holds the day open. Otherwise the phase clock can
    // expire during a defence and close the vote before a single hand goes up,
    // which loses the town a nomination it had every right to resolve.
    if (this.activeNomination()?.open) return changed;

    // "Five seconds." Said once, out loud, so nobody loses a day to not noticing.
    if (
      this.state.phaseEndsAt !== undefined &&
      this.state.lastCallAt === undefined &&
      this.state.phaseEndsAt - now <= LAST_CALL_MS &&
      now < this.state.phaseEndsAt
    ) {
      this.state.lastCallAt = now;
      const left = Math.max(1, Math.ceil((this.state.phaseEndsAt - now) / 1000));
      this.emit(
        'timer.lastcall',
        { key: this.state.phase, seconds: left, phase: this.state.phase },
        PUBLIC,
      );
      changed = true;
    }

    if (this.state.phaseEndsAt !== undefined && now >= this.state.phaseEndsAt) {
      const from = this.state.phase;
      this.emit(
        'timer.expired',
        { key: from, consequence: `${from} is over` },
        PUBLIC,
      );
      this.state.phaseEndsAt = undefined;
      this.stAdvancePhase(this.state.storytellerSeatId);
      changed = true;
    }
    // An agent that forgets to leave should not trap two other people all day.
    for (const conversation of [...this.state.conversations]) {
      if (now - conversation.lastSpokeAt >= CONVERSATION_IDLE_MS) {
        this.closeConversation(conversation, 'the conversation petered out');
        changed = true;
      }
    }
    return changed;
  }

  // ------------------------------------------------------------ private notes

  /**
   * A seat's private reads on the other players. These never enter the event log
   * and never appear in anyone else's view — not even the Storyteller's.
   */
  notesFor(seatId: string): SeatNote[] {
    const notes = this.state.notes.get(seatId);
    if (!notes) return [];
    return [...notes.values()].sort((a, b) => {
      const left = this.seat(a.targetSeatId)?.index ?? 0;
      const right = this.seat(b.targetSeatId)?.index ?? 0;
      return left - right;
    });
  }

  note(seatId: string, targetSeatId: string): SeatNote | undefined {
    return this.state.notes.get(seatId)?.get(targetSeatId);
  }

  /**
   * Write or update a note. Fields left `undefined` keep their current value;
   * pass `null` to clear one.
   */
  setNote(
    actorSeatId: string,
    targetSeatId: string,
    patch: {
      alignment?: Alignment | 'unknown' | null;
      teams?: Team[] | null;
      characters?: string[] | null;
      confidence?: SeatNote['confidence'] | null;
      text?: string | null;
    },
  ): Result<SeatNote> {
    const actor = this.requireSeat(actorSeatId);
    if (!actor.ok) return actor;
    const target = this.requirePlayer(targetSeatId);
    if (!target.ok) return target;

    const existing = this.note(actorSeatId, targetSeatId);
    const note: SeatNote = existing
      ? { ...existing }
      : { targetSeatId, teams: [], characters: [], updatedAt: this.now() };

    if (patch.alignment !== undefined) {
      if (patch.alignment === null) delete note.alignment;
      else note.alignment = patch.alignment;
    }
    if (patch.teams !== undefined) note.teams = patch.teams ?? [];
    if (patch.characters !== undefined) {
      const unknown = (patch.characters ?? []).filter((id) => !this.character(id));
      if (unknown.length) return err(`not on this script: ${unknown.join(', ')}`);
      note.characters = patch.characters ?? [];
    }
    if (patch.confidence !== undefined) {
      if (patch.confidence === null) delete note.confidence;
      else note.confidence = patch.confidence;
    }
    if (patch.text !== undefined) {
      const trimmed = patch.text?.trim();
      if (!trimmed) delete note.text;
      else if (trimmed.length > 500) return err('a note is longer than 500 characters');
      else note.text = trimmed;
    }
    note.updatedAt = this.now();

    const forSeat = this.state.notes.get(actorSeatId) ?? new Map<string, SeatNote>();
    forSeat.set(targetSeatId, note);
    this.state.notes.set(actorSeatId, forSeat);
    return ok(note);
  }

  clearNote(actorSeatId: string, targetSeatId: string): Result<void> {
    const actor = this.requireSeat(actorSeatId);
    if (!actor.ok) return actor;
    const removed = this.state.notes.get(actorSeatId)?.delete(targetSeatId);
    return removed ? ok(undefined) : err('you have no note on that player');
  }

  // ------------------------------------------------------------ life & death

  stKill(actorSeatId: string, targetSeatId: string, cause = 'the Storyteller'): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    if (!to.value.alive) return err(`${to.value.name} is already dead`);
    this.kill(to.value, cause, actorSeatId);
    return ok(undefined);
  }

  stRevive(actorSeatId: string, targetSeatId: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    if (to.value.alive) return err(`${to.value.name} is alive`);
    to.value.alive = true;
    this.emit('player.revived', { seatId: to.value.id, name: to.value.name }, PUBLIC, actorSeatId);
    return ok(undefined);
  }

  private kill(seat: Seat, cause: string, actorSeatId?: string): void {
    seat.alive = false;
    this.emit('player.died', { seatId: seat.id, name: seat.name, cause }, PUBLIC, actorSeatId);
    this.checkWinConditions();
  }

  /**
   * The engine never ends the game on its own — it tells the Storyteller when a
   * win condition looks met and lets them rule on it.
   */
  private checkWinConditions(): void {
    if (this.state.phase === 'over' || this.state.phase === 'lobby') return;
    const players = this.players().filter((s) => !s.isTraveller);
    const assigned = players.filter((s) => s.characterId);
    const demons = assigned.filter((s) => this.character(s.characterId)?.team === 'demon');

    if (demons.length > 0 && demons.every((s) => !s.alive)) {
      this.emit(
        'system.notice',
        { text: 'No living Demon remains — good may have won. Call it if you agree.' },
        ST_ONLY,
      );
    }
    const alive = players.filter((s) => s.alive);
    if (alive.length <= 2 && alive.some((s) => s.alignment === 'evil')) {
      this.emit(
        'system.notice',
        { text: 'Two players remain with evil among them — evil may have won.' },
        ST_ONLY,
      );
    }
  }

  // ------------------------------------------------------------ nominations

  nominate(actorSeatId: string, nomineeSeatId: string): Result<Nomination> {
    const from = this.requirePlayer(actorSeatId);
    if (!from.ok) return from;
    const to = this.requirePlayer(nomineeSeatId);
    if (!to.ok) return to;
    if (this.state.phase !== 'nominations') return err('nominations are not open');
    if (this.activeNomination()) return err('a nomination is already in progress');
    if (!from.value.alive) return err('the dead cannot nominate');
    if (!from.value.restrictions.nominate) return err('you cannot nominate');
    if (from.value.hasNominatedToday) return err('you have already nominated today');
    if (to.value.hasBeenNominatedToday) return err(`${to.value.name} has already been nominated today`);

    const defence = this.state.timers.defence ?? 0;
    const nomination: Nomination = {
      id: this.makeId('nom'),
      day: this.state.day,
      kind: to.value.isTraveller ? 'exile' : 'execution',
      nominatorSeatId: from.value.id,
      nomineeSeatId: to.value.id,
      state: defence > 0 ? 'defence' : 'voting',
      open: true,
      votes: [],
    };
    this.state.nominations.push(nomination);
    // The opening fuse has done its job; the day now runs on the full clock.
    const opening = this.state.timers.opening;
    const full = this.state.timers.nominations;
    if (opening && full && this.state.nominations.filter((n) => n.day === this.state.day).length === 1) {
      this.state.phaseEndsAt = this.now() + full * 1000;
      this.state.lastCallAt = undefined;
      this.emit('timer.started', { key: 'nominations', seconds: full, endsAt: this.state.phaseEndsAt }, PUBLIC);
    }
    this.state.activeNominationId = nomination.id;
    from.value.hasNominatedToday = true;
    to.value.hasBeenNominatedToday = true;

    this.emit(
      'nomination.made',
      {
        nominationId: nomination.id,
        kind: nomination.kind,
        nominatorSeatId: from.value.id,
        nominatorName: from.value.name,
        nomineeSeatId: to.value.id,
        nomineeName: to.value.name,
      },
      PUBLIC,
      from.value.id,
    );

    // The accused answers before anyone raises a hand.
    if (defence > 0) {
      nomination.endsAt = this.now() + defence * 1000;
      this.emit('timer.started', { key: 'defence', seconds: defence, endsAt: nomination.endsAt }, PUBLIC);
    } else {
      this.openVoting(nomination);
    }
    return ok(nomination);
  }

  /** Hands go up. Called by the clock, or by the Storyteller cutting it short. */
  private openVoting(nomination: Nomination): void {
    nomination.state = 'voting';
    const nominee = this.seat(nomination.nomineeSeatId);
    this.emit(
      'nomination.voting',
      {
        nominationId: nomination.id,
        nomineeSeatId: nomination.nomineeSeatId,
        nomineeName: nominee?.name ?? '?',
        threshold:
          nomination.kind === 'exile'
            ? Math.ceil(this.players().length / 2)
            : Math.ceil(this.alivePlayers().length / 2),
      },
      PUBLIC,
    );
    this.startVoteClock(nomination);
  }

  /** End the defence early and take the vote. */
  stOpenVoting(actorSeatId: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const nomination = this.activeNomination();
    if (!nomination || nomination.state !== 'defence') return err('nobody is defending themselves');
    this.openVoting(nomination);
    return ok(undefined);
  }

  castVote(actorSeatId: string, vote: boolean): Result<void> {
    const from = this.requirePlayer(actorSeatId);
    if (!from.ok) return from;
    const nomination = this.activeNomination();
    if (!nomination || !nomination.open) return err('there is nothing to vote on');
    if (nomination.state === 'defence') {
      const nominee = this.seat(nomination.nomineeSeatId);
      return err(`${nominee?.name ?? 'the nominee'} is still answering the charge — hands stay down`);
    }
    if (nomination.votes.some((v) => v.seatId === from.value.id)) return err('you have already voted');
    if (!from.value.restrictions.vote) return err('you cannot vote');

    let ghost = false;
    if (!from.value.alive && nomination.kind === 'execution') {
      if (vote) {
        if (!from.value.ghostVote) return err('you have already spent your ghost vote');
        from.value.ghostVote = false;
        ghost = true;
      }
    }
    nomination.votes.push({ seatId: from.value.id, vote, ghost, at: this.now() });
    // The dead vote too, while they still hold a ghost vote — "yet to vote" was
    // hitting zero with people left who could still swing it.
    const eligible =
      nomination.kind === 'exile'
        ? this.players().length
        : this.players().filter((s) => s.alive || s.ghostVote).length;
    this.emit(
      'vote.cast',
      {
        nominationId: nomination.id,
        seatId: from.value.id,
        name: from.value.name,
        vote,
        ghost,
        yesCount: nomination.votes.filter((v) => v.vote).length,
        noCount: nomination.votes.filter((v) => !v.vote).length,
        threshold:
          nomination.kind === 'exile'
            ? Math.ceil(this.players().length / 2)
            : Math.ceil(this.alivePlayers().length / 2),
        yetToVote: Math.max(0, eligible - nomination.votes.length),
      },
      PUBLIC,
      from.value.id,
    );
    return ok(undefined);
  }

  stCloseNomination(actorSeatId: string): Result<Nomination> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const nomination = this.activeNomination();
    if (!nomination || !nomination.open) return err('there is no open nomination');
    return ok(this.closeNominationInternal(actorSeatId));
  }

  private closeNominationInternal(actorSeatId?: string, announceFloor = true): Nomination {
    const nomination = this.activeNomination();
    if (!nomination) throw new Error('no active nomination');
    const nominee = this.seat(nomination.nomineeSeatId);

    const tally = nomination.votes.filter((v) => v.vote).length;
    const threshold =
      nomination.kind === 'exile'
        ? Math.ceil(this.players().length / 2)
        : Math.ceil(this.alivePlayers().length / 2);

    nomination.open = false;
    nomination.state = 'closed';
    nomination.tally = tally;
    nomination.threshold = threshold;
    delete nomination.endsAt;
    this.state.activeNominationId = undefined;

    if (nomination.kind === 'exile') {
      nomination.result = tally >= threshold ? 'exiled' : 'not-exiled';
    } else if (tally < threshold) {
      nomination.result = 'insufficient';
    } else if (tally === this.state.highestTally) {
      // A tie puts nobody on the block, and clears whoever was there.
      nomination.result = 'tied';
      this.state.onBlockSeatId = undefined;
    } else if (tally > this.state.highestTally) {
      nomination.result = 'on-block';
      this.state.highestTally = tally;
      this.state.onBlockSeatId = nomination.nomineeSeatId;
    } else {
      nomination.result = 'insufficient';
    }

    this.emit(
      'nomination.closed',
      {
        nominationId: nomination.id,
        tally,
        threshold,
        result: nomination.result,
        nomineeSeatId: nomination.nomineeSeatId,
        nomineeName: nominee?.name ?? '?',
      },
      PUBLIC,
      actorSeatId,
    );

    // Say plainly that the day is not over: towns forget they may nominate again.
    // Not when the close is itself the day ending.
    if (announceFloor && this.state.phase === 'nominations') {
      const remaining = this.players().filter((s) => s.alive && !s.hasNominatedToday).length;
      if (remaining > 0) this.emit('nomination.floor', { remaining }, PUBLIC);
    }

    if (nomination.result === 'exiled' && nominee) {
      this.emit('exile', { seatId: nominee.id, name: nominee.name }, PUBLIC, actorSeatId);
      if (nominee.alive) this.kill(nominee, 'exile', actorSeatId);
    }
    return nomination;
  }

  stCancelNomination(actorSeatId: string): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    const nomination = this.activeNomination();
    if (!nomination) return err('there is no open nomination');
    nomination.open = false;
    nomination.state = 'closed';
    nomination.result = 'insufficient';
    nomination.tally = nomination.votes.filter((v) => v.vote).length;
    this.state.activeNominationId = undefined;
    const nominator = this.seat(nomination.nominatorSeatId);
    const nominee = this.seat(nomination.nomineeSeatId);
    if (nominator) nominator.hasNominatedToday = false;
    if (nominee) nominee.hasBeenNominatedToday = false;
    this.emit('system.notice', { text: 'The Storyteller cancelled the nomination.' }, PUBLIC, actorSeatId);
    return ok(undefined);
  }

  /** Override who dies at dusk; `null` spares everyone. */
  stSetOnBlock(actorSeatId: string, targetSeatId: string | null): Result<void> {
    const st = this.requireStoryteller(actorSeatId);
    if (!st.ok) return st;
    if (targetSeatId === null) {
      this.state.onBlockSeatId = undefined;
      this.emit('st.grimoire', { seatId: '', change: 'the block is empty' }, ST_ONLY, actorSeatId);
      return ok(undefined);
    }
    const to = this.requirePlayer(targetSeatId);
    if (!to.ok) return to;
    this.state.onBlockSeatId = to.value.id;
    this.emit(
      'st.grimoire',
      { seatId: to.value.id, change: `${to.value.name} is on the block` },
      ST_ONLY,
      actorSeatId,
    );
    return ok(undefined);
  }

  private resolveExecution(actorSeatId: string): void {
    const seat = this.seat(this.state.onBlockSeatId);
    if (!seat) {
      this.emit('execution', { seatId: null, name: null }, PUBLIC, actorSeatId);
      return;
    }
    this.emit('execution', { seatId: seat.id, name: seat.name }, PUBLIC, actorSeatId);
    if (seat.alive) this.kill(seat, 'execution', actorSeatId);
    this.state.onBlockSeatId = undefined;
  }
}
