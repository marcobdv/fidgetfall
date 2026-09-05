/**
 * The browser client.
 *
 * State arrives over a WebSocket, already redacted by the server: this file can
 * only draw what the seat is allowed to see, because that is all it is sent.
 * Everything here is presentation — the rules live on the server.
 */

const $ = (id) => document.getElementById(id);

const SUIT_GLYPH = { s: "♠", h: "♥", d: "♦", c: "♣" };
const RED_SUITS = new Set(["h", "d"]);

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private browsing: the seat just will not survive a refresh */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const app = {
  tableId: null,
  token: null,
  state: null,
  socket: null,
  coach: null,
  coachFor: null,
  reviewedHand: 0,
  pane: "coach",
};

// --------------------------------------------------------------------- api --

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || `request failed (${response.status})`);
  return body;
}

let toastTimer = null;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 4200);
}

// ------------------------------------------------------------------ lobby --

async function loadBots() {
  const { bots } = await api("/api/bots");
  $("bot-picker").innerHTML = bots
    .map(
      (bot) => `
      <label class="bot-option">
        <input type="checkbox" value="${bot.id}" ${bot.id === "balanced" ? "checked" : ""} />
        <span><b>${escapeHtml(bot.label)}</b><small>${escapeHtml(bot.blurb)}</small></span>
      </label>`,
    )
    .join("");
}

async function refreshTables() {
  let tables;
  try {
    ({ tables } = await api("/api/tables"));
  } catch {
    return;
  }

  const list = $("table-list");
  if (tables.length === 0) {
    list.innerHTML = `<div class="empty">No tables yet. Start one on the right.</div>`;
    return;
  }

  list.innerHTML = tables
    .map((table) => {
      const live = table.street !== "idle";
      const seat = store.get(`seat:${table.id}`);
      return `
        <div class="table-row">
          <div style="flex:1;min-width:0">
            <div class="name">${escapeHtml(table.name)}
              <span class="tag ${live ? "live" : ""}">${live ? table.street : "waiting"}</span>
            </div>
            <div class="sub">
              ${table.smallBlind}/${table.bigBlind} &middot;
              ${table.seated}/${table.maxSeats} seated (${table.humans} human, ${table.agents} agent) &middot;
              buy-in ${table.minBuyIn}–${table.maxBuyIn} &middot; hand #${table.handNumber}
            </div>
          </div>
          <button data-join="${table.id}" ${table.openSeats === 0 && !seat ? "disabled" : ""}>
            ${seat ? "Rejoin" : table.openSeats === 0 ? "Full" : "Sit down"}
          </button>
          <button class="ghost" data-watch="${table.id}">Watch</button>
        </div>`;
    })
    .join("");
}

$("table-list").addEventListener("click", async (event) => {
  const join = event.target.closest("[data-join]");
  const watch = event.target.closest("[data-watch]");
  if (join) await sitDown(join.dataset.join);
  else if (watch) openTable(watch.dataset.watch, null);
});

$("create-btn").addEventListener("click", async () => {
  const bots = [...document.querySelectorAll("#bot-picker input:checked")].map((el) => el.value);
  const body = {
    name: $("f-table").value.trim() || undefined,
    smallBlind: Number($("f-sb").value),
    bigBlind: Number($("f-bb").value),
    maxSeats: Number($("f-seats").value),
    coaching: $("f-coach").checked,
    bots,
  };

  try {
    const { table } = await api("/api/tables", { method: "POST", body: JSON.stringify(body) });
    await sitDown(table.id);
  } catch (error) {
    toast(error.message);
  }
});

async function sitDown(tableId) {
  const existing = store.get(`seat:${tableId}`);
  if (existing) {
    openTable(tableId, existing);
    return;
  }

  const name = $("f-name").value.trim() || `Player ${Math.floor(Math.random() * 900 + 100)}`;
  const buyIn = Number($("f-buyin").value) || undefined;
  try {
    const { seating } = await api(`/api/tables/${tableId}/join`, {
      method: "POST",
      body: JSON.stringify({ name, kind: "human", buyIn }),
    });
    store.set(`seat:${tableId}`, seating.token);
    store.set("name", name);
    openTable(tableId, seating.token);
  } catch (error) {
    toast(error.message);
  }
}

// ------------------------------------------------------------------ table --

function openTable(tableId, token) {
  app.tableId = tableId;
  app.token = token;
  app.coach = null;
  app.coachFor = null;
  app.reviewedHand = 0;

  $("lobby").classList.add("hidden");
  $("table-view").classList.remove("hidden");
  $("leave-btn").classList.toggle("hidden", !token);
  location.hash = `#/t/${tableId}`;
  connect();
}

function backToLobby() {
  if (app.socket) {
    app.socket.onclose = null;
    app.socket.close();
    app.socket = null;
  }
  app.tableId = null;
  app.token = null;
  app.state = null;
  $("table-view").classList.add("hidden");
  $("lobby").classList.remove("hidden");
  $("leave-btn").classList.add("hidden");
  $("header-meta").textContent = "";
  location.hash = "";
  refreshTables();
}

$("leave-btn").addEventListener("click", async () => {
  if (!app.token) return backToLobby();
  const tableId = app.tableId;
  try {
    await api(`/api/tables/${tableId}/leave`, {
      method: "POST",
      body: JSON.stringify({ token: app.token }),
    });
  } catch {
    /* leaving is best-effort — the seat times out anyway */
  }
  store.remove(`seat:${tableId}`);
  backToLobby();
});

let reconnectDelay = 500;

function connect() {
  if (app.socket) {
    app.socket.onclose = null;
    app.socket.close();
  }
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const query = new URLSearchParams({ table: app.tableId });
  if (app.token) query.set("token", app.token);

  const socket = new WebSocket(`${scheme}://${location.host}/ws?${query}`);
  app.socket = socket;

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") render(message.state);
  };
  socket.onopen = () => {
    reconnectDelay = 500;
  };
  socket.onclose = (event) => {
    if (app.socket !== socket) return;
    if (event.code === 4004) {
      toast("That table has closed.");
      store.remove(`seat:${app.tableId}`);
      backToLobby();
      return;
    }
    // Back off, but keep trying: a dropped socket should not cost the seat.
    setTimeout(() => {
      if (app.tableId) connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  };
}

// ----------------------------------------------------------------- render --

function render(state) {
  const previous = app.state;
  app.state = state;

  $("header-meta").innerHTML =
    `<strong>${escapeHtml(state.name)}</strong> &middot; ${state.smallBlind}/${state.bigBlind}` +
    (state.handNumber ? ` &middot; hand #${state.handNumber}` : "");

  renderSeats(state);
  renderBoard(state);
  renderActions(state);
  renderLog(state);

  // The coach is recomputed once per decision point, not per frame.
  const key = `${state.handNumber}:${state.street}:${state.actingSeat}:${state.pot}`;
  if (state.coaching && state.legalActions && app.coachFor !== key) {
    app.coachFor = key;
    fetchCoach();
  } else if (!state.legalActions && !app.coach) {
    renderCoach(null);
  }

  // A finished hand is worth reviewing exactly once.
  const finished = state.street === "complete" && state.handNumber > 0;
  if (finished && app.token && app.reviewedHand !== state.handNumber) {
    app.reviewedHand = state.handNumber;
    fetchReview();
  }

  if (previous && previous.handNumber !== state.handNumber) app.coach = null;
}

function seatPositions(count) {
  // Seats sit on an ellipse, starting at the bottom (where the player sits) and
  // going clockwise, so seat order matches the direction the button moves.
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI / 2 + (i / count) * Math.PI * 2;
    return {
      left: 50 + 41 * Math.cos(angle),
      top: 50 + 40 * Math.sin(angle),
    };
  });
}

function renderSeats(state) {
  const felt = $("felt");
  [...felt.querySelectorAll(".seat")].forEach((el) => el.remove());

  // Rotate so the viewer's own seat is always at the bottom.
  const count = state.maxSeats;
  const positions = seatPositions(count);
  const offset = state.youSeat === null ? 0 : state.youSeat;

  state.seats.forEach((seat) => {
    const slot = (seat.seat - offset + count) % count;
    const pos = positions[slot];
    const el = document.createElement("div");
    el.className = "seat";
    if (seat.isActing) el.classList.add("acting");
    if (seat.seat === state.youSeat) el.classList.add("you");
    if (seat.status === "folded") el.classList.add("folded");
    el.style.left = `${pos.left}%`;
    el.style.top = `${pos.top}%`;

    if (!seat.playerId) {
      el.innerHTML = `<div class="empty-seat">Seat ${seat.seat + 1}<br />open</div>`;
      felt.appendChild(el);
      return;
    }

    const cards = seat.holeCards
      ? seat.holeCards.map((code) => cardHtml(code, "small")).join("")
      : "<div class='card-face small back'></div>".repeat(seat.hiddenCards);

    const role = [
      seat.kind === "agent" ? "agent" : "human",
      seat.sittingOut ? "sitting out" : "",
      seat.status === "all-in" ? "all in" : "",
    ]
      .filter(Boolean)
      .join(" · ");

    el.innerHTML = `
      <div class="cards">${cards}</div>
      <div class="plate" style="position:relative">
        ${seat.isButton ? '<div class="badge-btn">D</div>' : ""}
        <div class="who">${escapeHtml(seat.name)}</div>
        <div class="stack">${seat.stack.toLocaleString()}</div>
        <div class="role">${role}</div>
        ${seat.handDescription ? `<div class="made">${escapeHtml(seat.handDescription)}</div>` : ""}
        ${seat.isActing ? `<div class="timer" id="timer-${seat.seat}"></div>` : ""}
      </div>
      ${seat.committed > 0 ? `<div class="chip-bet">${seat.committed.toLocaleString()}</div>` : ""}`;

    felt.appendChild(el);
  });
}

function renderBoard(state) {
  $("board").innerHTML = state.board.map((code) => cardHtml(code)).join("");
  $("street-label").textContent =
    state.street === "idle" || state.street === "complete" ? (state.waitingFor ?? "") : state.street;
  $("pot").innerHTML = state.pot > 0 ? `Pot <strong>${state.pot.toLocaleString()}</strong>` : "";
}

function renderActions(state) {
  const bar = $("actions");
  const legal = state.legalActions;

  if (!app.token) {
    bar.innerHTML = `<div class="waiting">Watching. ${escapeHtml(state.waitingFor ?? "")}</div>
      <div class="spacer"></div>
      <button id="to-lobby" class="ghost">Back to lobby</button>`;
    $("to-lobby").onclick = backToLobby;
    return;
  }

  if (!legal) {
    const you = state.seats.find((s) => s.seat === state.youSeat);
    const note = you?.sittingOut
      ? "You are sitting out."
      : `Waiting — ${state.waitingFor ?? "…"}`;
    bar.innerHTML = `<div class="waiting">${escapeHtml(note)}</div>`;
    if (you?.sittingOut) {
      bar.innerHTML += `<div class="spacer"></div><button class="primary" id="sit-in">Sit back in</button>`;
      $("sit-in").onclick = () =>
        send(`/api/tables/${app.tableId}/sitout`, { token: app.token, sittingOut: false });
    }
    return;
  }

  const canAggress = legal.canBet || legal.canRaise;
  const min = legal.canBet ? legal.minBet : legal.minRaiseTo;
  const max = legal.canBet ? legal.maxBet : legal.maxRaiseTo;
  const verb = legal.canBet ? "Bet" : "Raise to";

  bar.innerHTML = `
    <button id="a-fold" class="danger">Fold</button>
    ${legal.canCheck ? `<button id="a-check">Check</button>` : ""}
    ${legal.canCall ? `<button id="a-call" class="primary">Call ${legal.toCall.toLocaleString()}</button>` : ""}
    ${
      canAggress
        ? `<div class="bet-controls">
             <input type="range" id="a-slider" min="${min}" max="${max}" value="${min}" step="1" />
             <input type="number" id="a-amount" class="amount" min="${min}" max="${max}" value="${min}" />
             <button id="a-raise" class="primary">${verb}</button>
           </div>
           <div class="quick">
             <button data-frac="0.5">½ pot</button>
             <button data-frac="0.75">¾ pot</button>
             <button data-frac="1">Pot</button>
             <button data-frac="max">All in</button>
           </div>`
        : ""
    }`;

  $("a-fold").onclick = () => act("fold");
  if (legal.canCheck) $("a-check").onclick = () => act("check");
  if (legal.canCall) $("a-call").onclick = () => act("call");

  if (canAggress) {
    const slider = $("a-slider");
    const amount = $("a-amount");
    const sync = (value) => {
      const clamped = Math.max(min, Math.min(max, Math.round(Number(value) || min)));
      slider.value = clamped;
      amount.value = clamped;
    };
    slider.oninput = () => sync(slider.value);
    amount.oninput = () => sync(amount.value);
    $("a-raise").onclick = () => act(legal.canBet ? "bet" : "raise", Number(amount.value));

    for (const button of bar.querySelectorAll("[data-frac]")) {
      button.onclick = () => {
        const frac = button.dataset.frac;
        if (frac === "max") return sync(max);
        // A "pot-sized" raise means calling first, then betting the pot that makes.
        const potAfterCall = state.pot + legal.toCall;
        sync(legal.toCall + Math.round(potAfterCall * Number(frac)) + (legal.canBet ? 0 : legal.toCall));
      };
    }
  }
}

async function act(action, amount) {
  const body = { token: app.token, action };
  if (amount !== undefined) body.amount = amount;
  app.coach = null;
  app.coachFor = null;
  try {
    await api(`/api/tables/${app.tableId}/act`, { method: "POST", body: JSON.stringify(body) });
  } catch (error) {
    toast(error.message);
  }
}

async function send(path, body) {
  try {
    await api(path, { method: "POST", body: JSON.stringify(body) });
  } catch (error) {
    toast(error.message);
  }
}

function renderLog(state) {
  $("pane-log").innerHTML = state.log
    .slice()
    .reverse()
    .map((line) => `<div class="log-line">${escapeHtml(line)}</div>`)
    .join("");
}

// ------------------------------------------------------------------ coach --

async function fetchCoach() {
  if (!app.token) return;
  try {
    const { advice } = await api(
      `/api/tables/${app.tableId}/coach?token=${encodeURIComponent(app.token)}`,
    );
    app.coach = advice;
    renderCoach(advice);
  } catch {
    /* the spot moved on before the coach answered */
  }
}

function renderCoach(advice) {
  const pane = $("pane-coach");
  if (!advice) {
    pane.innerHTML = `<div class="empty">The coach speaks up when it is your turn.</div>`;
    return;
  }

  const equity = Math.round(advice.equity.equity * 100);
  const breakEven = advice.potOdds ? Math.round(advice.potOdds.breakEven * 100) : null;
  const short = breakEven !== null && equity < breakEven;

  pane.innerHTML = `
    <div class="headline">
      <div class="made">${escapeHtml(advice.handDescription)}</div>
      <div class="numbers">
        <div>
          <span>Your equity</span><b>${equity}%</b>
          <div class="meter"><i style="width:${equity}%"></i></div>
        </div>
        ${
          breakEven !== null
            ? `<div><span>Price to call</span><b>${breakEven}%</b>
                 <div class="meter"><i class="${short ? "short" : ""}" style="width:${breakEven}%"></i></div>
               </div>`
            : `<div><span>Outs</span><b>${advice.outs.count || "—"}</b></div>`
        }
      </div>
      <div class="suggest">Suggested: <b>${escapeHtml(advice.suggestion)}</b>
        <span style="color:var(--ink-faint)">(${advice.confidence} confidence)</span></div>
    </div>
    ${advice.tips
      .map(
        (tip) => `<div class="tip">
          <div class="label">${escapeHtml(tip.label)}</div>
          <div class="text">${escapeHtml(tip.text)}</div>
        </div>`,
      )
      .join("")}
    <div class="disclaimer">
      Equity is measured against random hands, so it flatters marginal holdings — real opponents
      fold their worst cards. Treat the suggestion as arithmetic, not as an instruction.
    </div>`;
}

async function fetchReview() {
  try {
    const { review } = await api(
      `/api/tables/${app.tableId}/review?token=${encodeURIComponent(app.token)}`,
    );
    renderReview(review);
    if (review && review.moments.length > 0) flashTab("review");
  } catch {
    /* no review available for this hand */
  }
}

function renderReview(review) {
  const pane = $("pane-review");
  if (!review) {
    pane.innerHTML = `<div class="empty">Play a hand and it will be broken down here.</div>`;
    return;
  }

  const net = review.net;
  pane.innerHTML = `
    <div class="headline">
      <div class="made">Hand #${review.handNumber} &middot;
        <span style="color:${net >= 0 ? "var(--good)" : "var(--bad)"}">
          ${net >= 0 ? "+" : ""}${net.toLocaleString()}
        </span>
      </div>
      <div style="margin-top:6px;display:flex;gap:4px">
        ${review.holeCards.map((c) => cardHtml(c, "small")).join("")}
        <div style="width:10px"></div>
        ${review.board.map((c) => cardHtml(c, "small dim")).join("")}
      </div>
      <div class="suggest" style="color:#cddae6">${escapeHtml(review.summary)}</div>
    </div>
    ${
      review.moments.length === 0
        ? `<div class="empty">You were never put to a decision.</div>`
        : review.moments
            .map(
              (moment) => `
      <div class="moment ${moment.verdict}">
        <div class="head">
          ${moment.street} &middot; ${moment.action}
          ${moment.toCall > 0 ? `&middot; to call ${moment.toCall}` : ""}
          &middot; equity ${Math.round(moment.equityPct)}%
          ${moment.breakEvenPct !== null ? `vs price ${Math.round(moment.breakEvenPct)}%` : ""}
        </div>
        <div class="note">${escapeHtml(moment.note)}</div>
      </div>`,
            )
            .join("")
    }`;
}

// ------------------------------------------------------------------- tabs --

for (const button of document.querySelectorAll(".tabs button")) {
  button.onclick = () => selectPane(button.dataset.pane);
}

function selectPane(pane) {
  app.pane = pane;
  for (const button of document.querySelectorAll(".tabs button")) {
    button.classList.toggle("on", button.dataset.pane === pane);
  }
  for (const el of document.querySelectorAll(".pane")) {
    el.classList.toggle("on", el.id === `pane-${pane}`);
  }
}

function flashTab(pane) {
  if (app.pane === "coach") selectPane(pane);
}

// ----------------------------------------------------------------- helpers --

function cardHtml(code, extra = "") {
  const rank = code[0];
  const suit = code[1];
  const red = RED_SUITS.has(suit) ? "red" : "";
  return `<div class="card-face ${extra} ${red}">
    <div class="rank">${rank}</div><div class="suit">${SUIT_GLYPH[suit] ?? suit}</div>
  </div>`;
}

function escapeHtml(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

// -------------------------------------------------------------------- boot --

function boot() {
  $("f-name").value = store.get("name") ?? "";
  $("mcp-url").value = `${location.origin}/mcp`;
  $("mcp-stdio").value = `node dist/mcp/stdio.js ${location.origin}`;

  loadBots().catch(() => toast("Could not load the bot list."));
  refreshTables();
  setInterval(() => {
    if (!app.tableId) refreshTables();
  }, 3000);

  // Deep link straight into a table: #/t/<id>
  const match = /^#\/t\/([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (match) {
    const tableId = match[1];
    openTable(tableId, store.get(`seat:${tableId}`));
  }

  // Redraw the action timer smoothly between state pushes.
  setInterval(() => {
    const state = app.state;
    if (!state || state.actionDeadline === null || state.actingSeat === null) return;
    const bar = document.getElementById(`timer-${state.actingSeat}`);
    if (!bar) return;
    const left = state.actionDeadline - Date.now();
    const total = state.actionTimeoutMs || 45000;
    bar.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
  }, 250);
}

boot();
