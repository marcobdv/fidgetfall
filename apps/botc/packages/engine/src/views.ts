import type { AnyEvent, Viewer } from './events.js';
import type { Game } from './game.js';
import type {
  Alignment,
  Character,
  Nomination,
  Phase,
  ReminderToken,
  Restrictions,
  SeatNote,
  Timers,
} from './types.js';

export interface SeatView {
  id: string;
  index: number;
  name: string;
  kind: string;
  isStoryteller: boolean;
  isTraveller: boolean;
  alive: boolean;
  ghostVote: boolean;
  connected: boolean;
  hasNominatedToday: boolean;
  hasBeenNominatedToday: boolean;
  onBlock: boolean;
  /** What they have told the whole town they are. Public, and possibly a lie. */
  publicClaim?: Character;
  /** True when another living player publicly claims the same character. */
  claimContested?: boolean;
  /** What they told *you*, privately. Nobody else can see this. */
  claimToYou?: Character;
  /** They told you one thing and the town another. Only you know. */
  claimToYouDiffers?: boolean;
  /** Storyteller only: every claim this player has made, and to whom. */
  claimsMade?: { toName: string | null; character: Character }[];
  /** Present only for your own seat, or every seat when you are the Storyteller. */
  character?: Character;
  alignment?: Alignment;
  /** Grimoire-only. */
  reminders?: ReminderToken[];
  restrictions?: Restrictions;
  /** Your vote on the open nomination, if you have cast one. */
  vote?: boolean;
  /** Your own private read on this player. Nobody else ever sees it. */
  note?: SeatNote;
}

export interface NominationView {
  id: string;
  kind: Nomination['kind'];
  open: boolean;
  nominatorSeatId: string;
  nomineeSeatId: string;
  votes: { seatId: string; vote: boolean; ghost: boolean }[];
  yesCount: number;
  threshold: number;
  /** Seconds until this vote closes itself, if a vote clock is running. */
  secondsLeft?: number;
  tally?: number;
  result?: Nomination['result'];
}

export interface GameView {
  id: string;
  name: string;
  phase: Phase;
  day: number;
  /** Storyteller only. */
  joinCode?: string;
  script: {
    id: string;
    name: string;
    author?: string;
    description?: string;
    characters: Character[];
  };
  you:
    | {
        seatId: string;
        name: string;
        isStoryteller: boolean;
        alive: boolean;
        ghostVote: boolean;
        isTraveller: boolean;
        character?: Character;
        alignment?: Alignment;
        restrictions?: Restrictions;
        /** Every claim you have made, and to whom. `toName: null` means aloud. */
        claimsMade?: { toName: string | null; character: Character }[];
      }
    | null;
  seats: SeatView[];
  aliveCount: number;
  votesToExecute: number;
  nomination: NominationView | null;
  onBlockSeatId?: string;
  winner?: Alignment;
  endedReason?: string;
  /** Storyteller only: script characters nobody was given. */
  notInPlay?: Character[];
  /** Configured phase durations in seconds. */
  timers: Timers;
  /** Seconds until this phase ends itself, if a clock is running. */
  secondsLeft?: number;
  /** Highest event seq included in this view; pass it back as the cursor. */
  cursor: number;
}

const isST = (viewer: Viewer) => viewer.kind === 'storyteller';

/** The seat whose notepad this viewer owns, if any. */
const notepadOwner = (game: Game, viewer: Viewer): string | undefined =>
  viewer.kind === 'storyteller'
    ? game.state.storytellerSeatId
    : viewer.kind === 'seat'
      ? viewer.seatId
      : undefined;
const isSeat = (viewer: Viewer, seatId: string) => viewer.kind === 'seat' && viewer.seatId === seatId;

export function buildView(game: Game, viewer: Viewer): GameView {
  const state = game.state;
  const nomination = game.activeNomination();
  const alive = game.alivePlayers().length;
  const notepad = notepadOwner(game, viewer);
  const contested = new Set(game.contestedClaims().map((c) => c.characterId));

  const seats: SeatView[] = game
    .players()
    .map((seat) => {
      const mine = isSeat(viewer, seat.id);
      const view: SeatView = {
        id: seat.id,
        index: seat.index,
        name: seat.name,
        kind: seat.kind,
        isStoryteller: false,
        isTraveller: seat.isTraveller,
        alive: seat.alive,
        ghostVote: seat.ghostVote,
        connected: seat.connected,
        hasNominatedToday: seat.hasNominatedToday,
        hasBeenNominatedToday: seat.hasBeenNominatedToday,
        onBlock: state.onBlockSeatId === seat.id,
      };
      const publicClaim = game.character(game.publicClaim(seat.id)?.characterId);
      if (publicClaim) {
        view.publicClaim = publicClaim;
        if (contested.has(publicClaim.id)) view.claimContested = true;
      }
      // What they told you is yours alone; what they told anyone else is not.
      if (notepad) {
        const toMe = game.claimsMadeTo(notepad).find((c) => c.fromSeatId === seat.id);
        const told = game.character(toMe?.characterId);
        if (told) {
          view.claimToYou = told;
          if (publicClaim && publicClaim.id !== told.id) view.claimToYouDiffers = true;
        }
      }
      if (isST(viewer)) {
        const made = game.claimsMadeBy(seat.id);
        if (made.length) {
          view.claimsMade = made.map((c) => ({
            toName: c.toSeatId ? (game.seat(c.toSeatId)?.name ?? '?') : null,
            character: game.character(c.characterId) as Character,
          }));
        }
      }
      if (isST(viewer) || mine) {
        const character = game.character(seat.characterId);
        if (character) view.character = character;
        if (seat.alignment) view.alignment = seat.alignment;
      }
      if (isST(viewer)) {
        view.reminders = seat.reminders;
        view.restrictions = seat.restrictions;
      }
      const cast = nomination?.votes.find((v) => v.seatId === seat.id);
      if (cast) view.vote = cast.vote;
      const note = notepad ? game.note(notepad, seat.id) : undefined;
      if (note) view.note = note;
      return view;
    });

  const storyteller = game.storyteller;
  const you =
    viewer.kind === 'storyteller'
      ? {
          seatId: storyteller.id,
          name: storyteller.name,
          isStoryteller: true,
          alive: true,
          ghostVote: false,
          isTraveller: false,
        }
      : viewer.kind === 'seat'
        ? (() => {
            const seat = game.seat(viewer.seatId);
            if (!seat) return null;
            const character = game.character(seat.characterId);
            return {
              seatId: seat.id,
              name: seat.name,
              isStoryteller: false,
              alive: seat.alive,
              ghostVote: seat.ghostVote,
              isTraveller: seat.isTraveller,
              ...(character ? { character } : {}),
              ...(seat.alignment ? { alignment: seat.alignment } : {}),
              restrictions: seat.restrictions,
              // Your own ledger: what you have told whom, so you can keep a
              // story straight — or notice that you have not.
              claimsMade: game.claimsMadeBy(seat.id).map((c) => ({
                toName: c.toSeatId ? (game.seat(c.toSeatId)?.name ?? '?') : null,
                character: game.character(c.characterId) as Character,
              })),
            };
          })()
        : null;

  const view: GameView = {
    id: state.id,
    name: state.name,
    phase: state.phase,
    day: state.day,
    script: {
      id: state.script.id,
      name: state.script.name,
      ...(state.script.author ? { author: state.script.author } : {}),
      ...(state.script.description ? { description: state.script.description } : {}),
      characters: state.script.characters,
    },
    you,
    seats,
    aliveCount: alive,
    votesToExecute: Math.ceil(alive / 2),
    nomination: nomination
      ? {
          id: nomination.id,
          kind: nomination.kind,
          open: nomination.open,
          nominatorSeatId: nomination.nominatorSeatId,
          nomineeSeatId: nomination.nomineeSeatId,
          votes: nomination.votes.map((v) => ({ seatId: v.seatId, vote: v.vote, ghost: v.ghost })),
          yesCount: nomination.votes.filter((v) => v.vote).length,
          threshold:
            nomination.kind === 'exile'
              ? Math.ceil(game.players().length / 2)
              : Math.ceil(alive / 2),
          ...(nomination.tally !== undefined ? { tally: nomination.tally } : {}),
          ...(nomination.result ? { result: nomination.result } : {}),
          ...(game.voteSecondsLeft() !== undefined ? { secondsLeft: game.voteSecondsLeft() } : {}),
        }
      : null,
    timers: game.timers(),
    cursor: game.log.length,
  };
  const left = game.secondsLeft();
  if (left !== undefined) view.secondsLeft = left;
  if (isST(viewer)) {
    view.joinCode = state.joinCode;
    view.notInPlay = game.charactersNotInPlay();
  }
  if (state.onBlockSeatId) view.onBlockSeatId = state.onBlockSeatId;
  if (state.winner) view.winner = state.winner;
  if (state.endedReason) view.endedReason = state.endedReason;
  return view;
}

/** One line of prose per event — what an agent reads instead of raw JSON. */
export function describeEvent(game: Game, event: AnyEvent): string {
  const name = (seatId: string | null | undefined) =>
    (seatId ? game.seat(seatId)?.name : undefined) ?? 'someone';
  const d = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'game.created':
      return `The game "${d['name']}" was created on the script ${d['scriptName']}.`;
    case 'player.joined':
      return `${d['name']} took a seat.`;
    case 'player.left':
      return `${d['name']} left the game.`;
    case 'player.connection':
      return `${name(d['seatId'] as string)} ${d['connected'] ? 'reconnected' : 'disconnected'}.`;
    case 'seating.changed':
      return 'The seating order changed.';
    case 'game.started':
      return `The game begins with ${d['seats']} players. Night ${d['day']} falls.`;
    case 'game.ended':
      return `The game is over: ${d['winner']} wins. ${d['reason']}`;
    case 'phase.changed':
      return `Phase: ${d['phase']} (day ${d['day']}).`;
    case 'chat.public':
      return `[town] ${d['fromName']}: ${d['text']}`;
    case 'chat.whisper':
      return `[whisper ${d['fromName']} -> ${d['toName']}] ${d['text']}`;
    case 'chat.whisper.observed':
      return `${name(d['fromSeatId'] as string)} and ${name(d['toSeatId'] as string)} stepped aside to talk privately.`;
    case 'chat.storyteller':
      return d['fromStoryteller']
        ? `[storyteller] ${d['text']}`
        : `[to storyteller] ${name(d['fromSeatId'] as string)}: ${d['text']}`;
    case 'st.wake':
      return d['prompt'] ? `The Storyteller wakes you: ${d['prompt']}` : 'The Storyteller wakes you.';
    case 'st.sleep':
      return 'The Storyteller puts you back to sleep.';
    case 'st.info':
      return `The Storyteller shows you: ${d['text']}`;
    case 'st.grimoire':
      return `[grimoire] ${d['change']}`;
    case 'player.died':
      return `${d['name']} is dead (${d['cause']}).`;
    case 'player.revived':
      return `${d['name']} is alive again.`;
    case 'player.character':
      return `You are the ${d['characterName']} (${d['team']}).`;
    case 'player.claim': {
      const to = d['toName'] ? ` to ${d['toName']}` : ' to the whole town';
      if (d['characterId'] === null) return `${d['name']} takes back their claim${to}.`;
      const contested = d['contestedBy'] as string[];
      if (d['toName']) return `${d['name']} tells ${d['toName']} privately: "I am the ${d['characterName']}."`;
      return contested.length
        ? `${d['name']} claims the ${d['characterName']} to the whole town — so does ${contested.join(', ')}. One of them is lying.`
        : `${d['name']} claims the ${d['characterName']} to the whole town.`;
    }
    case 'player.claim.observed':
      return `${name(d['fromSeatId'] as string)} said something private to ${name(d['toSeatId'] as string)}.`;
    case 'nomination.made':
      return `${d['nominatorName']} nominates ${d['nomineeName']}${d['kind'] === 'exile' ? ' for exile' : ''}.`;
    case 'vote.cast':
      return `${d['name']} votes ${d['vote'] ? 'YES' : 'no'}${d['ghost'] ? ' (ghost vote)' : ''}.`;
    case 'nomination.closed': {
      const result = d['result'];
      const detail =
        result === 'on-block'
          ? `${d['nomineeName']} is on the block`
          : result === 'tied'
            ? 'a tie — nobody is on the block'
            : result === 'exiled'
              ? `${d['nomineeName']} is exiled`
              : result === 'not-exiled'
                ? `${d['nomineeName']} is not exiled`
                : 'not enough votes';
      return `Vote closed on ${d['nomineeName']}: ${d['tally']}/${d['threshold']} — ${detail}.`;
    }
    case 'execution':
      return d['seatId'] ? `${d['name']} is executed.` : 'Nobody is executed today.';
    case 'exile':
      return `${d['name']} is exiled from the town.`;
    case 'timer.set':
      return d['seconds'] === null
        ? `The ${d['key']} clock is off.`
        : `The ${d['key']} clock is set to ${d['seconds']}s.`;
    case 'timer.started':
      return `${String(d['key']).charAt(0).toUpperCase()}${String(d['key']).slice(1)} runs for ${d['seconds']} seconds.`;
    case 'timer.expired':
      return `Time is up — ${d['consequence']}.`;
    case 'system.notice':
      return `${d['text']}`;
  }
  return 'something happened';
}
