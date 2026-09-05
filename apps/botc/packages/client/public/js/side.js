/** Channel routing and the message log. */

export function channelFor(event, view) {
  const me = view.you?.seatId;
  const iAmStoryteller = Boolean(view.you?.isStoryteller);
  const d = event.data ?? {};
  switch (event.type) {
    case 'chat.whisper': {
      // A conversation is keyed by everyone in it, so a huddle gets its own thread
      // rather than being smeared across two separate whisper channels.
      const seats = [d.fromSeatId, ...(d.toSeatIds ?? [])].filter((id) => id !== me).sort();
      return `w:${seats.join(',')}`;
    }
    case 'chat.storyteller':
      return iAmStoryteller ? `st:${d.fromStoryteller ? d.toSeatId : d.fromSeatId}` : 'st';
    case 'st.info':
    case 'st.wake':
    case 'st.sleep':
    case 'player.character':
      return iAmStoryteller ? `st:${d.seatId}` : 'st';
    case 'st.grimoire':
      return 'grimoire';
    default:
      return 'town';
  }
}

const CLASS_FOR = {
  'chat.whisper': 'whisper',
  'chat.storyteller': 'st',
  'st.info': 'st',
  'st.wake': 'st',
  'st.sleep': 'st',
  'st.grimoire': 'st',
  'player.died': 'death',
  execution: 'death',
  exile: 'death',
};

export function channelLabel(channel, view) {
  if (channel === 'town') return 'Town square';
  if (channel === 'st') return 'Storyteller';
  if (channel === 'grimoire') return 'Grimoire';
  const [kind, ids] = channel.split(':');
  const names = (ids ?? '')
    .split(',')
    .map((id) => view.seats.find((s) => s.id === id)?.name ?? 'someone');
  return kind === 'w' ? `↔ ${names.join(', ')}` : `ST ↔ ${names[0]}`;
}

/** Every channel worth showing: always-on ones plus a tab per player. */
export function channelsFor(view, used) {
  const channels = ['town'];
  if (view.you?.isStoryteller) {
    channels.push('grimoire');
    for (const seat of view.seats) channels.push(`st:${seat.id}`);
  } else if (view.you) {
    channels.push('st');
    for (const seat of view.seats) {
      if (seat.id !== view.you.seatId) channels.push(`w:${seat.id}`);
    }
  }
  for (const channel of used) if (!channels.includes(channel)) channels.push(channel);
  return channels;
}

export function renderChannels(container, { view, channels, active, unread, onSelect }) {
  container.replaceChildren();
  for (const channel of channels) {
    const button = document.createElement('button');
    button.textContent = channelLabel(channel, view);
    if (channel === active) button.classList.add('is-active');
    const count = unread[channel] ?? 0;
    if (count && channel !== active) {
      const badge = document.createElement('span');
      badge.className = 'unread';
      badge.textContent = ` ${count}`;
      button.appendChild(badge);
    }
    button.addEventListener('click', () => onSelect(channel));
    container.appendChild(button);
  }
}

export function renderLog(container, events, view, channel) {
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
  container.replaceChildren();
  for (const event of events) {
    if (channelFor(event, view) !== channel) continue;
    const line = document.createElement('div');
    line.className = `entry ${CLASS_FOR[event.type] ?? (event.type === 'chat.public' ? '' : 'system')}`;
    const seq = document.createElement('span');
    seq.className = 'seq';
    seq.textContent = event.seq;
    line.appendChild(seq);
    line.appendChild(document.createTextNode(event.text ?? event.type));
    container.appendChild(line);
  }
  if (atBottom) container.scrollTop = container.scrollHeight;
}

/** What the message box does depends on which channel is open. */
export function commandForChannel(channel, text) {
  if (channel === 'town') return { type: 'say', text };
  if (channel === 'st') return { type: 'message_storyteller', text };
  const [kind, seatId] = channel.split(':');
  if (kind === 'w') return { type: 'whisper', targets: seatId.split(','), text };
  if (kind === 'st') return { type: 'st_message', target: seatId, text };
  return null;
}

export function placeholderFor(channel, view) {
  if (channel === 'grimoire') return 'The grimoire is a record, not a conversation';
  if (channel === 'town') return 'Speak in the town square';
  return `Message ${channelLabel(channel, view)}`;
}
