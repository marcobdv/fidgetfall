import { api, connect } from './net.js';
import { renderTown } from './town.js';
import {
  channelFor,
  channelsFor,
  commandForChannel,
  placeholderFor,
  renderChannels,
  renderLog,
} from './side.js';
import { openSeatMenu, renderActionBar, renderStorytellerBar } from './menu.js';
import { showOverlay } from './overlay.js';

const STORAGE_KEY = 'botc.session';

const state = {
  token: null,
  view: null,
  events: [],
  channel: 'town',
  selected: null,
  menuAt: null,
  unread: {},
  showGrimoire: true,
  socket: null,
  // Server-sent seconds plus the moment we got them, so the clock ticks smoothly
  // between state pushes instead of jumping once a second.
  clock: null,
};

const $ = (id) => document.getElementById(id);
const dom = {
  lobby: $('lobby'),
  lobbyError: $('lobby-error'),
  app: $('app'),
  joinForm: $('join-form'),
  createForm: $('create-form'),
  scriptSelect: $('script-select'),
  scriptHint: $('script-hint'),
  openGames: $('open-games'),
  townName: $('town-name'),
  townScript: $('town-script'),
  phaseBadge: $('phase-badge'),
  townStats: $('town-stats'),
  square: $('town-square'),
  actionbar: $('actionbar'),
  channels: $('channels'),
  log: $('log'),
  sayForm: $('say-form'),
  sayInput: $('say-input'),
  stBar: $('st-bar'),
  grimoireToggle: $('grimoire-toggle'),
  clock: $('clock'),
  seatMenu: $('seat-menu'),
  leave: $('leave'),
  briefing: $('briefing'),
  chronicle: $('chronicle'),
};

// ------------------------------------------------------------------ lobby

for (const tab of document.querySelectorAll('[data-lobby-tab]')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[data-lobby-tab]')) other.classList.remove('is-active');
    tab.classList.add('is-active');
    const wanted = tab.dataset.lobbyTab;
    dom.joinForm.hidden = wanted !== 'join';
    dom.createForm.hidden = wanted !== 'create';
  });
}

async function loadLobby() {
  try {
    const { scripts } = await api('/api/scripts');
    dom.scriptSelect.replaceChildren();
    for (const script of scripts) {
      const option = new Option(`${script.name} (${script.characters})`, script.id);
      option.dataset.hint = script.hasAbilityText
        ? (script.description ?? 'Ability text included.')
        : 'No ability text on this server — the Storyteller rules on abilities.';
      dom.scriptSelect.appendChild(option);
    }
    const showHint = () => {
      dom.scriptHint.textContent = dom.scriptSelect.selectedOptions[0]?.dataset.hint ?? '';
    };
    dom.scriptSelect.addEventListener('change', showHint);
    showHint();

    const { games } = await api('/api/games');
    dom.openGames.replaceChildren();
    for (const game of games.filter((g) => g.phase !== 'over')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${game.name} — ${game.players} seated, ${game.phase} (${game.joinCode})`;
      button.addEventListener('click', () => {
        dom.joinForm.elements.code.value = game.joinCode;
      });
      dom.openGames.appendChild(button);
    }
  } catch (error) {
    showLobbyError(error.message);
  }
}

function showLobbyError(message) {
  dom.lobbyError.hidden = !message;
  dom.lobbyError.textContent = message ?? '';
}

dom.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showLobbyError(null);
  const form = new FormData(dom.joinForm);
  try {
    const result = await api(`/api/games/${encodeURIComponent(String(form.get('code')).toUpperCase())}/join`, {
      method: 'POST',
      body: { name: form.get('name'), kind: 'human' },
    });
    startSession(result.token);
  } catch (error) {
    showLobbyError(error.message);
  }
});

dom.createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showLobbyError(null);
  const form = new FormData(dom.createForm);
  try {
    const result = await api('/api/games', {
      method: 'POST',
      body: {
        name: form.get('name') || undefined,
        scriptId: form.get('scriptId'),
        storytellerName: form.get('storytellerName'),
      },
    });
    startSession(result.token);
  } catch (error) {
    showLobbyError(error.message);
  }
});

// ------------------------------------------------------------------ session

function startSession(token) {
  state.token = token;
  localStorage.setItem(STORAGE_KEY, token);
  dom.lobby.hidden = true;
  dom.app.hidden = false;
  state.socket = connect(token, {
    state: onState,
    events: onEvents,
    error: (message) => console.warn('[botc]', message),
    status: (status) => document.body.dataset.connection = status,
  });
}

function send(command) {
  return state.socket.send(command).then((reply) => {
    if (reply.type === 'error') flash(reply.error);
    return reply;
  });
}

function flash(message) {
  state.events.push({
    seq: `!`,
    type: 'system.notice',
    data: { text: message },
    text: `⚠ ${message}`,
  });
  render();
}

let endShown = false;

function onState(view) {
  const wasOver = state.view?.phase === 'over';
  state.view = view;
  if (view.phase === 'over' && !wasOver && !endShown) {
    endShown = true;
    showDocument('The chronicle', '/api/recap');
  }
  if (view.you?.isStoryteller) {
    dom.grimoireToggle.hidden = false;
    dom.grimoireToggle.classList.toggle('primary', state.showGrimoire);
  }
  render();
}

function onEvents(events) {
  for (const event of events) {
    state.events.push(event);
    const channel = channelFor(event, state.view ?? { seats: [], you: null });
    if (channel !== state.channel) state.unread[channel] = (state.unread[channel] ?? 0) + 1;
  }
  render();
}

// ------------------------------------------------------------------ render

function render() {
  const view = state.view;
  if (!view) return;

  dom.townName.textContent = view.name;
  dom.townScript.textContent = `${view.script.name}${view.joinCode ? ` · join code ${view.joinCode}` : ''}`;
  dom.phaseBadge.textContent = view.phase === 'lobby' ? 'lobby' : `${view.phase} · day ${view.day}`;
  dom.phaseBadge.dataset.phase = view.phase;

  const seconds = view.nomination?.open ? view.nomination.secondsLeft : view.secondsLeft;
  const label = view.nomination?.open
    ? view.nomination.state === 'defence'
      ? 'defence'
      : 'vote'
    : view.phase;
  state.clock =
    seconds === undefined || seconds === null ? null : { seconds, at: Date.now(), label };
  renderClock();

  const you = view.you;
  const parts = [`${view.aliveCount}/${view.seats.length} alive`];
  if (you && !you.isStoryteller) {
    parts.push(you.alive ? 'you are alive' : you.ghostVote ? 'dead — ghost vote unspent' : 'dead — no vote left');
    if (you.character) parts.push(`you are the ${you.character.name}`);
  }
  dom.townStats.textContent = parts.join(' · ');

  const showGrimoire = Boolean(you?.isStoryteller) && state.showGrimoire;
  renderTown(dom.square, view, {
    selected: state.selected,
    showGrimoire,
    onSeatClick: (seat, position) => {
      state.selected = seat.id;
      state.menuAt = position;
      render();
    },
  });

  // The menu is rendered from state, so writing a note refreshes it in place.
  const menuSeat = view.seats.find((s) => s.id === state.selected);
  if (menuSeat && state.menuAt) {
    openSeatMenu(dom.seatMenu, {
      seat: menuSeat,
      view,
      send,
      close: closeMenu,
      openChannel: (channel) => selectChannel(channel),
    });
    placeMenu(state.menuAt);
  } else {
    dom.seatMenu.hidden = true;
  }

  renderActionBar(dom.actionbar, { view, send });
  if (you?.isStoryteller) {
    dom.stBar.hidden = false;
    renderStorytellerBar(dom.stBar, { view, send });
  }

  const used = new Set(state.events.map((event) => channelFor(event, view)));
  const channels = channelsFor(view, used);
  if (!channels.includes(state.channel)) state.channel = 'town';
  renderChannels(dom.channels, {
    view,
    channels,
    active: state.channel,
    unread: state.unread,
    onSelect: selectChannel,
  });
  renderLog(dom.log, state.events, view, state.channel);
  dom.sayInput.placeholder = placeholderFor(state.channel, view);
  dom.sayInput.disabled = state.channel === 'grimoire';
}

function closeMenu() {
  dom.seatMenu.hidden = true;
  state.selected = null;
  state.menuAt = null;
  render();
}

function renderClock() {
  if (!state.clock) {
    dom.clock.hidden = true;
    return;
  }
  const left = Math.max(0, state.clock.seconds - Math.floor((Date.now() - state.clock.at) / 1000));
  const minutes = Math.floor(left / 60);
  dom.clock.hidden = false;
  dom.clock.textContent = `${state.clock.label} ${minutes}:${String(left % 60).padStart(2, '0')}`;
  dom.clock.classList.toggle('urgent', left <= 15);
}

setInterval(renderClock, 1000);

function selectChannel(channel) {
  state.channel = channel;
  state.unread[channel] = 0;
  state.selected = null;
  state.menuAt = null;
  render();
  dom.sayInput.focus();
}

function placeMenu(position) {
  const box = dom.square.getBoundingClientRect();
  const scale = box.width / 1000;
  dom.seatMenu.style.left = `${Math.min(box.left + position.x * scale, window.innerWidth - 220)}px`;
  dom.seatMenu.style.top = `${Math.min(box.top + position.y * scale, window.innerHeight - 260)}px`;
}

dom.sayForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = dom.sayInput.value.trim();
  if (!text) return;
  const command = commandForChannel(state.channel, text);
  if (!command) return;
  dom.sayInput.value = '';
  await send(command);
});

dom.grimoireToggle.addEventListener('click', () => {
  state.showGrimoire = !state.showGrimoire;
  dom.grimoireToggle.classList.toggle('primary', state.showGrimoire);
  render();
});

dom.leave.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  state.socket?.close();
  location.reload();
});

document.addEventListener('click', (event) => {
  if (!dom.seatMenu.hidden && !dom.seatMenu.contains(event.target) && !event.target.closest('.token')) {
    closeMenu();
  }
});

async function showDocument(title, path) {
  showOverlay(title, '', { loading: true });
  try {
    const { text } = await api(`${path}?token=${encodeURIComponent(state.token)}`);
    showOverlay(title, text);
  } catch (error) {
    showOverlay(title, `Could not load it: ${error.message}`);
  }
}

dom.briefing.addEventListener('click', () => showDocument('Your seat', '/api/briefing'));
dom.chronicle.addEventListener('click', () => showDocument('The chronicle', '/api/recap'));

// ------------------------------------------------------------------ boot

const params = new URLSearchParams(location.search);
if (params.get('code')) dom.joinForm.elements.code.value = params.get('code').toUpperCase();

const saved = localStorage.getItem(STORAGE_KEY);
if (saved) {
  api(`/api/state?token=${encodeURIComponent(saved)}`)
    .then(() => startSession(saved))
    .catch(() => {
      localStorage.removeItem(STORAGE_KEY);
      loadLobby();
    });
} else {
  loadLobby();
}
