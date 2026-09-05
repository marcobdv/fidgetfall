import { describeEvent, type AnyEvent, type GameView, type SeatView } from '@botc/engine';
import type { Room } from './rooms.js';

/** "the Chef", or "one of the Chef, the Empath or the Monk" for a hedged claim. */
function claimPhrase(characters: { name: string }[]): string {
  const names = characters.map((c) => `the ${c.name}`);
  if (names.length <= 1) return names[0] ?? '—';
  return `one of ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}


/** "4m 10s" — how long is left, in words an agent can act on. */
export function clock(seconds: number): string {
  if (seconds <= 0) return 'no time';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest}s`;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

const seatLine = (seat: SeatView, youSeatId: string | undefined): string => {
  const bits: string[] = [];
  bits.push(seat.alive ? 'alive' : 'DEAD');
  if (!seat.alive) bits.push(seat.ghostVote ? 'ghost vote unspent' : 'ghost vote spent');
  if (seat.isTraveller) bits.push('traveller');
  if (seat.onBlock) bits.push('ON THE BLOCK');
  if (seat.hasNominatedToday) bits.push('has nominated today');
  if (seat.hasBeenNominatedToday) bits.push('has been nominated today');
  if (!seat.connected) bits.push('disconnected');
  if (seat.publicClaim?.length) {
    bits.push(
      `publicly claims ${claimPhrase(seat.publicClaim)}${seat.claimContested ? ' (CONTESTED)' : ''}`,
    );
  }
  if (seat.claimToYou?.length) {
    bits.push(
      `told YOU they are ${claimPhrase(seat.claimToYou)}${seat.claimToYouDiffers ? ' — which is NOT what they told the town' : ''}`,
    );
  } else if (seat.claimUnanswered) {
    bits.push('you made them an offer they have not answered');
  }
  if (seat.claimsMade?.length) {
    bits.push(
      `stories: ${seat.claimsMade.map((c) => `${claimPhrase(c.characters)} to ${c.toName ?? 'the town'}`).join('; ')}`,
    );
  }
  if (seat.character)
    bits.push(
      `${seat.character.name}${seat.alignment ? ` / ${seat.alignment}` : ''}${seat.believedCharacter ? ` (thinks: ${seat.believedCharacter.name})` : ''}`,
    );
  if (seat.reminders?.length) bits.push(`reminders: ${seat.reminders.map((r) => r.label).join(', ')}`);
  const you = seat.id === youSeatId ? ' (you)' : '';
  const line = `  ${seat.index + 1}. ${seat.name}${you} — ${bits.join(', ')}`;
  return seat.note ? `${line}\n       your note: ${renderNote(seat.note)}` : line;
};

/** One player's private read on another, as a single line. */
export function renderNote(note: NonNullable<SeatView['note']>): string {
  const parts: string[] = [];
  if (note.alignment) parts.push(note.alignment === 'unknown' ? 'alignment unclear' : note.alignment);
  if (note.teams.length) parts.push(note.teams.join(' or '));
  if (note.characters.length) parts.push(`maybe ${note.characters.join(' / ')}`);
  if (note.confidence) parts.push(`(${note.confidence})`);
  if (note.text) parts.push(`"${note.text}"`);
  return parts.join(' · ') || 'empty';
}

/** The whole situation as an agent should read it. */
export function renderView(view: GameView): string {
  const lines: string[] = [];
  const you = view.you;
  lines.push(
    `## ${view.name} — ${view.phase}${view.day ? ` (day ${view.day})` : ''}` +
      (view.secondsLeft !== undefined ? ` · ${clock(view.secondsLeft)} left` : ''),
  );
  lines.push(`Script: ${view.script.name}${view.script.author ? ` by ${view.script.author}` : ''}`);
  if (view.joinCode) lines.push(`Join code: ${view.joinCode}`);

  if (you?.isStoryteller) {
    lines.push('You are the STORYTELLER. You see every character and rule on every ability.');
  } else if (you) {
    const character = you.character;
    lines.push(
      `You are ${you.name}${you.isTraveller ? ' (traveller)' : ''}, ${you.alive ? 'alive' : `dead${you.ghostVote ? ' with your ghost vote unspent' : ' with no vote left'}`}.`,
    );
    if (character) {
      lines.push(
        `Your character: ${character.name} (${character.team}${you.alignment ? `, ${you.alignment}` : ''}).`,
      );
      if (character.ability) lines.push(`Your ability: ${character.ability}`);
    } else {
      lines.push('The Storyteller has not given you a character yet.');
    }
    const blocked = Object.entries(you.restrictions ?? {})
      .filter(([, allowed]) => !allowed)
      .map(([key]) => key);
    if (blocked.length) lines.push(`You currently cannot: ${blocked.join(', ')}.`);
  } else {
    lines.push('You are watching this game as a spectator.');
  }

  lines.push('', `Seats (${view.seats.length}, ${view.aliveCount} alive):`);
  for (const seat of view.seats) lines.push(seatLine(seat, you?.seatId));

  if (view.secondsLeft !== undefined) {
    lines.push(
      `**${clock(view.secondsLeft)} left in this phase.** When it runs out the game moves on without you — act now, not later.`,
    );
  }

  // The Storyteller's bluff pool, worked out for them.
  if (view.notInPlay?.length) {
    const good = view.notInPlay.filter((c) => c.team === 'townsfolk' || c.team === 'outsider');
    const evil = view.notInPlay.filter((c) => c.team === 'minion' || c.team === 'demon');
    lines.push('', 'Not in play:');
    // This is the POOL, not the handout. Labelling it "safe Demon bluffs" and
    // listing ten names is how a Storyteller ends up giving a Demon six of them.
    if (good.length) {
      lines.push(`  good — CHOOSE EXACTLY THREE of these to give the Demon, no more:`);
      lines.push(`    ${good.map((c) => c.name).join(', ')}`);
    }
    if (evil.length) lines.push(`  evil: ${evil.map((c) => c.name).join(', ')}`);
  }

  // The script sheet is a card lying face-up on the table all game, not something
  // you read once at the start. Two evil players in a row have claimed characters
  // that were not in the game because by day one the briefing was a distant memory
  // and the nearest plausible role name came from somewhere else entirely.
  const byTeam = new Map<string, string[]>();
  for (const character of view.script.characters) {
    if (character.team === 'traveller') continue;
    const list = byTeam.get(character.team) ?? [];
    list.push(character.name);
    byTeam.set(character.team, list);
  }
  if (byTeam.size) {
    lines.push('', `On the script — nothing else exists in this game (${view.script.name}):`);
    for (const [team, names] of byTeam) {
      lines.push(`  ${team}: ${names.join(', ')}`);
    }
  }

  const publicClaims = view.seats.filter((s) => s.publicClaim && s.alive);
  if (publicClaims.length) {
    lines.push('', 'Said out loud to everyone:');
    for (const seat of publicClaims) {
      lines.push(
        `  ${seat.name} claims ${claimPhrase(seat.publicClaim ?? [])}${seat.claimContested ? ' — CONTESTED, someone here is lying' : ''}`,
      );
    }
  }

  const toldYou = view.seats.filter((s) => s.claimToYou);
  if (toldYou.length) {
    lines.push('', 'Told to you in private (nobody else knows they said this):');
    for (const seat of toldYou) {
      lines.push(
        `  ${seat.name} told you they are ${claimPhrase(seat.claimToYou ?? [])}${seat.claimToYouDiffers ? ' — but they told the town something else' : ''}`,
      );
    }
  }

  if (view.you?.claimsMade?.length) {
    lines.push('', 'What YOU have told people (keep your story straight):');
    for (const made of view.you.claimsMade) {
      lines.push(`  ${claimPhrase(made.characters)} — to ${made.toName ?? 'the whole town'}`);
    }
  }

  if (view.talkingWith?.length) {
    lines.push(
      '',
      `YOU ARE STANDING APART with ${view.talkingWith.join(' and ')}. Until you \`leave\`, whispers`,
      'go to them and nobody else, and you cannot start another conversation.',
    );
  }

  const busy = view.openConversations.filter((c) => c.names.length > 0);
  if (busy.length) {
    lines.push('', 'Talking privately right now (everyone can see this):');
    for (const c of busy) lines.push(`  ${c.names.join(', ')}`);
  }

  if (view.metToday.length) {
    lines.push('', 'Who has stepped aside with whom today:');
    for (const met of view.metToday.slice(0, 12)) {
      lines.push(`  ${met.names.join(' & ')}${met.count > 1 ? ` — ${met.count} times` : ''}`);
    }
  }

  if (view.pendingAbilities?.length) {
    lines.push('', '*** WAITING ON YOUR RULING ***');
    for (const use of view.pendingAbilities) {
      const at = use.targetNames.length ? ` on ${use.targetNames.join(' and ')}` : '';
      lines.push(`  [${use.id}] day ${use.day} — ${use.name} used an ability${at}${use.text ? `: "${use.text}"` : ''}`);
    }
    lines.push('  Rule on it with storyteller { action: "resolve_ability", ability_id, text? }.');
  }

  if (view.nightOrder?.length) {
    lines.push('', `Night order — ${view.day <= 1 ? 'first night' : 'every other night'}:`);
    for (const step of view.nightOrder) {
      lines.push(`  ${step.order}. ${step.characterName}${step.inPlay ? ` — ${step.inPlay}` : ' (not in play)'}`);
    }
  }

  lines.push('', `Votes needed to execute: ${view.votesToExecute}.`);
  if (view.onBlockSeatId) {
    const seat = view.seats.find((s) => s.id === view.onBlockSeatId);
    lines.push(`On the block: ${seat?.name ?? '?'} — they die at dusk unless a bigger vote replaces them.`);
  }

  if (view.nomination) {
    const nomination = view.nomination;
    const nameOf = (id: string) => view.seats.find((s) => s.id === id)?.name ?? '?';
    const nominee = view.seats.find((s) => s.id === nomination.nomineeSeatId);
    const claimed = nominee?.publicClaim ?? nominee?.claimToYou;
    lines.push(
      '',
      nomination.state === 'defence'
        ? `${nameOf(nomination.nominatorSeatId)} has nominated ${nameOf(nomination.nomineeSeatId)}. ${nameOf(nomination.nomineeSeatId)} is answering the charge — NO VOTES are accepted yet. If that is you, say your piece now; if it is not, listen, because you vote the moment this window shuts.`
        : `Open ${nomination.kind}: ${nameOf(nomination.nominatorSeatId)} nominated ${nameOf(nomination.nomineeSeatId)}.`,
      // You are about to vote on a life; you should not have to remember what
      // they said they were.
      claimed
        ? `${nominee?.name} claims to be ${claimPhrase(claimed)}${nominee?.publicClaim ? '' : ' (told to you privately)'}. Weigh what being wrong costs before you vote.`
        : `${nominee?.name} has claimed nothing.`,
      `Votes so far: ${nomination.yesCount} yes, threshold ${nomination.threshold}.`,
    );
    if (nomination.secondsLeft !== undefined) {
      lines.push(`This vote closes in ${clock(nomination.secondsLeft)}.`);
    }
    const mine = you ? nomination.votes.find((v) => v.seatId === you.seatId) : undefined;
    lines.push(mine ? `You voted ${mine.vote ? 'YES' : 'no'}.` : 'You have not voted yet.');
  }

  if (view.phase === 'over') {
    lines.push('', `GAME OVER — ${view.winner} wins. ${view.endedReason ?? ''}`);
  }

  lines.push('', `Cursor: ${view.cursor} (pass this to await_event).`);
  return lines.join('\n');
}

export function renderEvents(room: Room, events: AnyEvent[]): string {
  if (!events.length) return 'Nothing happened.';
  return events.map((event) => `[${event.seq}] ${describeEvent(room.game, event)}`).join('\n');
}

export function renderScriptCharacters(view: GameView): string {
  const byTeam = new Map<string, string[]>();
  for (const character of view.script.characters) {
    const list = byTeam.get(character.team) ?? [];
    list.push(character.ability ? `${character.name} — ${character.ability}` : character.name);
    byTeam.set(character.team, list);
  }
  const lines = [`## ${view.script.name}`];
  if (view.script.description) lines.push(view.script.description);
  for (const [team, names] of byTeam) {
    lines.push('', `${team.toUpperCase()} (${names.length})`);
    for (const name of names) lines.push(`  - ${name}`);
  }
  if (!view.script.characters.some((c) => c.ability)) {
    lines.push(
      '',
      'This script ships without ability text (see data/README.md). Ask the Storyteller if you need a character explained.',
    );
  }
  return lines.join('\n');
}
