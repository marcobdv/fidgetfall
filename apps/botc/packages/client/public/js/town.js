/** The town square: seats around a circle, drawn as SVG. */

import { noteSummary, noteTint } from './notes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CENTER = 500;
const RADIUS = 340;
const TOKEN = 46;

const el = (name, attrs = {}, children = []) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of children) node.appendChild(child);
  return node;
};

const textNode = (name, attrs, content) => {
  const node = el(name, attrs);
  node.textContent = content;
  return node;
};

function seatPosition(index, count) {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return { x: CENTER + Math.cos(angle) * RADIUS, y: CENTER + Math.sin(angle) * RADIUS };
}

const PHASE_TITLE = {
  lobby: 'Waiting for players',
  night: 'Night falls',
  day: 'The town talks',
  nominations: 'Nominations are open',
  dusk: 'Dusk',
  over: 'The game is over',
};

export function renderTown(svg, view, options) {
  const { selected, onSeatClick, showGrimoire } = options;
  svg.replaceChildren();
  const seats = view.seats;
  const count = Math.max(seats.length, 1);
  const positions = seats.map((_, i) => seatPosition(i, count));

  // The clock face the seats sit on.
  svg.appendChild(el('circle', { cx: CENTER, cy: CENTER, r: RADIUS, fill: 'none', stroke: '#2c251d', 'stroke-width': 2 }));

  // A dashed line from nominator to nominee while a vote is live.
  const nomination = view.nomination;
  if (nomination && nomination.open) {
    const from = seats.findIndex((s) => s.id === nomination.nominatorSeatId);
    const to = seats.findIndex((s) => s.id === nomination.nomineeSeatId);
    if (from >= 0 && to >= 0) {
      const a = positions[from];
      const b = positions[to];
      svg.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'nom-line' }));
    }
  }

  svg.appendChild(centrepiece(view));

  seats.forEach((seat, index) => {
    const { x, y } = positions[index];
    const classes = ['token'];
    if (!seat.alive) classes.push('dead');
    if (seat.id === view.you?.seatId) classes.push('you');
    if (seat.id === selected) classes.push('selected');
    if (seat.onBlock) classes.push('onblock');
    if (showGrimoire && seat.alignment) classes.push(seat.alignment);
    const tint = noteTint(seat.note);
    if (tint && !(showGrimoire && seat.alignment)) classes.push(`note-${tint}`);

    const group = el('g', { class: classes.join(' '), transform: `translate(${x} ${y})`, tabindex: 0 });
    group.appendChild(el('circle', { class: 'disc', cx: 0, cy: 0, r: TOKEN }));
    group.appendChild(textNode('text', { class: 'initial', x: 0, y: 0 }, seat.name.slice(0, 2).toUpperCase()));

    // Shroud for the dead, ghost-vote token if they can still vote.
    if (!seat.alive) {
      group.appendChild(
        el('path', {
          d: `M -${TOKEN} -${TOKEN - 6} L 0 -${TOKEN + 26} L ${TOKEN} -${TOKEN - 6} Z`,
          fill: '#0f0d0b',
          stroke: '#4a4238',
          'stroke-width': 2,
        }),
      );
      if (seat.ghostVote) {
        group.appendChild(el('circle', { cx: TOKEN - 4, cy: -TOKEN + 4, r: 9, fill: '#d9d2c6' }));
      }
    }
    if (seat.isTraveller) {
      group.appendChild(textNode('text', { class: 'seat-sub', x: -TOKEN - 14, y: -TOKEN + 2 }, '✦'));
    }

    // Vote marker on the open nomination.
    const vote = nomination?.votes.find((v) => v.seatId === seat.id);
    if (vote) {
      group.appendChild(
        el('circle', { cx: -TOKEN + 6, cy: -TOKEN + 8, r: 11, class: vote.vote ? 'vote-yes' : 'vote-no' }),
      );
    }

    const label = `${index + 1}. ${seat.name}${seat.id === view.you?.seatId ? ' (you)' : ''}`;
    group.appendChild(
      textNode('text', { class: `seat-name${seat.alive ? '' : ' dead'}`, x: 0, y: TOKEN + 30 }, label),
    );

    const sub = [];
    if (showGrimoire && seat.character) sub.push(seat.character.name);
    else if (seat.id === view.you?.seatId && view.you?.character) sub.push(view.you.character.name);
    if (!seat.connected) sub.push('away');
    // What they said out loud, and separately what they said to you alone.
    let claimY = -TOKEN - 14;
    if (seat.publicClaim) {
      group.appendChild(
        textNode(
          'text',
          { class: `claim${seat.claimContested ? ' contested' : ''}`, x: 0, y: claimY },
          `"${seat.publicClaim.name}"${seat.claimContested ? ' ⚠' : ''}`,
        ),
      );
      claimY -= 24;
    }
    if (seat.claimToYou) {
      group.appendChild(
        textNode(
          'text',
          { class: `claim private${seat.claimToYouDiffers ? ' contested' : ''}`, x: 0, y: claimY },
          `told you: ${seat.claimToYou.name}${seat.claimToYouDiffers ? ' ⚠' : ''}`,
        ),
      );
    }
    if (sub.length) group.appendChild(textNode('text', { class: 'seat-sub', x: 0, y: TOKEN + 56 }, sub.join(' · ')));

    // Your own read, written under their name — only you ever see this.
    const read = noteSummary(seat.note);
    if (read) {
      group.appendChild(
        textNode('text', { class: 'seat-note', x: 0, y: TOKEN + (sub.length ? 78 : 54) }, read),
      );
    }

    if (showGrimoire && seat.reminders?.length) {
      group.appendChild(
        textNode(
          'text',
          { class: 'seat-sub', x: 0, y: TOKEN + 80 },
          seat.reminders.map((r) => r.label).join(', '),
        ),
      );
    }

    group.addEventListener('click', () => onSeatClick(seat, { x, y }));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') onSeatClick(seat, { x, y });
    });
    svg.appendChild(group);
  });
}

function centrepiece(view) {
  const group = el('g');
  group.appendChild(textNode('text', { class: 'center-title', x: CENTER, y: CENTER - 14 }, PHASE_TITLE[view.phase] ?? view.phase));

  const lines = [];
  if (view.day) lines.push(`Day ${view.day}`);
  if (view.phase !== 'lobby' && view.phase !== 'over') {
    lines.push(`${view.aliveCount} alive · ${view.votesToExecute} votes to execute`);
  }
  if (view.nomination?.open) {
    const nameOf = (id) => view.seats.find((s) => s.id === id)?.name ?? '?';
    lines.push(
      `${nameOf(view.nomination.nominatorSeatId)} → ${nameOf(view.nomination.nomineeSeatId)}`,
      `${view.nomination.yesCount} / ${view.nomination.threshold} votes`,
    );
  } else if (view.onBlockSeatId) {
    const seat = view.seats.find((s) => s.id === view.onBlockSeatId);
    lines.push(`${seat?.name ?? '?'} is on the block`);
  }
  if (view.phase === 'over') lines.push(`${view.winner} wins — ${view.endedReason ?? ''}`);

  lines.forEach((line, i) => {
    group.appendChild(textNode('text', { class: 'center-sub', x: CENTER, y: CENTER + 22 + i * 30 }, line));
  });
  return group;
}
