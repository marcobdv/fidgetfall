import type { AnyEvent, Viewer } from './events.js';
import type { Game } from './game.js';
import type {
  Alignment,
  Character,
  Nomination,
  Phase,
  ReminderToken,
  Restrictions,
  Seat,
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
  /**
   * What they have told the whole town they are. Public, possibly a lie, and
   * possibly a hedge — several characters means "I am one of these".
   */
  publicClaim?: Character[];
  /** True when another living player publicly commits to the same single character. */
  claimContested?: boolean;
  /** What they told *you*, privately. Nobody else can see this. */
  claimToYou?: Character[];
  /** They told you one thing and the town another. Only you know. */
  claimToYouDiffers?: boolean;
  /** You offered them yours and they have not offered anything back. */
  claimUnanswered?: boolean;
  /** Storyteller only: every claim this player has made, and to whom. */
  claimsMade?: { toName: string | null; characters: Character[] }[];
  /** Present only for your own seat, or every seat when you are the Storyteller. */
  character?: Character;
  /**
   * Storyteller only, and only for a player who has been lied to: what they think
   * they are, next to the `character` they actually are. A player's own view never
   * carries this — they just see the lie in `character`, which is the point.
   */
  believedCharacter?: Character;
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
  /** 'defence' means the nominee is answering and no votes are accepted yet. */
  state: Nomination['state'];
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
        claimsMade?: { toName: string | null; characters: Character[] }[];
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
  cursor: number;  /**
   * Who has stepped aside with whom today, and how often. Everyone sees this —
   * the square watches people walk off together even when it hears nothing.
   */
  metToday: { names: string[]; count: number }[];
  /** Conversations standing apart right now, and who is in them. Public. */
  openConversations: { names: string[] }[];
  /** The people you are currently standing with, if you stepped aside. */
  talkingWith?: string[];
  /**
   * Storyteller only: tonight's wake order, straight off the script, with the name
   * of whoever holds each character. Running the order by hand is how a Storyteller
   * forgets the Exorcist.
   */
  nightOrder?: { order: number; characterName: string; inPlay?: string }[];

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

/**
 * The alignment a player believes they have. For almost everyone that is simply
 * the truth; for a Lunatic told they are the Demon it is *evil*, because a briefing
 * that reads "Po — demon, good" tells them exactly what they are in one line.
 */
function alignmentOf(seat: Seat, believed: Character | undefined): Alignment | undefined {
  if (!believed) return seat.alignment;
  return believed.team === 'minion' || believed.team === 'demon' ? 'evil' : 'good';
}

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
      const characters = (ids: string[]): Character[] =>
        ids.map((id) => game.character(id)).filter((c): c is Character => Boolean(c));
      const publicClaim = characters(game.publicClaim(seat.id)?.characterIds ?? []);
      if (publicClaim.length) {
        view.publicClaim = publicClaim;
        if (publicClaim.length === 1 && contested.has(publicClaim[0]!.id)) {
          view.claimContested = true;
        }
      }
      // What they told you is yours alone; what they told anyone else is not.
      if (notepad && notepad !== seat.id) {
        const { offered, answered } = game.exchange(notepad, seat.id);
        const told = characters(answered?.characterIds ?? []);
        if (told.length) {
          view.claimToYou = told;
          // Only a straight contradiction counts: a hedge that includes what they
          // told the town has not caught them in anything.
          if (publicClaim.length && !told.some((t) => publicClaim.some((p) => p.id === t.id))) {
            view.claimToYouDiffers = true;
          }
        } else if (offered) {
          view.claimUnanswered = true;
        }
      }
      if (isST(viewer)) {
        const made = game.claimsMadeBy(seat.id);
        if (made.length) {
          view.claimsMade = made.map((c) => ({
            toName: c.toSeatId ? (game.seat(c.toSeatId)?.name ?? '?') : null,
            characters: characters(c.characterIds),
          }));
        }
      }
      // A traveller is public. Everyone at the table knows who they are and what
      // they do — that is the trade for being allowed to join a game in progress.
      if (isST(viewer) || mine || seat.isTraveller) {
        // A lied-to player sees only the lie; the Storyteller sees the truth and the lie.
        const truth = game.character(seat.characterId);
        const believed = game.character(seat.believedCharacterId);
        const character = isST(viewer) ? truth : (believed ?? truth);
        if (character) view.character = character;
        if (isST(viewer) && believed) view.believedCharacter = believed;
        // Their alignment stays their own; only the Storyteller and they see it — and a
        // lied-to player is told the alignment that goes WITH the lie. A Lunatic who
        // reads "Demon, good" has been handed the answer on their own briefing.
        const shown = isST(viewer) ? seat.alignment : alignmentOf(seat, believed);
        if (shown && (isST(viewer) || mine)) view.alignment = shown;
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
            const believed = game.character(seat.believedCharacterId);
            const character = believed ?? game.character(seat.characterId);
            const alignment = alignmentOf(seat, believed);
            return {
              seatId: seat.id,
              name: seat.name,
              isStoryteller: false,
              alive: seat.alive,
              ghostVote: seat.ghostVote,
              isTraveller: seat.isTraveller,
              ...(character ? { character } : {}),
              ...(alignment ? { alignment } : {}),
              restrictions: seat.restrictions,
              // Your own ledger: what you have told whom, so you can keep a
              // story straight — or notice that you have not.
              claimsMade: game.claimsMadeBy(seat.id).map((c) => ({
                toName: c.toSeatId ? (game.seat(c.toSeatId)?.name ?? '?') : null,
                characters: c.characterIds
                  .map((id) => game.character(id))
                  .filter((ch): ch is Character => Boolean(ch)),
              })),
            };
          })()
        : null;

  const talkingWith =
    viewer.kind === 'seat'
      ? game
          .conversationOf(viewer.seatId)
          ?.seatIds.filter((id) => id !== viewer.seatId)
          .map((id) => game.seat(id)?.name ?? '?')
      : undefined;

  const view: GameView = {
    id: state.id,
    name: state.name,
    metToday: game.metToday(),
    ...(isST(viewer)
      ? {
          nightOrder: game.nightOrder().map((character) => {
            const holder = game
              .players()
              .find((seat) => seat.characterId === character.id || seat.believedCharacterId === character.id);
            return {
              order: (state.day <= 1 ? character.firstNight : character.otherNight) ?? 0,
              characterName: character.name,
              ...(holder ? { inPlay: `${holder.name}${holder.characterId === character.id ? '' : ' (believes it)'}` } : {}),
            };
          }),
        }
      : {}),
    openConversations: game
      .openConversations()
      .map((c) => ({ names: c.seatIds.map((id) => game.seat(id)?.name ?? '?') })),
    ...(talkingWith?.length ? { talkingWith } : {}),
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
          state: nomination.state,
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
    case 'chat.whisper': {
      const to = (d['toNames'] as string[]) ?? [];
      return `[whisper ${d['fromName']} -> ${to.join(', ')}] ${d['text']}`;
    }
    case 'game.rollcall': {
      const seats = (d['seats'] as Record<string, unknown>[]) ?? [];
      const rows = seats.map((row) => {
        const believed = row['believedCharacterName'];
        return `  ${row['index']}. ${row['name']} — ${row['characterName']} (${row['team']}, ${row['alignment']})${believed ? `, and thought they were the ${believed}` : ''}${row['alive'] ? '' : ', dead'}`;
      });
      return ['THE ROLL CALL — everyone, out loud:', ...rows].join('\n');
    }
    case 'conversation.opened': {
      const who = (d['names'] as string[]) ?? [];
      if (who.length <= 2) return `${who[0]} and ${who[1]} stepped aside to talk privately.`;
      const last = who[who.length - 1];
      return `${who.slice(0, -1).join(', ')} and ${last} stepped aside together — ${who.length} of them, out of earshot.`;
    }
    case 'conversation.closed': {
      const who = (d['names'] as string[]) ?? [];
      return `${who.join(', ')} came back into the square — ${d['reason']}.`;
    }
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
    case 'st.grimoire.shown': {
      const seats = d['seats'] as {
        index: number;
        name: string;
        characterName: string | null;
        alignment: string | null;
        alive: boolean;
        reminders: string[];
      }[];
      return [
        'The Storyteller opens the grimoire and lets you read it:',
        ...seats.map(
          (s) =>
            `  ${s.index + 1}. ${s.name} — ${s.characterName ?? 'no character'}` +
            `${s.alignment ? ` (${s.alignment})` : ''}${s.alive ? '' : ', dead'}` +
            `${s.reminders.length ? ` · ${s.reminders.join(', ')}` : ''}`,
        ),
        'That is what was true this moment. It can change before morning.',
      ].join('\n');
    }
    case 'player.died': {
      // "X is dead (the Imp)" was read as "X *was* the Imp" by a player, who then
      // disbelieved their own role for the rest of the game. Never again.
      const cause = String(d['cause']);
      if (cause === 'execution') return `${d['name']} is dead, executed by the town.`;
      if (cause === 'exile') return `${d['name']} is dead, exiled by the town.`;
      return `${d['name']} is dead, killed by ${cause}.`;
    }
    case 'player.revived':
      return `${d['name']} is alive again.`;
    case 'player.character':
      return `You are the ${d['characterName']} (${d['team']}).`;
    case 'player.claim': {
      const to = d['toName'] ? ` to ${d['toName']}` : ' to the whole town';
      const names = (d['characterNames'] as string[]) ?? [];
      if (!names.length) return `${d['name']} takes back their claim${to}.`;
      // One character is a commitment; several is the three-for-three hedge.
      const what =
        names.length === 1
          ? `the ${names[0]}`
          : `one of the ${names.slice(0, -1).join(', the ')} or the ${names[names.length - 1]}`;
      const contested = d['contestedBy'] as string[];
      if (d['toName']) {
        return names.length === 1
          ? `${d['name']} tells ${d['toName']} privately: "I am ${what}."`
          : `${d['name']} offers ${d['toName']} privately: "I am ${what}." — a three for three; they are owed an answer.`;
      }
      return contested.length
        ? `${d['name']} claims ${what} to the whole town — so does ${contested.join(', ')}. One of them is lying.`
        : `${d['name']} claims ${what} to the whole town.`;
    }
    case 'player.claim.observed':
      return `${name(d['fromSeatId'] as string)} said something private to ${name(d['toSeatId'] as string)}.`;
    case 'nomination.made':
      return (
        `${d['nominatorName']} nominates ${d['nomineeName']}${d['kind'] === 'exile' ? ' for exile' : ''}. ` +
        `${d['nomineeName']}, answer the charge — no hands go up until you have.`
      );
    case 'nomination.voting':
      return `Hands up on ${d['nomineeName']}. ${d['threshold']} votes carry it.`;
    case 'nomination.floor':
      return `The floor is still open — ${d['remaining']} ${d['remaining'] === 1 ? 'player has' : 'players have'} not nominated today.`;
    case 'vote.cast':
      return (
        `${d['name']} votes ${d['vote'] ? 'YES' : 'no'}${d['ghost'] ? ' (ghost vote)' : ''}. ` +
        `Running count: ${d['yesCount']} yes, ${d['noCount']} no — ${d['threshold']} needed, ` +
        `${d['yetToVote']} yet to vote.`
      );
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
