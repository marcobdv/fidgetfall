import type { Alignment, NominationKind, NominationResult, Phase, Team } from './types.js';

/**
 * Who is allowed to see an event. The Storyteller sees everything; a spectator
 * sees only `public`.
 */
export type Visibility =
  | { kind: 'public' }
  | { kind: 'seats'; seats: string[] }
  | { kind: 'storyteller' };

export const PUBLIC: Visibility = { kind: 'public' };
export const ST_ONLY: Visibility = { kind: 'storyteller' };
export const toSeats = (...seats: string[]): Visibility => ({ kind: 'seats', seats });

export interface EventPayloads {
  'game.created': { name: string; scriptId: string; scriptName: string };
  'player.joined': { seatId: string; name: string; kind: string; isStoryteller: boolean };
  'player.left': { seatId: string; name: string };
  'player.connection': { seatId: string; connected: boolean };
  'seating.changed': { order: string[] };
  'game.started': { day: number; seats: number };
  'game.ended': { winner: Alignment; reason: string };
  'phase.changed': { phase: Phase; day: number; previous: Phase };

  'chat.public': { fromSeatId: string; fromName: string; text: string };
  /** `toSeatIds` is one player for a whisper, several for a huddle. */
  'chat.whisper': {
    fromSeatId: string;
    fromName: string;
    toSeatIds: string[];
    toNames: string[];
    text: string;
  };
  /** Public: the square sees people step apart, and how many of them. */
  /** The roll call at the end: every seat, named out loud, once the game is over. */
  'game.rollcall': {
    seats: {
      index: number;
      name: string;
      characterName: string;
      team: string;
      alignment: string;
      believedCharacterName?: string;
      alive: boolean;
    }[];
  };
  'conversation.opened': { conversationId: string; seatIds: string[]; names: string[] };
  'conversation.closed': { conversationId: string; seatIds: string[]; names: string[]; reason: string };
  'chat.storyteller': { fromSeatId: string; toSeatId: string; text: string; fromStoryteller: boolean };

  'st.wake': { seatId: string; prompt?: string };
  'st.sleep': { seatId: string };
  'st.info': { seatId: string; text: string };
  'st.grimoire': { seatId: string; change: string };
  /** A character that sees the grimoire — the Spy, the Widow — gets a snapshot. */
  'st.grimoire.shown': {
    seatId: string;
    seats: {
      index: number;
      name: string;
      characterName: string | null;
      team: string | null;
      alignment: string | null;
      alive: boolean;
      reminders: string[];
    }[];
  };

  'player.died': { seatId: string; name: string; cause: string };
  'player.revived': { seatId: string; name: string };
  'player.character': { seatId: string; characterId: string; characterName: string; team: Team };
  'player.claim': {
    seatId: string;
    name: string;
    /** null when said to the whole town. */
    toSeatId: string | null;
    toName: string | null;
    /** Empty when the claim is being taken back; several when it is a hedge. */
    characterIds: string[];
    characterNames: string[];
    /** Only for a public commitment: others already publicly claiming that character. */
    contestedBy: string[];
  };
  /** The town sees two people step aside; it does not hear what was claimed. */
  'player.claim.observed': { fromSeatId: string; toSeatId: string };

  'nomination.made': {
    nominationId: string;
    kind: NominationKind;
    nominatorSeatId: string;
    nominatorName: string;
    nomineeSeatId: string;
    nomineeName: string;
  };
  'nomination.voting': { nominationId: string; nomineeSeatId: string; nomineeName: string; threshold: number };
  'nomination.floor': { remaining: number };
  'vote.cast': {
    nominationId: string;
    seatId: string;
    name: string;
    vote: boolean;
    ghost: boolean;
    /** Running count, so nobody has to reconstruct it from earlier lines. */
    yesCount: number;
    noCount: number;
    threshold: number;
    yetToVote: number;
  };
  'nomination.closed': {
    nominationId: string;
    tally: number;
    threshold: number;
    result: NominationResult;
    nomineeSeatId: string;
    nomineeName: string;
  };
  'execution': { seatId: string | null; name: string | null };
  'exile': { seatId: string; name: string };

  'timer.set': { key: string; seconds: number | null };
  'timer.started': { key: string; seconds: number; endsAt: number };
  'timer.expired': { key: string; consequence: string };

  'system.notice': { text: string };
}

export type EventType = keyof EventPayloads;

export interface GameEvent<T extends EventType = EventType> {
  seq: number;
  at: number;
  type: T;
  data: EventPayloads[T];
  visibility: Visibility;
  actorSeatId?: string;
}

export type AnyEvent = { [T in EventType]: GameEvent<T> }[EventType];

/** Perspective an event log is filtered for. */
export type Viewer =
  | { kind: 'storyteller' }
  | { kind: 'seat'; seatId: string }
  | { kind: 'spectator' };

export function canSee(event: AnyEvent, viewer: Viewer): boolean {
  if (viewer.kind === 'storyteller') return true;
  switch (event.visibility.kind) {
    case 'public':
      return true;
    case 'storyteller':
      return false;
    case 'seats':
      return viewer.kind === 'seat' && event.visibility.seats.includes(viewer.seatId);
  }
}
