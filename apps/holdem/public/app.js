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
  // The live quiz standing between the player and the coach's answers.
  quiz: null,
  quizKey: null,
  marking: null,
  // The standalone practice drill.
  practice: null,
};

/** Running tally of drill answers, kept across sessions. */
const tally = {
  read() {
    try {
      return JSON.parse(store.get("drill-tally") || "") || { right: 0, asked: 0 };
    } catch {
      return { right: 0, asked: 0 };
    }
  },
  add(score) {
    const now = this.read();
    const next = { right: now.right + score.right, asked: now.asked + score.asked };
    store.set("drill-tally", JSON.stringify(next));
    return next;
  },
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
  else if (watch) await openTable(watch.dataset.watch, null);
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
    await openTable(tableId, existing);
    // openTable clears a token the server no longer honours; if it did, fall
    // through and buy in again rather than leaving the player merely watching.
    if (app.token) return;
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
    await openTable(tableId, seating.token);
  } catch (error) {
    toast(error.message);
  }
}

// ------------------------------------------------------------------ table --

async function openTable(tableId, token) {
  // A stored token can outlive the table it belonged to — the server keeps
  // tables in memory. Check it before claiming a seat we no longer have.
  if (token) {
    try {
      await api(`/api/tables/${tableId}?token=${encodeURIComponent(token)}`);
    } catch {
      store.remove(`seat:${tableId}`);
      token = null;
    }
  }

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

  // One quiz per decision point, not per frame. The coach's answers arrive only
  // once the player has committed to their own.
  const key = `${state.handNumber}:${state.street}:${state.actingSeat}:${state.pot}`;
  if (state.coaching && state.legalActions && app.coachFor !== key) {
    app.coachFor = key;
    app.coach = null;
    app.marking = null;
    drill.reset();
    fetchQuiz();
  } else if (!state.legalActions && !app.coach && !app.quiz) {
    renderCoachPane();
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

// ------------------------------------------------------------------ drill --

/**
 * The counting drill, shared by the live coach panel and the practice screen.
 *
 * It renders the questions, collects an attempt, and renders the marking. The
 * answers are not in the page until the server sends the marking back, so there
 * is nothing to read ahead — which is the point of asking first.
 */
const drill = {
  /** Cards the player has clicked as outs, for the current spot. */
  picked: new Set(),

  reset() {
    this.picked = new Set();
  },

  /** The spot itself: your two cards, the board, and the price. */
  spotHtml(spot) {
    return `
      <div class="spot">
        <span class="label">Your hand &middot; the board</span>
        ${spot.hole.map((c) => cardHtml(c, "small")).join("")}
        <span class="sep"></span>
        ${spot.board.map((c) => cardHtml(c, "small")).join("")}
        ${
          spot.toCall > 0
            ? `<span class="price">to call<b>${spot.toCall}</b>into a pot of ${spot.pot}</span>`
            : `<span class="price">pot<b>${spot.pot}</b>no bet to face</span>`
        }
      </div>`;
  },

  /** The questions, as inputs. Nothing here reveals an answer. */
  questionsHtml(spot) {
    const rows = [];

    if (spot.asks.outs) {
      rows.push(`
        <div class="q">
          <div class="prompt">How many outs do you have?</div>
          <div class="sub">Cards still to come that would lift you to a better hand.
            You hold ${escapeHtml(spot.handNow)} right now.</div>
          <div class="entry">
            <input type="number" id="d-outs" min="0" max="47" placeholder="?" />
            <span class="unit">outs</span>
            <button class="ghost" id="d-pick-toggle">Pick the cards</button>
          </div>
          <div id="d-deck" class="hidden"></div>
        </div>`);
    }

    if (spot.asks.ruleOfThumb) {
      rows.push(`
        <div class="q">
          <div class="prompt">Roughly what are your chances of getting there?</div>
          <div class="sub">The rule of two and four, with ${spot.cardsToCome}
            card${spot.cardsToCome === 1 ? "" : "s"} to come.</div>
          <div class="entry">
            <input type="number" id="d-rule" min="0" max="100" placeholder="?" />
            <span class="unit">%</span>
          </div>
        </div>`);
    }

    if (spot.asks.potOdds) {
      rows.push(`
        <div class="q">
          <div class="prompt">What share of the time must you win to break even?</div>
          <div class="sub">Calling ${spot.toCall} into a pot of ${spot.pot}.</div>
          <div class="entry">
            <input type="number" id="d-odds" min="0" max="100" placeholder="?" />
            <span class="unit">%</span>
          </div>
        </div>`);
    }

    return rows.join("");
  },

  /** Wires the card grid, which opens on demand and stays open once marked. */
  bindDeck(spot, marked) {
    const toggle = $("d-pick-toggle");
    const deck = $("d-deck");
    if (!deck) return;

    const render = () => {
      deck.innerHTML =
        `<div class="deck">` +
        spot.unseen
          .map((code) => {
            const classes = ["pick"];
            if (RED_SUITS.has(code[1])) classes.push("red");
            if (marked) {
              const missed = marked.missed.some((m) => m.card === code);
              const wrong = marked.wrong.some((w) => w.card === code);
              if (missed) classes.push("miss");
              else if (wrong) classes.push("bad");
              else if (this.picked.has(code)) classes.push("hit");
            } else if (this.picked.has(code)) {
              classes.push("on");
            }
            return `<button class="${classes.join(" ")}" data-card="${code}" ${
              marked ? "disabled" : ""
            }>${code[0]}${SUIT_GLYPH[code[1]] ?? code[1]}</button>`;
          })
          .join("") +
        `</div>` +
        (marked
          ? `<div class="legend">
               <span class="hit">correctly counted</span>
               <span class="miss">an out you missed</span>
               <span class="bad">not an out</span>
             </div>`
          : `<div class="legend"><span>click every card you think is an out</span></div>`);

      if (marked) return;
      for (const button of deck.querySelectorAll("[data-card]")) {
        button.onclick = () => {
          // Toggle in place rather than redrawing the grid: rebuilding 47
          // buttons on every click flickers and throws away focus.
          const code = button.dataset.card;
          if (this.picked.has(code)) this.picked.delete(code);
          else this.picked.add(code);
          button.classList.toggle("on", this.picked.has(code));

          // Keep the count in step with the picks — that is the point of picking.
          const outsInput = $("d-outs");
          if (outsInput) outsInput.value = String(this.picked.size);
        };
      }
    };

    if (marked) {
      deck.classList.remove("hidden");
      render();
      return;
    }

    if (toggle) {
      toggle.onclick = () => {
        deck.classList.toggle("hidden");
        toggle.textContent = deck.classList.contains("hidden") ? "Pick the cards" : "Hide the cards";
        if (!deck.classList.contains("hidden")) render();
      };
    }
  },

  /** Reads the attempt out of the form. */
  attempt() {
    const value = (id) => {
      const el = $(id);
      if (!el || el.value === "") return undefined;
      return Number(el.value);
    };
    return {
      outs: value("d-outs"),
      ruleOfThumbPct: value("d-rule"),
      breakEvenPct: value("d-odds"),
      outCards: this.picked.size > 0 ? [...this.picked] : undefined,
    };
  },

  /** The marking, rendered under each question it answers. */
  markingHtml(marking) {
    const parts = [];
    const row = (mark, extra = "") => `
      <div class="mark ${mark.right ? "right" : "wrong"}">
        ${mark.yours === null ? "You skipped this. " : ""}${escapeHtml(mark.note)}${extra}
      </div>`;

    if (marking.outs) {
      const groups = marking.outs.groups.length
        ? `<div class="groups">${marking.outs.groups
            .map(
              (g) => `<div class="group-row"><b>${g.cards.length} to a ${escapeHtml(
                g.makes.toLowerCase(),
              )}</b>${g.cards.map((c) => cardHtml(c, "small")).join("")}</div>`,
            )
            .join("")}</div>`
        : "";
      const why = marking.outs.wrong.length
        ? `<ul class="why-list">${marking.outs.wrong
            .slice(0, 6)
            .map((w) => `<li><b>${w.card}</b> — ${escapeHtml(w.why)}</li>`)
            .join("")}</ul>`
        : "";
      parts.push({ id: "d-outs", mark: marking.outs, html: row(marking.outs, groups + why) });
    }
    if (marking.ruleOfThumb) {
      parts.push({ id: "d-rule", mark: marking.ruleOfThumb, html: row(marking.ruleOfThumb) });
    }
    if (marking.potOdds) {
      parts.push({ id: "d-odds", mark: marking.potOdds, html: row(marking.potOdds) });
    }
    return parts;
  },

  /** Places each marking under its question and locks the inputs. */
  showMarking(marking) {
    for (const part of this.markingHtml(marking)) {
      const input = $(part.id);
      if (!input) continue;
      // Put the player's own answer back in the box: "14, not 6" only lands if
      // the 6 they typed is still in front of them.
      if (part.mark.yours !== null) input.value = String(part.mark.yours);
      input.disabled = true;
      const question = input.closest(".q");
      if (question && !question.querySelector(".mark")) {
        question.insertAdjacentHTML("beforeend", part.html);
      }
    }
    const toggle = $("d-pick-toggle");
    if (toggle) toggle.remove();
  },
};

// ------------------------------------------------------------------ coach --

async function fetchQuiz() {
  if (!app.token) return;
  try {
    const { quiz } = await api(
      `/api/tables/${app.tableId}/quiz?token=${encodeURIComponent(app.token)}`,
    );
    app.quiz = quiz ? quiz.spot : null;
    app.quizKey = quiz ? quiz.key : null;

    // Nothing countable here (preflop, or a checked-down river) — there is no
    // question worth asking, so the coach speaks up as it always did.
    if (!app.quiz) return fetchCoach();
    renderCoachPane();
  } catch {
    /* the spot moved on before the question could be posed */
  }
}

async function fetchCoach() {
  if (!app.token) return;
  try {
    const { advice } = await api(
      `/api/tables/${app.tableId}/coach?token=${encodeURIComponent(app.token)}`,
    );
    app.coach = advice;
    renderCoachPane();
  } catch {
    /* the spot moved on before the coach answered */
  }
}

/** Submits the attempt; the marking comes back with the coaching attached. */
async function submitQuiz() {
  const button = $("d-check");
  if (button) button.disabled = true;
  try {
    const result = await api(`/api/tables/${app.tableId}/quiz`, {
      method: "POST",
      body: JSON.stringify({ token: app.token, key: app.quizKey, ...drill.attempt() }),
    });
    if (result.stale) {
      toast("That spot has moved on — the table did not wait.");
      app.quiz = null;
      return fetchCoach();
    }
    app.marking = result.marking;
    app.coach = result.advice;
    tally.add(result.marking.score);
    renderCoachPane();
  } catch (error) {
    toast(error.message);
    if (button) button.disabled = false;
  }
}

/** Draws whichever stage the coach panel is at: question, marking, or answer. */
function renderCoachPane() {
  const pane = $("pane-coach");

  if (app.quiz && !app.marking) {
    const record = tally.read();
    pane.innerHTML =
      drill.spotHtml(app.quiz) +
      drill.questionsHtml(app.quiz) +
      `<div class="drill-actions">
         <button class="primary" id="d-check">Check my answers</button>
       </div>
       <div class="disclaimer">
         Answer to see the coach's read on this spot.
         ${record.asked ? `You have ${record.right} of ${record.asked} right so far.` : ""}
       </div>`;
    drill.bindDeck(app.quiz, null);
    $("d-check").onclick = submitQuiz;
    return;
  }

  if (app.quiz && app.marking) {
    const record = tally.read();
    pane.innerHTML =
      drill.spotHtml(app.quiz) +
      drill.questionsHtml(app.quiz) +
      `<div class="disclaimer streak">
         <b>${app.marking.score.right}/${app.marking.score.asked}</b> this spot &middot;
         ${record.right} of ${record.asked} all told
       </div>
       <div id="coach-answer"></div>`;
    drill.bindDeck(app.quiz, app.marking.outs ?? { missed: [], wrong: [] });
    drill.showMarking(app.marking);
    if (app.coach) $("coach-answer").innerHTML = adviceHtml(app.coach);
    return;
  }

  renderCoach(app.coach);
}

function renderCoach(advice) {
  const pane = $("pane-coach");
  if (!advice) {
    pane.innerHTML = `<div class="empty">The coach speaks up when it is your turn.</div>`;
    return;
  }
  pane.innerHTML = adviceHtml(advice);
}

/** The coach's full read, once it has been earned. */
function adviceHtml(advice) {

  const equity = Math.round(advice.equity.equity * 100);
  // The bar the suggestion actually used: the raw price plus whatever margin the
  // size of the bet demands. Showing the raw price alone would not match the advice.
  const breakEven = advice.potOdds
    ? Math.round((advice.potOdds.breakEven + advice.pressure.margin) * 100)
    : null;
  const rawPrice = advice.potOdds ? Math.round(advice.potOdds.breakEven * 100) : null;
  const short = breakEven !== null && equity < breakEven;

  return `
    <div class="headline">
      <div class="made">${escapeHtml(advice.handDescription)}</div>
      <div class="numbers">
        <div>
          <span>Your equity</span><b>${equity}%</b>
          <div class="meter"><i style="width:${equity}%"></i></div>
        </div>
        ${
          breakEven !== null
            ? `<div><span>${breakEven === rawPrice ? "Price to call" : "Bar to clear"}</span><b>${breakEven}%</b>
                 <div class="meter"><i class="${short ? "short" : ""}" style="width:${breakEven}%"></i></div>
                 ${breakEven === rawPrice ? "" : `<span>pot odds ${rawPrice}%, raised for bet size</span>`}
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

// --------------------------------------------------------------- practice --

/**
 * The standalone drill: random spots, no chips, no clock. This is where the
 * counting actually gets learned; the table is where it gets used.
 */
async function openPractice() {
  $("lobby").classList.add("hidden");
  $("table-view").classList.add("hidden");
  $("practice").classList.remove("hidden");
  $("leave-btn").classList.add("hidden");
  $("header-meta").textContent = "";
  location.hash = "#/practice";
  await nextPracticeSpot();
}

function closePractice() {
  $("practice").classList.add("hidden");
  $("lobby").classList.remove("hidden");
  location.hash = "";
  refreshTables();
}

async function nextPracticeSpot() {
  drill.reset();
  try {
    const { seed, spot } = await api("/api/practice");
    app.practice = { seed, spot, marking: null };
    renderPractice();
  } catch (error) {
    $("practice-body").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function checkPracticeSpot() {
  const button = $("d-check");
  if (button) button.disabled = true;
  try {
    const { marking } = await api("/api/practice/check", {
      method: "POST",
      body: JSON.stringify({ seed: app.practice.seed, ...drill.attempt() }),
    });
    app.practice.marking = marking;
    tally.add(marking.score);
    renderPractice();
  } catch (error) {
    toast(error.message);
    if (button) button.disabled = false;
  }
}

function renderPractice() {
  const { spot, marking } = app.practice;
  const record = tally.read();

  $("practice-score").innerHTML = record.asked
    ? `<span class="streak"><b>${record.right}</b> of <b>${record.asked}</b> answers right
       (${Math.round((record.right / record.asked) * 100)}%)</span>`
    : "Count the outs, then the odds. Answers are marked, not given.";

  $("practice-body").innerHTML =
    drill.spotHtml(spot) +
    drill.questionsHtml(spot) +
    `<div class="drill-actions">
       ${marking ? "" : `<button class="primary" id="d-check">Check my answers</button>`}
       <button class="${marking ? "primary" : "ghost"}" id="d-next">
         ${marking ? "Next spot" : "Skip this one"}
       </button>
     </div>` +
    (marking
      ? `<div class="disclaimer streak">
           <b>${marking.score.right}/${marking.score.asked}</b> on this spot
         </div>`
      : "");

  drill.bindDeck(spot, marking ? (marking.outs ?? { missed: [], wrong: [] }) : null);
  if (marking) drill.showMarking(marking);
  else $("d-check").onclick = checkPracticeSpot;
  $("d-next").onclick = nextPracticeSpot;
}

$("practice-btn").addEventListener("click", () => void openPractice());
$("practice-exit").addEventListener("click", closePractice);

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

  // Deep link straight into a table: #/t/<id>, or into the drill: #/practice
  const match = /^#\/t\/([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (match) {
    const tableId = match[1];
    void openTable(tableId, store.get(`seat:${tableId}`));
  } else if (location.hash === "#/practice") {
    void openPractice();
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
