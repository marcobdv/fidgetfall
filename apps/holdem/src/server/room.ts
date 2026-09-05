/**
 * The room: every live table, who is sitting at each one, and the clock that
 * keeps them moving.
 *
 * This is the only place that knows about identity. A seat is owned by a
 * *token* handed out at join time; every action carries one, and a token is the
 * only way to see the hole cards of the seat it belongs to. Nothing else in the
 * system can reach another player's cards, which is what makes it safe to let an
 * agent talk to the same table a human is sitting at.
 */

import { randomUUID } from "node:crypto";
import { Table, type PlayerKind, type TableConfig, type TableView } from "../engine/table.js";
import type { Action } from "../engine/types.js";
import { coach, type CoachAdvice } from "../coach/advice.js";
import { reviewHand, type HandReview } from "../coach/review.js";
import { botRng, policyFor, type BotPolicy } from "../bots/policies.js";
import type { Rng } from "../engine/rng.js";

export interface CreateTableOptions {
  name?: string;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  maxSeats?: number;
  minBuyIn?: number;
  maxBuyIn?: number;
  actionTimeoutMs?: number;
  coaching?: boolean;
  revealShowdown?: boolean;
  /** Bot archetypes to seat immediately, e.g. `["balanced", "rock"]`. */
  bots?: string[];
}

export interface Seating {
  token: string;
  playerId: string;
  tableId: string;
  seat: number;
}

export interface TableSummary {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  seated: number;
  maxSeats: number;
  openSeats: number;
  handNumber: number;
  street: string;
  minBuyIn: number;
  maxBuyIn: number;
  coaching: boolean;
  humans: number;
  agents: number;
}

interface BotSeat {
  policy: BotPolicy;
  rng: Rng;
  /** Earliest epoch ms at which this bot may act, so play stays watchable. */
  actAfter: number;
}

export interface RoomOptions {
  /** How long a bot appears to think, in ms. */
  botThinkMs?: number;
  /** Pause between the end of one hand and the deal of the next, in ms. */
  handIntervalMs?: number;
  /** Empty tables untouched for this long are removed. */
  idleTableMs?: number;
  /**
   * Where "now" comes from. Defaults to the wall clock; tests pass a fake one
   * so the whole room shares a single, controllable notion of time — mixing a
   * synthetic tick clock with `Date.now()` elsewhere silently freezes bots.
   */
  clock?: () => number;
  /**
   * Seeds both the shuffle and every bot's randomness, making a whole session
   * reproducible. Without it each table deals fresh cards and each bot draws
   * its own seed, which is what you want in play and hopeless in a test.
   */
  seed?: number;
}

const DEFAULTS = {
  smallBlind: 10,
  bigBlind: 20,
  ante: 0,
  maxSeats: 6,
  actionTimeoutMs: 45_000,
  botThinkMs: 900,
  handIntervalMs: 2_500,
  idleTableMs: 2 * 60 * 60 * 1000,
};

type Listener = (tableId: string) => void;

export class PokerRoom {
  private readonly tables = new Map<string, Table>();
  private readonly tokens = new Map<string, { tableId: string; playerId: string }>();
  private readonly bots = new Map<string, Map<string, BotSeat>>();
  private readonly listeners = new Set<Listener>();
  private readonly options: Required<Omit<RoomOptions, "clock" | "seed">>;
  private readonly clock: () => number;
  private readonly seed?: number;
  /** Advanced per deal, so each hand of a seeded session differs from the last. */
  private deals = 0;
  /** Bumped on every observable change, so clients can tell states apart. */
  private readonly revisions = new Map<string, number>();
  private readonly nextHandAt = new Map<string, number>();

  constructor(options: RoomOptions = {}) {
    this.options = {
      botThinkMs: options.botThinkMs ?? DEFAULTS.botThinkMs,
      handIntervalMs: options.handIntervalMs ?? DEFAULTS.handIntervalMs,
      idleTableMs: options.idleTableMs ?? DEFAULTS.idleTableMs,
    };
    this.clock = options.clock ?? Date.now;
    this.seed = options.seed;
  }

  /** The room's current time. Every default `now` argument comes from here. */
  now(): number {
    return this.clock();
  }

  // ------------------------------------------------------------------ tables

  createTable(options: CreateTableOptions = {}, now: number = this.clock()): Table {
    const bigBlind = requirePositiveInt(options.bigBlind ?? DEFAULTS.bigBlind, "bigBlind");
    const smallBlind = requirePositiveInt(
      options.smallBlind ?? Math.max(1, Math.floor(bigBlind / 2)),
      "smallBlind",
    );
    if (smallBlind > bigBlind) throw new Error("smallBlind cannot exceed bigBlind");

    const maxSeats = options.maxSeats ?? DEFAULTS.maxSeats;
    if (!Number.isInteger(maxSeats) || maxSeats < 2 || maxSeats > 9) {
      throw new Error("maxSeats must be between 2 and 9");
    }

    const minBuyIn = options.minBuyIn ?? bigBlind * 20;
    const maxBuyIn = options.maxBuyIn ?? bigBlind * 200;
    if (minBuyIn > maxBuyIn) throw new Error("minBuyIn cannot exceed maxBuyIn");
    if (minBuyIn < bigBlind) throw new Error("minBuyIn must be at least one big blind");

    const id = shortId();
    const config: TableConfig = {
      id,
      name: (options.name ?? `Table ${id}`).slice(0, 60),
      smallBlind,
      bigBlind,
      ante: options.ante ?? DEFAULTS.ante,
      maxSeats,
      minBuyIn,
      maxBuyIn,
      actionTimeoutMs: options.actionTimeoutMs ?? DEFAULTS.actionTimeoutMs,
      coaching: options.coaching ?? true,
      revealShowdown: options.revealShowdown ?? true,
    };

    const table = new Table(config, now);
    this.tables.set(id, table);
    this.bots.set(id, new Map());
    this.revisions.set(id, 0);

    for (const botId of options.bots ?? []) this.addBot(id, botId, undefined, now);

    this.changed(id);
    return table;
  }

  getTable(tableId: string): Table {
    const table = this.tables.get(tableId);
    if (!table) throw new Error(`no such table: ${tableId}`);
    return table;
  }

  listTables(): TableSummary[] {
    return [...this.tables.values()].map((table) => {
      const players = table.seatedPlayers;
      return {
        id: table.config.id,
        name: table.config.name,
        smallBlind: table.config.smallBlind,
        bigBlind: table.config.bigBlind,
        seated: players.length,
        maxSeats: table.config.maxSeats,
        openSeats: table.openSeats().length,
        handNumber: table.handNumber,
        street: table.hand
          ? table.hand.isComplete
            ? "between hands"
            : table.hand.street
          : "idle",
        minBuyIn: table.config.minBuyIn,
        maxBuyIn: table.config.maxBuyIn,
        coaching: table.config.coaching,
        humans: players.filter((p) => p.kind === "human").length,
        agents: players.filter((p) => p.kind === "agent").length,
      };
    });
  }

  closeTable(tableId: string): void {
    this.tables.delete(tableId);
    this.bots.delete(tableId);
    this.revisions.delete(tableId);
    this.nextHandAt.delete(tableId);
    for (const [token, binding] of [...this.tokens]) {
      if (binding.tableId === tableId) this.tokens.delete(token);
    }
  }

  // ----------------------------------------------------------------- seating

  join(
    tableId: string,
    player: { name: string; kind: PlayerKind; buyIn?: number; seat?: number },
    now: number = this.clock(),
  ): Seating {
    const table = this.getTable(tableId);
    const name = sanitiseName(player.name);
    const buyIn = player.buyIn ?? table.config.maxBuyIn;
    const playerId = randomUUID();

    const seated = table.sit({ id: playerId, name, kind: player.kind }, buyIn, player.seat, now);

    // The table id is baked into the token so any token-bearing call knows
    // which table it is for without being told twice. The map is still the
    // authority — the prefix is only a routing hint.
    const token = `${tableId}.${randomUUID()}`;
    this.tokens.set(token, { tableId, playerId });
    this.changed(tableId);
    return { token, playerId, tableId, seat: seated.seat };
  }

  addBot(tableId: string, botId: string, seat?: number, now: number = this.clock()): Seating {
    const table = this.getTable(tableId);
    const policy = policyFor(botId);
    const sameKind = table.seatedPlayers.filter((p) => p.name.startsWith(policy.label)).length;
    const name = sameKind === 0 ? policy.label : `${policy.label} ${sameKind + 1}`;

    const seating = this.join(
      tableId,
      { name, kind: "agent", buyIn: table.config.maxBuyIn, seat },
      now,
    );
    const seated = this.bots.get(tableId)!;
    this.bots.get(tableId)!.set(seating.playerId, {
      policy,
      // A seeded room derives bot randomness from its seat order rather than
      // from a random player id, so the same session replays identically.
      rng: botRng(this.seed === undefined ? hashString(seating.playerId) : this.seed + seated.size * 7919),
      actAfter: now,
    });
    this.changed(tableId);
    return seating;
  }

  removeBot(tableId: string, seat: number, now: number = this.clock()): boolean {
    const table = this.getTable(tableId);
    const player = table.playerAtSeat(seat);
    const seatBots = this.bots.get(tableId);
    if (!player || !seatBots?.has(player.id)) return false;
    seatBots.delete(player.id);
    table.stand(player.id, now);
    this.changed(tableId);
    return true;
  }

  leave(token: string, now: number = this.clock()): void {
    const binding = this.resolve(token);
    this.getTable(binding.tableId).stand(binding.playerId, now);
    this.tokens.delete(token);
    this.changed(binding.tableId);
  }

  resolve(token: string): { tableId: string; playerId: string } {
    const binding = this.tokens.get(token);
    if (!binding) throw new Error("unknown or expired seat token");
    if (!this.tables.has(binding.tableId)) throw new Error("that table has closed");
    return binding;
  }

  /** The table a token belongs to. Throws if the token is unknown. */
  tableIdForToken(token: string): string {
    return this.resolve(token).tableId;
  }

  isBot(tableId: string, playerId: string): boolean {
    return this.bots.get(tableId)?.has(playerId) ?? false;
  }

  // ----------------------------------------------------------------- playing

  act(token: string, action: Action, now: number = this.clock()): void {
    const { tableId, playerId } = this.resolve(token);
    this.getTable(tableId).act(playerId, action, now);
    this.changed(tableId);
  }

  setSittingOut(token: string, sittingOut: boolean): void {
    const { tableId, playerId } = this.resolve(token);
    this.getTable(tableId).setSittingOut(playerId, sittingOut);
    this.changed(tableId);
  }

  topUp(token: string, amount: number): void {
    const { tableId, playerId } = this.resolve(token);
    this.getTable(tableId).addChips(playerId, amount);
    this.changed(tableId);
  }

  view(tableId: string, token?: string, now: number = this.clock()): TableView & { revision: number } {
    const table = this.getTable(tableId);
    let playerId: string | undefined;
    if (token) {
      const binding = this.tokens.get(token);
      if (binding?.tableId === tableId) playerId = binding.playerId;
    }
    return { ...table.view(playerId, now), revision: this.revisions.get(tableId) ?? 0 };
  }

  revisionOf(tableId: string): number {
    return this.revisions.get(tableId) ?? 0;
  }

  /** Coaching advice for the seat holding `token`, or null when there is none. */
  advise(token: string): CoachAdvice | null {
    const { tableId, playerId } = this.resolve(token);
    const table = this.getTable(tableId);
    const player = table.players.get(playerId);
    const hand = table.hand;
    if (!player || !hand || hand.isComplete) return null;

    const inHand = hand.players.get(player.seat);
    if (!inHand || inHand.status === "folded") return null;

    const opponents = hand.livePlayers.filter((p) => p.seat !== player.seat).length;
    if (opponents === 0) return null;

    const legal = hand.legalActions(player.seat);
    return coach({
      hole: inHand.holeCards,
      board: hand.board,
      opponents,
      pot: hand.pot,
      toCall: legal?.toCall ?? 0,
      street: hand.street,
      legal,
      stack: inHand.stack,
      playersLeftToAct: countLeftToAct(table, player.seat),
    });
  }

  /** Review of a finished hand for the seat holding `token`. */
  review(token: string, handNumber?: number): HandReview | null {
    const { tableId, playerId } = this.resolve(token);
    const table = this.getTable(tableId);
    const player = table.players.get(playerId);
    if (!player) return null;

    // Reviews are keyed on who actually played the hand, not on the seat
    // number. Seats are reused, and a later occupant must never be able to read
    // the cards of whoever sat there before them.
    const playedIt = (h: { players: Record<number, string> }) => h.players[player.seat] === playerId;

    const hand =
      handNumber === undefined
        ? [...table.history].reverse().find(playedIt)
        : table.history.find((h) => h.handNumber === handNumber);

    // The default also lands on the last hand *you* played rather than the last
    // hand the table played — a busted player wants the hand that busted them.
    if (!hand || !playedIt(hand)) return null;
    return reviewHand(hand, player.seat);
  }

  /**
   * Resolves as soon as it is this token's turn to act, or when the wait runs
   * out. Agents use it instead of polling: it means an MCP client can sit at a
   * table without burning a request every second.
   */
  waitForTurn(
    token: string,
    timeoutMs: number,
    now: number = this.clock(),
  ): Promise<{ yourTurn: boolean; timedOut: boolean }> {
    const { tableId, playerId } = this.resolve(token);

    const isMyTurn = (): boolean => {
      const table = this.tables.get(tableId);
      const player = table?.players.get(playerId);
      if (!table || !player || !table.hand || table.hand.isComplete) return false;
      return table.hand.actingSeat === player.seat;
    };

    if (isMyTurn()) return Promise.resolve({ yourTurn: true, timedOut: false });

    return new Promise((resolve) => {
      let settled = false;
      const finish = (yourTurn: boolean, timedOut: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve({ yourTurn, timedOut });
      };

      const unsubscribe = this.onChange((changedTable) => {
        if (changedTable !== tableId) return;
        // The seat can also vanish underneath us — a closed table or a stand-up
        // must wake the waiter rather than hang it until the timeout.
        if (isMyTurn()) finish(true, false);
        else if (!this.tables.has(tableId)) finish(false, false);
      });

      const timer = setTimeout(() => finish(isMyTurn(), true), Math.max(0, timeoutMs));
      // Never hold the process open just for a waiting agent.
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  // -------------------------------------------------------------------- tick

  /**
   * Moves every table forward: expires action clocks, plays bot turns, and
   * deals the next hand once the pause after the last one has elapsed. The
   * server calls this on an interval; tests call it directly.
   */
  tick(now: number = this.clock()): void {
    for (const [tableId, table] of [...this.tables]) {
      if (table.seatedPlayers.length === 0 && now - table.lastActivityAt > this.options.idleTableMs) {
        this.closeTable(tableId);
        continue;
      }

      let changed = false;

      if (table.hand && !table.hand.isComplete && table.timeoutAct(now) !== null) changed = true;
      if (table.hand && !table.hand.isComplete && this.playBotTurn(tableId, table, now)) changed = true;

      if (!table.hand || table.hand.isComplete) {
        if (!table.canStartHand) {
          this.nextHandAt.delete(tableId);
        } else {
          const due = this.nextHandAt.get(tableId) ?? now + this.options.handIntervalMs;
          this.nextHandAt.set(tableId, due);
          if (now >= due) {
            this.nextHandAt.delete(tableId);
            // A seeded room deals a deterministic sequence, so a whole session
            // can be replayed. Unseeded, the table shuffles freshly each hand.
            if (this.seed !== undefined && table.nextSeed === null) {
              table.nextSeed = (this.seed + this.deals++ * 104729) >>> 0;
            }
            if (table.startHand(now)) changed = true;
          }
        }
      }

      if (changed) this.changed(tableId);
    }
  }

  private playBotTurn(tableId: string, table: Table, now: number): boolean {
    const hand = table.hand;
    if (!hand || hand.isComplete || hand.actingSeat === null) return false;

    const player = table.playerAtSeat(hand.actingSeat);
    if (!player) return false;
    const bot = this.bots.get(tableId)?.get(player.id);
    if (!bot || now < bot.actAfter) return false;

    const inHand = hand.players.get(player.seat)!;
    const legal = hand.legalActions(player.seat)!;
    const safe: Action = legal.canCheck ? { type: "check" } : { type: "fold" };

    let action: Action;
    try {
      action = bot.policy.decide({
        hole: inHand.holeCards,
        board: hand.board,
        opponents: Math.max(1, hand.livePlayers.length - 1),
        pot: hand.pot,
        street: hand.street,
        legal,
        stack: inHand.stack,
        bigBlind: table.config.bigBlind,
        rng: bot.rng,
      });
    } catch {
      // A broken policy must never wedge a table.
      action = safe;
    }

    try {
      table.act(player.id, action, now);
    } catch {
      table.act(player.id, safe, now);
    }

    bot.actAfter = now + this.options.botThinkMs;
    return true;
  }

  // --------------------------------------------------------------- listeners

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(tableId: string): void {
    this.revisions.set(tableId, (this.revisions.get(tableId) ?? 0) + 1);
    for (const listener of this.listeners) {
      try {
        listener(tableId);
      } catch {
        // A misbehaving subscriber must not stop the table.
      }
    }
  }
}

function countLeftToAct(table: Table, seat: number): number {
  const hand = table.hand;
  if (!hand) return 0;
  return hand.livePlayers.filter((p) => p.seat !== seat && p.status === "active").length;
}

function requirePositiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive whole number`);
  }
  return value;
}

/** Control characters and angle brackets have no place in a player name. */
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f<>]/g;

function sanitiseName(name: string): string {
  const cleaned = name.replace(UNSAFE_NAME_CHARS, "").trim().slice(0, 24);
  if (cleaned.length === 0) throw new Error("a name is required");
  return cleaned;
}

/** Short table id from an alphabet with no vowels, so it cannot spell anything. */
function shortId(): string {
  const alphabet = "bcdfghjkmnpqrstvwxz23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
