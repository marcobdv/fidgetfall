/** Domain types for the Blood on the Clocktower engine. */

export type Team = 'townsfolk' | 'outsider' | 'minion' | 'demon' | 'traveller' | 'fabled';
export type Alignment = 'good' | 'evil';
export type SeatKind = 'human' | 'agent';

/**
 * Phases follow a real game: night, then the day's open discussion, then
 * nominations, then dusk (when the execution resolves) and back to night.
 */
export type Phase = 'lobby' | 'night' | 'day' | 'nominations' | 'dusk' | 'over';

export const PHASE_CYCLE: Phase[] = ['night', 'day', 'nominations', 'dusk'];

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
  characterId: string;
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
}

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (error: string): Result<never> => ({ ok: false, error });
