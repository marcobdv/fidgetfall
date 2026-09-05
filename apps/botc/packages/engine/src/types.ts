/** Domain types for the Blood on the Clocktower engine. */

export type Team = 'townsfolk' | 'outsider' | 'minion' | 'demon' | 'traveller' | 'fabled';
export type Alignment = 'good' | 'evil';
export type SeatKind = 'human' | 'agent';

/**
 * Phases follow a real game: night, then the day's open discussion, then
 * nominations, then dusk (when the execution resolves) and back to night.
 */
export type Phase = 'lobby' | 'night' | 'day' | 'gather' | 'nominations' | 'dusk' | 'over';

/**
 * night -> day -> gather -> nominations -> dusk. The day is when people wander off
 * in twos and threes; the gather is when the Storyteller calls the town in and the
 * only thing anyone can do is speak where everyone hears it.
 */
export const PHASE_CYCLE: Phase[] = ['night', 'day', 'gather', 'nominations', 'dusk'];

/** A character as the script-tool JSON describes it. Only `id`/`name`/`team` are required. */
export interface Character {
  id: string;
  name: string;
  team: Team;
  /** Absent for the base editions — see data/README.md. */
  ability?: string;
  firstNight?: number;
  firstNightReminder?: string;
  otherNight?: number;
  otherNightReminder?: string;
  reminders?: string[];
  setup?: boolean;
  /** True when a script referenced this id but the character index had no entry for it. */
  unresolved?: boolean;
}

export interface GameScript {
  id: string;
  name: string;
  author?: string;
  description?: string;
  edition?: string;
  characters: Character[];
}

/** A Storyteller-placed reminder token, visible only in the grimoire. */
export interface ReminderToken {
  id: string;
  label: string;
  sourceCharacterId?: string;
}

/** What the Storyteller has taken away from a seat (homebrew abilities, Butler, ...). */
export interface Restrictions {
  whisper: boolean;
  nominate: boolean;
  vote: boolean;
}

export interface Seat {
  id: string;
  /** Stable order around the town square; the Storyteller is not in the circle. */
  index: number;
  name: string;
  kind: SeatKind;
  isStoryteller: boolean;
  isTraveller: boolean;
  alive: boolean;
  /** A dead player keeps one vote token until they spend it. */
  ghostVote: boolean;
  connected: boolean;
  /** Grimoire data: only the Storyteller and the seat's owner ever see these. */
  characterId?: string;
  /**
   * What this player has been *told* they are, when that is a lie. The Drunk and
   * the Sleeper are the whole reason this field exists: the grimoire holds the
   * truth in `characterId`, the player's own view shows this instead, and only the
   * Storyteller ever sees both. Unset for everyone who is what they think they are.
   */
  believedCharacterId?: string;
  alignment?: Alignment;
  reminders: ReminderToken[];
  hasNominatedToday: boolean;
  hasBeenNominatedToday: boolean;
  restrictions: Restrictions;
}

/** How sure a player is about a note they wrote. */
export type Confidence = 'maybe' | 'likely' | 'certain';

/**
 * One player's private read on another. Never shared, never logged — this is the
 * notepad a player keeps beside their own seat, not the Storyteller's grimoire.
 */
export interface SeatNote {
  targetSeatId: string;
  /** 'unknown' is a deliberate "I have looked and I cannot tell". */
  alignment?: Alignment | 'unknown';
  /** More than one is the point: "evil, but minion or demon?" */
  teams: Team[];
  /** Suspected character ids, from the script. */
  characters: string[];
  confidence?: Confidence;
  text?: string;
  updatedAt: number;
}

/**
 * How long each phase runs before the clock advances it, in seconds. Unset
 * means the Storyteller drives that phase by hand, which is the default.
 */
export interface Timers {
  night?: number;
  day?: number;
  gather?: number;
  nominations?: number;
  dusk?: number;
  /** How long a single nomination stays open for voting. */
  vote?: number;
  /** How long the nominee has to answer before hands go up. */
  defence?: number;
}

export type TimerKey = keyof Timers;

/**
 * Someone telling someone else what character they are. Addressed: said either
 * to the whole town or to one player in private. Nothing verifies it, and
 * nothing stops you telling two people two different things — catching that is
 * the town's job, not the engine's.
 */
export interface Claim {
  id: string;
  fromSeatId: string;
  /** null means it was said out loud to everyone. */
  toSeatId: string | null;
  /**
   * One character is a commitment: "I am the Chef". Several is a hedge — the
   * "three for three" players actually make at table: *I am one of these three,
   * now show me yours*. Neither side commits, both get something to cross-check,
   * and an evil player can seed one lie among two truths.
   */
  characterIds: string[];
  day: number;
  at: number;
}

export type NominationKind = 'execution' | 'exile';

export type NominationResult =
  | 'on-block'
  | 'insufficient'
  | 'tied'
  | 'exiled'
  | 'not-exiled';

export interface Vote {
  seatId: string;
  vote: boolean;
  /** True when the voter was dead and spent their ghost vote. */
  ghost: boolean;
  at: number;
}

/**
 * `defence` — the charge has been made and the nominee is answering it; no
 * hands go up yet. `voting` — the floor is taking votes. `closed` — done.
 */
export type NominationState = 'defence' | 'voting' | 'closed';

export interface Nomination {
  id: string;
  day: number;
  kind: NominationKind;
  nominatorSeatId: string;
  nomineeSeatId: string;
  state: NominationState;
  open: boolean;
  /** Wall-clock deadline for this vote, if a vote timer is running. */
  endsAt?: number;
  votes: Vote[];
  tally?: number;
  threshold?: number;
  result?: NominationResult;
}

export interface GameState {
  id: string;
  name: string;
  joinCode: string;
  createdAt: number;
  phase: Phase;
  /** 1-based; night 1 and the day that follows it are both day 1. */
  day: number;
  script: GameScript;
  seats: Seat[];
  storytellerSeatId: string;
  nominations: Nomination[];
  claims: Claim[];
  activeNominationId?: string;
  /** Who is currently condemned to die at dusk, and the tally that put them there. */
  onBlockSeatId?: string;
  highestTally: number;
  winner?: Alignment;
  endedReason?: string;
  timers: Timers;
  /** Wall-clock deadline for the current phase, if one is running. */
  phaseEndsAt?: number;
  /** viewer seat id -> target seat id -> that viewer's private note. */
  notes: Map<string, Map<string, SeatNote>>;
  /** Private conversations currently standing apart from the square. */
  conversations: Conversation[];
  /** Abilities declared out loud, waiting on a Storyteller ruling. */
  abilityUses: AbilityUse[];
  /** Who has stepped aside with whom today, and how often. Cleared each night. */
  metToday: { seatIds: string[]; count: number }[];
}

/**
 * A private conversation. You can only be in one at a time, because in the real
 * game you have to physically walk over and stand there — which is what makes
 * "who has Ewan spent his day with" worth watching.
 */
/**
 * A character used out loud. Some abilities are not night actions and not chatter:
 * the Gossip's statement, the Chandler's public choice, the Slayer's shot. They
 * happen in the square, everybody sees them happen, and the Storyteller has to rule
 * on them — so they need to be an event the engine can see rather than a sentence
 * the Storyteller has to catch going past.
 */
export interface AbilityUse {
  id: string;
  seatId: string;
  targetSeatIds: string[];
  text?: string;
  day: number;
  at: number;
  /** Set when the Storyteller has dealt with it. */
  resolvedAt?: number;
}

export interface Conversation {
  id: string;
  seatIds: string[];
  openedBy: string;
  openedAt: number;
  /** Bumped on every line spoken, so an abandoned huddle can be swept up. */
  lastSpokeAt: number;
}

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (error: string): Result<never> => ({ ok: false, error });
