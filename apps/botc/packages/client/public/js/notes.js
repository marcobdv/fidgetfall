/** The private notepad: your own read on another player. */

const TEAMS = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller'];
const CONFIDENCE = ['maybe', 'likely', 'certain'];

/** A one-line summary for the token label on the square. */
export function noteSummary(note) {
  if (!note) return '';
  const parts = [];
  if (note.characters?.length) parts.push(note.characters.join('/'));
  else if (note.teams?.length) parts.push(note.teams.join('/'));
  else if (note.alignment && note.alignment !== 'unknown') parts.push(note.alignment);
  if (note.confidence === 'maybe') parts.push('?');
  return parts.join(' ');
}

/** The ring colour your guess paints on their token. */
export function noteTint(note) {
  if (!note) return null;
  if (note.alignment === 'evil') return 'evil';
  if (note.alignment === 'good') return 'good';
  if (note.teams?.some((t) => t === 'minion' || t === 'demon')) return 'evil';
  if (note.teams?.length) return 'good';
  return note.alignment === 'unknown' ? 'unknown' : null;
}

/**
 * Builds the editor. Every change writes straight through — there is no save
 * button, because losing a read you just typed is worse than an extra command.
 */
export function buildNoteEditor(seat, view, send) {
  const note = seat.note ?? { alignment: null, teams: [], characters: [], confidence: null, text: '' };
  const wrap = document.createElement('div');
  wrap.className = 'note-editor';

  const write = (patch) => send({ type: 'note_set', target: seat.id, ...patch });

  const heading = document.createElement('div');
  heading.className = 'note-heading';
  heading.textContent = 'Your read';
  wrap.appendChild(heading);

  // Alignment
  const alignment = document.createElement('div');
  alignment.className = 'note-row';
  for (const [value, label] of [['good', 'Good'], ['evil', 'Evil'], ['unknown', '?']]) {
    const button = document.createElement('button');
    button.textContent = label;
    button.className = `chip align-${value}`;
    if (note.alignment === value) button.classList.add('is-on');
    button.addEventListener('click', () => write({ alignment: note.alignment === value ? null : value }));
    alignment.appendChild(button);
  }
  wrap.appendChild(alignment);

  // Teams — several at once, which is the whole point.
  const teams = document.createElement('div');
  teams.className = 'note-row';
  for (const team of TEAMS) {
    const button = document.createElement('button');
    button.textContent = team;
    button.className = 'chip';
    const on = note.teams?.includes(team);
    if (on) button.classList.add('is-on');
    button.addEventListener('click', () => {
      const next = on ? note.teams.filter((t) => t !== team) : [...(note.teams ?? []), team];
      write({ teams: next });
    });
    teams.appendChild(button);
  }
  wrap.appendChild(teams);

  // Confidence
  const confidence = document.createElement('div');
  confidence.className = 'note-row';
  for (const level of CONFIDENCE) {
    const button = document.createElement('button');
    button.textContent = level;
    button.className = 'chip';
    if (note.confidence === level) button.classList.add('is-on');
    button.addEventListener('click', () => write({ confidence: note.confidence === level ? null : level }));
    confidence.appendChild(button);
  }
  wrap.appendChild(confidence);

  // Suspected character
  const select = document.createElement('select');
  select.className = 'note-character';
  select.appendChild(new Option('suspect a character…', ''));
  for (const character of view.script.characters) {
    select.appendChild(new Option(`${character.name} (${character.team})`, character.id));
  }
  select.value = note.characters?.[0] ?? '';
  select.addEventListener('change', () => write({ characters: select.value ? [select.value] : [] }));
  wrap.appendChild(select);

  if (note.characters?.length > 1) {
    const extra = document.createElement('div');
    extra.className = 'note-extra';
    extra.textContent = `also: ${note.characters.slice(1).join(', ')}`;
    wrap.appendChild(extra);
  }

  // Why
  const text = document.createElement('input');
  text.placeholder = 'why you think so';
  text.maxLength = 500;
  text.value = note.text ?? '';
  text.addEventListener('change', () => write({ text: text.value }));
  wrap.appendChild(text);

  if (seat.note) {
    const clear = document.createElement('button');
    clear.className = 'chip';
    clear.textContent = 'Clear this note';
    clear.addEventListener('click', () => send({ type: 'note_clear', target: seat.id }));
    wrap.appendChild(clear);
  }

  return wrap;
}
