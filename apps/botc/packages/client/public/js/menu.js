/** The per-seat action menu and the Storyteller's control bar. */

import { buildNoteEditor } from './notes.js';

function button(label, onClick) {
  const node = document.createElement('button');
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

export function openSeatMenu(menu, { seat, view, send, close, openChannel }) {
  menu.replaceChildren();
  menu.hidden = false;

  const title = document.createElement('h4');
  title.textContent = `${seat.index + 1}. ${seat.name}`;
  menu.appendChild(title);

  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = [
    seat.alive ? 'alive' : 'dead',
    seat.isTraveller ? 'traveller' : null,
    seat.character ? seat.character.name : null,
    seat.alignment ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
  menu.appendChild(who);

  const me = view.you;
  const isStoryteller = Boolean(me?.isStoryteller);
  const act = async (command) => {
    close();
    await send(command);
  };

  // Your own seat: say what you are, or take it back.
  if (!isStoryteller && me && seat.id === me.seatId && (view.phase === 'day' || view.phase === 'nominations')) {
    const claim = document.createElement('select');
    claim.appendChild(new Option('claim a character…', ''));
    for (const character of view.script.characters) {
      claim.appendChild(new Option(`${character.name} (${character.team})`, character.id));
    }
    claim.value = seat.claim?.id ?? '';
    claim.addEventListener('change', () => act({ type: 'claim', character: claim.value || null }));
    menu.appendChild(claim);
    if (seat.claim) {
      menu.appendChild(button('Take back my claim', () => act({ type: 'claim', character: null })));
    }
  }

  if (!isStoryteller && me && seat.id !== me.seatId) {
    if (view.phase === 'day' || view.phase === 'nominations') {
      menu.appendChild(button('Whisper', () => {
        close();
        openChannel(`w:${seat.id}`);
      }));
    }
    if (view.phase === 'nominations' && me.alive) {
      menu.appendChild(button('Nominate', () => act({ type: 'nominate', target: seat.id })));
    }
  }

  if (isStoryteller) {
    menu.appendChild(button('Private message', () => {
      close();
      openChannel(`st:${seat.id}`);
    }));
    menu.appendChild(button('Wake', () => act({ type: 'st_wake', target: seat.id, prompt: prompt('Prompt (optional)') || undefined })));
    menu.appendChild(button('Sleep', () => act({ type: 'st_sleep', target: seat.id })));
    menu.appendChild(button('Give info…', () => {
      const text = prompt(`What does ${seat.name} learn?`);
      if (text) act({ type: 'st_info', target: seat.id, text });
      else close();
    }));

    const select = document.createElement('select');
    select.appendChild(new Option('Assign character…', ''));
    for (const character of view.script.characters) {
      select.appendChild(new Option(`${character.name} (${character.team})`, character.id));
    }
    select.value = seat.character?.id ?? '';
    select.addEventListener('change', () => {
      if (select.value) act({ type: 'st_assign', target: seat.id, character: select.value });
    });
    menu.appendChild(select);

    menu.appendChild(
      seat.alive
        ? button('Kill', () => act({ type: 'st_kill', target: seat.id, cause: prompt('Cause', 'the Storyteller') || 'the Storyteller' }))
        : button('Revive', () => act({ type: 'st_revive', target: seat.id })),
    );
    menu.appendChild(button('Add reminder…', () => {
      const label = prompt(`Reminder token on ${seat.name}`);
      if (label) act({ type: 'st_add_reminder', target: seat.id, label });
      else close();
    }));
    if (seat.reminders?.length) {
      for (const reminder of seat.reminders) {
        menu.appendChild(
          button(`Remove "${reminder.label}"`, () =>
            act({ type: 'st_remove_reminder', target: seat.id, reminderId: reminder.id }),
          ),
        );
      }
    }
    menu.appendChild(button('Put on the block', () => act({ type: 'st_set_on_block', target: seat.id })));
    menu.appendChild(
      button(seat.isTraveller ? 'Make a resident' : 'Make a traveller', () =>
        act({ type: 'st_set_traveller', target: seat.id, isTraveller: !seat.isTraveller }),
      ),
    );
  }

  // Everybody keeps notes, the Storyteller included — theirs are separate from
  // the grimoire, and are their read on how the town is reading each other.
  if (me) menu.appendChild(buildNoteEditor(seat, view, send));

  menu.appendChild(button('Close', close));
}

export function renderActionBar(container, { view, send }) {
  container.replaceChildren();
  const me = view.you;
  if (!me || me.isStoryteller) return;

  const nomination = view.nomination;
  if (nomination?.open) {
    const alreadyVoted = nomination.votes.some((v) => v.seatId === me.seatId);
    const nominee = view.seats.find((s) => s.id === nomination.nomineeSeatId);
    const label = document.createElement('span');
    label.textContent = `Execute ${nominee?.name ?? '?'}? `;
    container.appendChild(label);
    const yes = button('Vote yes', () => send({ type: 'vote', vote: true }));
    const no = button('Vote no', () => send({ type: 'vote', vote: false }));
    yes.className = 'primary';
    if (alreadyVoted) {
      yes.disabled = true;
      no.disabled = true;
      label.textContent = `You voted ${nomination.votes.find((v) => v.seatId === me.seatId).vote ? 'yes' : 'no'}.`;
    }
    if (!me.alive && !me.ghostVote) yes.disabled = true;
    container.appendChild(yes);
    container.appendChild(no);
    return;
  }

  if (view.phase === 'nominations' && me.alive) {
    const hint = document.createElement('span');
    hint.textContent = 'Click a player to nominate them.';
    container.appendChild(hint);
  }
}

export function renderStorytellerBar(container, { view, send }) {
  container.replaceChildren();
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Storyteller';
  container.appendChild(label);

  if (view.phase === 'lobby') {
    const start = button('Start the game', () => send({ type: 'st_start' }));
    start.className = 'primary';
    start.disabled = view.seats.length < 3;
    container.appendChild(start);
    const code = document.createElement('span');
    code.className = 'label';
    code.textContent = `Join code ${view.joinCode ?? ''}`;
    container.appendChild(code);
    return;
  }

  for (const phase of ['night', 'day', 'nominations', 'dusk']) {
    const node = button(phase, () => send({ type: 'st_set_phase', phase }));
    if (phase === view.phase) node.classList.add('primary');
    container.appendChild(node);
  }
  container.appendChild(button('Next phase →', () => send({ type: 'st_advance_phase' })));

  if (view.nomination?.open) {
    container.appendChild(button('Close the vote', () => send({ type: 'st_close_nomination' })));
    container.appendChild(button('Cancel it', () => send({ type: 'st_cancel_nomination' })));
  }
  if (view.onBlockSeatId) {
    container.appendChild(button('Clear the block', () => send({ type: 'st_set_on_block', target: null })));
  }
  const timer = (label, key, seconds) =>
    button(label, () => send({ type: 'st_set_timer', key, seconds }));
  container.appendChild(timer('Day 5m', 'day', 300));
  container.appendChild(timer('Nominations 3m', 'nominations', 180));
  container.appendChild(timer('Vote 90s', 'vote', 90));
  if (Object.keys(view.timers ?? {}).length) {
    container.appendChild(button('Clocks off', () => send({ type: 'st_clear_timers' })));
  }

  container.appendChild(button('Announce…', () => {
    const text = prompt('Tell the whole town');
    if (text) send({ type: 'st_announce', text });
  }));
  container.appendChild(button('End the game…', () => {
    const winner = prompt('Who wins? good or evil')?.trim().toLowerCase();
    if (winner !== 'good' && winner !== 'evil') return;
    const reason = prompt('Why?') ?? '';
    send({ type: 'st_end_game', winner, reason });
  }));
}
