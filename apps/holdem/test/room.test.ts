import { describe, expect, it } from "vitest";
import { PokerRoom } from "../src/server/room.js";

/**
 * A room on a clock the test drives. `advance()` moves time forward and ticks,
 * so bot turns and action clocks resolve exactly when the test says they do.
 */
function room(options: { botThinkMs?: number; handIntervalMs?: number; seed?: number } = {}) {
  let clock = 0;
  const r = new PokerRoom({
    botThinkMs: options.botThinkMs ?? 0,
    handIntervalMs: options.handIntervalMs ?? 0,
    idleTableMs: 1_000_000,
    clock: () => clock,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  });
  return {
    room: r,
    get now() {
      return clock;
    },
    advance(ms = 50, times = 1) {
      for (let i = 0; i < times; i++) {
        clock += ms;
        r.tick();
      }
    },
  };
}

describe("creating tables", () => {
  it("creates a playable table with defaults", () => {
    const table = room().room.createTable();
    expect(table.config.smallBlind).toBe(10);
    expect(table.config.bigBlind).toBe(20);
    expect(table.config.maxSeats).toBe(6);
    expect(table.config.minBuyIn).toBe(400);
  });

  it("derives the small blind from the big blind", () => {
    expect(room().room.createTable({ bigBlind: 50 }).config.smallBlind).toBe(25);
  });

  it("rejects nonsense configuration rather than silently fixing it", () => {
    const { room: r } = room();
    expect(() => r.createTable({ bigBlind: 0 })).toThrow(/positive/);
    expect(() => r.createTable({ bigBlind: 20, smallBlind: 30 })).toThrow(/cannot exceed/);
    expect(() => r.createTable({ maxSeats: 12 })).toThrow(/between 2 and 9/);
    expect(() => r.createTable({ bigBlind: 20, minBuyIn: 5000, maxBuyIn: 100 })).toThrow(/cannot exceed/);
  });

  it("seats the requested bots immediately", () => {
    const { room: r } = room();
    const table = r.createTable({ bots: ["rock", "station", "maniac"] });
    expect(table.seatedPlayers).toHaveLength(3);
    expect(table.seatedPlayers.map((p) => p.name)).toEqual(["Rock", "Calling station", "Maniac"]);
    expect(table.seatedPlayers.every((p) => p.kind === "agent")).toBe(true);
  });

  it("numbers repeated bots of the same archetype", () => {
    const table = room().room.createTable({ bots: ["rock", "rock"] });
    expect(table.seatedPlayers.map((p) => p.name)).toEqual(["Rock", "Rock 2"]);
  });

  it("refuses an unknown bot and says what is available", () => {
    expect(() => room().room.createTable({ bots: ["genius"] })).toThrow(/unknown bot "genius"/);
  });
});

describe("seat tokens", () => {
  it("shows a player their own cards and nobody else's", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ bots: ["rock"] });
    const ada = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });
    const bo = r.join(table.config.id, { name: "Bo", kind: "agent", buyIn: 1000 });

    advance();
    expect(table.hand).not.toBeNull();

    const adaView = r.view(table.config.id, ada.token);
    const mine = adaView.seats.find((s) => s.seat === ada.seat)!;
    expect(mine.holeCards).toHaveLength(2);

    for (const seat of adaView.seats) {
      if (seat.seat === ada.seat || !seat.inHand) continue;
      expect(seat.holeCards).toBeNull();
      expect(seat.hiddenCards).toBe(2);
    }

    // And the other way round, from Bo's token.
    const boView = r.view(table.config.id, bo.token);
    expect(boView.seats.find((s) => s.seat === bo.seat)!.holeCards).toHaveLength(2);
    expect(boView.seats.find((s) => s.seat === ada.seat)!.holeCards).toBeNull();
  });

  it("shows a spectator nobody's cards at all", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ bots: ["rock", "balanced"] });
    advance();
    const view = r.view(table.config.id);
    expect(view.youSeat).toBeNull();
    expect(view.legalActions).toBeNull();
    for (const seat of view.seats) expect(seat.holeCards).toBeNull();
  });

  it("carries the table id so a token alone identifies a seat", () => {
    const { room: r } = room();
    const table = r.createTable();
    const seating = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });
    expect(seating.token.startsWith(`${table.config.id}.`)).toBe(true);
    expect(r.tableIdForToken(seating.token)).toBe(table.config.id);
  });

  it("rejects an unknown token", () => {
    expect(() => room().room.resolve("nope.nope")).toThrow(/unknown or expired/);
  });

  it("stops honouring a token after the player leaves", () => {
    const { room: r } = room();
    const table = r.createTable({ bots: ["rock"] });
    const seating = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });
    r.leave(seating.token);
    expect(() => r.resolve(seating.token)).toThrow(/unknown or expired/);
  });
});

describe("bots at the table", () => {
  it("plays hands to completion without a human present", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ bots: ["balanced", "rock", "station"] });

    for (let i = 0; i < 4000 && table.history.length < 6; i++) advance();

    expect(table.history.length).toBeGreaterThanOrEqual(6);
    for (const hand of table.history) {
      const paid = hand.result.payouts.reduce((sum, p) => sum + p.amount, 0);
      const potted = hand.result.pots.reduce((sum, p) => sum + p.amount, 0);
      expect(paid).toBe(potted);
    }
  });

  it("conserves chips across a long session", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ bots: ["maniac", "station", "balanced", "rock"] });
    const started = table.seatedPlayers.reduce((sum, p) => sum + p.stack, 0);

    for (let i = 0; i < 8000 && table.history.length < 25; i++) advance();

    // Busted players sit out but keep their (zero) stack, so the total is still
    // the total: no chips are created or destroyed by the room. The next hand's
    // blinds may already be posted, so the live pot counts too.
    const inPlay = table.hand && !table.hand.isComplete ? table.hand.pot : 0;
    const ended = table.seatedPlayers.reduce((sum, p) => sum + p.stack, 0) + inPlay;
    expect(ended).toBe(started);
    expect(table.history.length).toBeGreaterThan(5);
  });

  it("waits for a second player rather than dealing to one", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ bots: ["rock"] });
    advance(100, 50);
    expect(table.hand).toBeNull();
    expect(r.view(table.config.id).waitingFor).toMatch(/waiting for players/);
  });
});

describe("a seeded room replays identically", () => {
  it("deals the same cards and draws the same bot decisions", () => {
    const play = () => {
      const { room: r, advance } = room({ seed: 4242 });
      // No maniac here: it shoves the table broke inside a few hands, which
      // makes for a short and uninteresting replay.
      const table = r.createTable({
        minBuyIn: 1000,
        maxBuyIn: 1000,
        bots: ["station", "balanced", "rock"],
      });
      for (let i = 0; i < 4000 && table.history.length < 8; i++) advance();
      return table.history.map((h) => `${h.handNumber}:${h.board.join("")}:${JSON.stringify(h.result.net)}`);
    };
    const first = play();
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(play()).toEqual(first);
  });

  it("deals differently without a seed", () => {
    const play = () => {
      const { room: r, advance } = room();
      const table = r.createTable({ minBuyIn: 400, maxBuyIn: 400, bots: ["balanced", "rock"] });
      for (let i = 0; i < 2000 && table.history.length < 3; i++) advance();
      return table.history.map((h) => h.board.join(""));
    };
    expect(play()).not.toEqual(play());
  });
});

describe("the running commentary accounts for every chip", () => {
  /**
   * The log is what a player actually reads, and it is rendered separately from
   * the engine's own pot arithmetic. This replays a whole session from those
   * lines alone — the way an onlooker would — and checks the books balance.
   *
   * Short stacks at these blinds mean constant all-ins and side pots, which is
   * exactly where a rendering slip would hide.
   */
  function capture(r: PokerRoom, tableId: string): string[] {
    const captured: string[] = [];
    let previous: string[] = [];
    r.onChange((id) => {
      if (id !== tableId) return;
      const log = r.getTable(tableId).log;
      // The table keeps a rolling window, so append only what is new.
      let overlap = 0;
      for (let i = log.length; i >= 0; i--) {
        if (i === 0 || previous.slice(-i).join("\u0000") === log.slice(0, i).join("\u0000")) {
          overlap = i;
          break;
        }
      }
      captured.push(...log.slice(overlap));
      previous = [...log];
    });
    return captured;
  }

  it("balances a short-stack session full of all-ins", () => {
    // Seeded, so the session is the same every run: the invariant is what is
    // under test, and an unseeded table sometimes dries up after four hands.
    const { room: r, advance } = room({ seed: 20250905 });
    const table = r.createTable({
      name: "Audit",
      smallBlind: 10,
      bigBlind: 20,
      minBuyIn: 400,
      maxBuyIn: 400,
      bots: ["maniac", "station", "balanced", "rock", "maniac"],
    });
    const lines = capture(r, table.config.id);

    // Short stacks bust, so the table eventually runs dry — play until it does,
    // or until we have plenty. Demanding a fixed hand count made this flaky,
    // and the invariant holds over any session, not only a long one.
    for (let i = 0; i < 8000 && table.history.length < 25; i++) {
      if (!table.canStartHand && (!table.hand || table.hand.isComplete)) break;
      advance();
    }
    expect(table.history.length).toBeGreaterThanOrEqual(5);
    // Short stacks at these blinds mean all-ins, which is where a rendering
    // slip would hide. Side-pot construction itself is covered in hand.test.ts.
    expect(lines.some((line) => line.includes("all in"))).toBe(true);

    const paid = new Map<string, number>();
    const took = new Map<string, number>();
    const bought = new Map<string, number>();
    let committed = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

    for (const line of lines) {
      let m: RegExpExecArray | null;
      if ((m = /^(.+?) sits in seat \d+ with (\d+) chips$/.exec(line))) {
        add(bought, m[1]!, Number(m[2]));
      } else if (/^— Hand #/.test(line) || /^(Flop|Turn|River):/.test(line)) {
        committed = new Map();
      } else if ((m = /^(.+?) posts the (?:small blind|big blind|ante) \((\d+)\)$/.exec(line))) {
        add(paid, m[1]!, Number(m[2]));
        add(committed, m[1]!, Number(m[2]));
      } else if ((m = /^(.+?) calls (\d+)/.exec(line))) {
        add(paid, m[1]!, Number(m[2]));
        add(committed, m[1]!, Number(m[2]));
      } else if ((m = /^(.+?) (?:bets|raises to) (\d+)/.exec(line))) {
        // Bets and raises are quoted as round totals, not chips added.
        const total = Number(m[2]);
        add(paid, m[1]!, total - (committed.get(m[1]!) ?? 0));
        committed.set(m[1]!, total);
      } else if ((m = /^(\d+) returned to (.+?) \(uncalled\)$/.exec(line))) {
        add(took, m[2]!, Number(m[1]));
      } else if ((m = /^(.+?) wins (\d+)$/.exec(line))) {
        add(took, m[1]!, Number(m[2]));
      }
    }

    const into = [...paid.values()].reduce((a, b) => a + b, 0);
    const outOf = [...took.values()].reduce((a, b) => a + b, 0);
    // The next hand's blinds are usually already posted when the loop stops, so
    // what is still in the middle is exactly what has not been paid out yet.
    const inPlay = table.hand && !table.hand.isComplete ? table.hand.pot : 0;
    expect(into).toBeGreaterThan(0);
    expect(into - outOf).toBe(inPlay);

    // And the per-player books match the stacks the engine is actually holding.
    for (const player of table.seatedPlayers) {
      // Chips already staked in the live hand have left the stack and are
      // counted as paid, so the two sides line up without any adjustment.
      const net = (took.get(player.name) ?? 0) - (paid.get(player.name) ?? 0);
      expect(player.stack).toBe((bought.get(player.name) ?? 0) + net);
    }
    expect(
      table.seatedPlayers.reduce((sum, p) => sum + p.stack, 0) + inPlay,
    ).toBe([...bought.values()].reduce((a, b) => a + b, 0));
  });
});

describe("the action clock", () => {
  it("folds a seat that lets its clock run out facing the blind", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ actionTimeoutMs: 1000 });
    r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });
    r.join(table.config.id, { name: "Bo", kind: "human", buyIn: 1000 });

    advance();
    const acting = table.hand!.actingSeat!;
    advance(2000);
    // Preflop the first seat is facing the big blind, so a timeout folds them
    // and the hand ends.
    expect(table.hand!.players.get(acting)!.status).toBe("folded");
  });

  it("sits out a player who times out facing a bet", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ actionTimeoutMs: 1000 });
    const ada = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });
    r.join(table.config.id, { name: "Bo", kind: "human", buyIn: 1000 });

    advance();
    const acting = table.hand!.actingSeat!;
    advance(2000);
    const timedOut = table.playerAtSeat(acting)!;
    expect(timedOut.sittingOut).toBe(true);
    expect([ada.seat, 1 - ada.seat]).toContain(acting);
  });
});

describe("waiting for a turn", () => {
  it("resolves immediately when it is already your turn", async () => {
    const { room: r, advance } = room();
    const table = r.createTable({ bots: ["rock"] });
    const ada = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });

    // Deal, then let the bot act until it is Ada's turn.
    for (let i = 0; i < 100 && table.hand?.actingSeat !== ada.seat; i++) advance();

    const wait = await r.waitForTurn(ada.token, 50);
    expect(wait.yourTurn).toBe(true);
    expect(wait.timedOut).toBe(false);
  });

  it("times out rather than hanging when the turn never comes", async () => {
    const { room: r } = room();
    const table = r.createTable();
    const ada = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });
    const wait = await r.waitForTurn(ada.token, 20);
    expect(wait.yourTurn).toBe(false);
    expect(wait.timedOut).toBe(true);
  });

  it("wakes as soon as the turn arrives", async () => {
    const { room: r, advance } = room();
    const table = r.createTable({ bots: ["station"] });
    const ada = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });

    const waiting = r.waitForTurn(ada.token, 5000);
    const pump = setInterval(() => advance(), 1);

    const wait = await waiting;
    clearInterval(pump);
    expect(wait.yourTurn).toBe(true);
    expect(table.hand!.actingSeat).toBe(ada.seat);
  });
});

describe("reviewing a hand belongs to whoever played it", () => {
  /** Plays hands until `done()`, acting passively for `seating`. */
  function play(
    r: PokerRoom,
    table: ReturnType<PokerRoom["createTable"]>,
    advance: () => void,
    seating: { token: string; seat: number },
    done: () => boolean,
    limit = 400,
  ) {
    for (let i = 0; i < limit && !done(); i++) {
      advance();
      if (table.hand && !table.hand.isComplete && table.hand.actingSeat === seating.seat) {
        const legal = table.hand.legalActions(seating.seat)!;
        r.act(seating.token, legal.canCheck ? { type: "check" } : { type: "fold" });
      }
    }
  }

  it("refuses to show a hand to whoever later takes the same seat", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ minBuyIn: 1000, maxBuyIn: 1000, bots: ["station"] });

    const alice = r.join(table.config.id, { name: "Alice", kind: "human", buyIn: 1000 });
    play(r, table, advance, alice, () => table.history.length >= 1);
    const played = table.history[0]!;
    expect(played.holeCards[alice.seat]).toHaveLength(2);

    // Alice stands up and the seat is genuinely released.
    r.leave(alice.token);
    for (let i = 0; i < 400 && table.playerAtSeat(alice.seat); i++) advance();
    expect(table.playerAtSeat(alice.seat)).toBeUndefined();

    const mallory = r.join(table.config.id, {
      name: "Mallory",
      kind: "human",
      buyIn: 1000,
      seat: alice.seat,
    });
    expect(mallory.seat).toBe(alice.seat);

    // Mallory occupies Alice's old seat but never played that hand.
    expect(r.review(mallory.token, played.handNumber)).toBeNull();
  });

  it("defaults to the last hand you played, not the last hand the table played", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ minBuyIn: 1000, maxBuyIn: 1000, bots: ["station", "rock"] });

    const ada = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });
    play(r, table, advance, ada, () => table.history.length >= 1);

    // Ada sits out, so the table plays on without her. The steps are coarse so
    // her action clock expires rather than the table stalling on a seat that is
    // no longer answering.
    r.setSittingOut(ada.token, true);
    const before = table.history.length;
    for (let i = 0; i < 200 && table.history.length < before + 3; i++) advance(1000);

    const hersByNumber = table.history
      .filter((h) => h.players[ada.seat] === ada.playerId)
      .map((h) => h.handNumber);
    const latest = table.history[table.history.length - 1]!.handNumber;
    expect(hersByNumber.length).toBeGreaterThan(0);
    // The table has moved past her last hand, which is the whole point.
    expect(latest).toBeGreaterThan(Math.max(...hersByNumber));

    // The default review is still hers, rather than nothing at all.
    const review = r.review(ada.token);
    expect(review).not.toBeNull();
    expect(review!.handNumber).toBe(Math.max(...hersByNumber));
  });

  it("still lets a player review their own hand by number", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ minBuyIn: 1000, maxBuyIn: 1000, bots: ["station"] });
    const ada = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });
    play(r, table, advance, ada, () => table.history.length >= 1);

    const played = table.history[0]!;
    const review = r.review(ada.token, played.handNumber)!;
    expect(review.handNumber).toBe(played.handNumber);
    expect(review.holeCards).toEqual(played.holeCards[ada.seat]);
  });
});

describe("coaching through the room", () => {
  it("advises the seat that holds the token and nobody else", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ bots: ["rock"] });
    const ada = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });
    advance();

    const advice = r.advise(ada.token)!;
    expect(advice).not.toBeNull();
    expect(advice.equity.equity).toBeGreaterThan(0);
    expect(advice.tips.length).toBeGreaterThan(1);
    expect(advice.tips.some((t) => t.label === "Your hand")).toBe(true);
  });

  it("has nothing to say when no hand is running", () => {
    const { room: r } = room();
    const table = r.createTable();
    const ada = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });
    expect(r.advise(ada.token)).toBeNull();
  });

  it("reviews the previous hand once one has finished", () => {
    const { room: r, advance } = room();
    const table = r.createTable({ bots: ["station", "balanced"] });
    const ada = r.join(table.config.id, { name: "Ada", kind: "human", buyIn: 1000 });

    for (let i = 0; i < 3000 && table.history.length < 1; i++) {
      advance();
      // Ada checks when it is free and folds otherwise, which still produces a
      // reviewable decision.
      if (table.hand && !table.hand.isComplete && table.hand.actingSeat === ada.seat) {
        const legal = table.hand.legalActions(ada.seat)!;
        r.act(ada.token, legal.canCheck ? { type: "check" } : { type: "fold" });
      }
    }

    const review = r.review(ada.token);
    expect(review).not.toBeNull();
    expect(review!.summary.length).toBeGreaterThan(10);
  });
});
