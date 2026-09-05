/**
 * A table: seats, buy-ins, button rotation and the succession of hands.
 *
 * Like `PokerHand` this is pure logic — it has no sockets and no timers. Time
 * enters only as a `now` argument, so the server can drive action clocks and the
 * tests can drive them instantly.
 */

import { cardToString } from "./cards.js";
import { type HandSeat, PokerHand } from "./hand.js";
import { randomSeed } from "./rng.js";
import type { Action, HandEvent, HandResult, LegalActions, Street } from "./types.js";

export type PlayerKind = "human" | "agent";

export interface TableConfig {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
  /** Milliseconds a seat has to act before it is folded (or checked) for them. */
  actionTimeoutMs: number;
  /** Whether the coach panel is offered to human seats at this table. */
  coaching: boolean;
  /** Show every showdown hand rather than only the winners — good for learning. */
  revealShowdown: boolean;
}

export interface TablePlayer {
  id: string;
  name: string;
  kind: PlayerKind;
  seat: number;
  stack: number;
  sittingOut: boolean;
  connected: boolean;
  /** Set when the player has asked to leave once the current hand finishes. */
  leaving: boolean;
  /** Chips bought in with, total, so the UI can show a session result. */
  boughtIn: number;
}

export interface CompletedHand {
  handId: string;
  handNumber: number;
  buttonSeat: number;
  board: string[];
  events: HandEvent[];
  result: HandResult;
  /** Seat → player name at the time the hand was played. */
  names: Record<number, string>;
  /**
   * Seat → the player id that occupied it. Seats are reused once someone
   * stands up, so identity — not seat number — is what decides whose hand this
   * was, and therefore who may look at it afterwards.
   */
  players: Record<number, string>;
  /** Seat → hole cards, for review after the fact. */
  holeCards: Record<number, string[]>;
  seed: number;
  endedAt: number;
}

export interface SeatView {
  seat: number;
  playerId: string | null;
  name: string | null;
  kind: PlayerKind | null;
  stack: number;
  sittingOut: boolean;
  connected: boolean;
  /** Present only for hands that are visible to the viewer. */
  holeCards: string[] | null;
  /** How many face-down cards to draw for this seat. */
  hiddenCards: number;
  inHand: boolean;
  status: "active" | "folded" | "all-in" | null;
  committed: number;
  isButton: boolean;
  isActing: boolean;
  handDescription: string | null;
}

export interface TableView {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
  coaching: boolean;
  actionTimeoutMs: number;
  handNumber: number;
  handId: string | null;
  street: Street | "idle";
  board: string[];
  pot: number;
  pots: Array<{ amount: number; eligible: number[] }>;
  buttonSeat: number | null;
  actingSeat: number | null;
  /** Epoch ms by which the acting seat must act, or null. */
  actionDeadline: number | null;
  seats: SeatView[];
  /** The viewer's own seat, when they have one. */
  youSeat: number | null;
  legalActions: LegalActions | null;
  /** Human-readable running commentary, newest last. */
  log: string[];
  waitingFor: string | null;
}

const MAX_HISTORY = 50;
const MAX_LOG = 120;

export class Table {
  readonly config: TableConfig;
  readonly createdAt: number;
  readonly players: Map<string, TablePlayer> = new Map();
  readonly history: CompletedHand[] = [];

  hand: PokerHand | null = null;
  handNumber = 0;
  buttonSeat: number | null = null;
  actionDeadline: number | null = null;
  log: string[] = [];
  lastActivityAt: number;

  /** Seed for the next hand; set explicitly by tests for reproducible deals. */
  nextSeed: number | null = null;

  private currentSeed = 0;

  constructor(config: TableConfig, now: number = Date.now()) {
    if (config.maxSeats < 2 || config.maxSeats > 9) {
      throw new RangeError("a table seats between 2 and 9 players");
    }
    this.config = config;
    this.createdAt = now;
    this.lastActivityAt = now;
  }

  // ------------------------------------------------------------------- seats

  get seatedPlayers(): TablePlayer[] {
    return [...this.players.values()].sort((a, b) => a.seat - b.seat);
  }

  /** Players eligible to be dealt into the next hand. */
  get readyPlayers(): TablePlayer[] {
    return this.seatedPlayers.filter((p) => !p.sittingOut && !p.leaving && p.stack > 0);
  }

  playerAtSeat(seat: number): TablePlayer | undefined {
    return this.seatedPlayers.find((p) => p.seat === seat);
  }

  openSeats(): number[] {
    const taken = new Set(this.seatedPlayers.map((p) => p.seat));
    return Array.from({ length: this.config.maxSeats }, (_, i) => i).filter((s) => !taken.has(s));
  }

  sit(
    player: { id: string; name: string; kind: PlayerKind },
    buyIn: number,
    preferredSeat?: number,
    now: number = Date.now(),
  ): TablePlayer {
    if (this.players.has(player.id)) throw new Error(`${player.name} is already seated`);
    if (!Number.isInteger(buyIn)) throw new Error("buy-in must be a whole number of chips");
    if (buyIn < this.config.minBuyIn || buyIn > this.config.maxBuyIn) {
      throw new Error(
        `buy-in must be between ${this.config.minBuyIn} and ${this.config.maxBuyIn} chips`,
      );
    }

    const open = this.openSeats();
    if (open.length === 0) throw new Error("the table is full");
    const seat =
      preferredSeat !== undefined && open.includes(preferredSeat) ? preferredSeat : open[0]!;
    if (preferredSeat !== undefined && seat !== preferredSeat) {
      throw new Error(`seat ${preferredSeat} is taken`);
    }

    const seated: TablePlayer = {
      id: player.id,
      name: player.name,
      kind: player.kind,
      seat,
      stack: buyIn,
      // Joining mid-hand waits for the next deal rather than being dealt in late.
      sittingOut: false,
      connected: true,
      leaving: false,
      boughtIn: buyIn,
    };
    this.players.set(player.id, seated);
    this.note(`${player.name} sits in seat ${seat + 1} with ${buyIn} chips`);
    this.lastActivityAt = now;
    return seated;
  }

  /**
   * Removes a player. Mid-hand this folds them and defers the removal to the
   * end of the hand, so their chips stay in the pot they contested.
   */
  stand(playerId: string, now: number = Date.now()): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.lastActivityAt = now;

    if (this.hand && !this.hand.isComplete && this.hand.players.has(player.seat)) {
      const inHand = this.hand.players.get(player.seat)!;
      if (inHand.status !== "folded") {
        player.leaving = true;
        this.note(`${player.name} is leaving after this hand`);
        if (this.hand.actingSeat === player.seat) this.act(playerId, { type: "fold" }, now);
        return;
      }
    }

    this.players.delete(playerId);
    this.note(`${player.name} leaves the table`);
  }

  setSittingOut(playerId: string, sittingOut: boolean): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.sittingOut = sittingOut;
    this.note(`${player.name} ${sittingOut ? "sits out" : "is back in"}`);
  }

  setConnected(playerId: string, connected: boolean): void {
    const player = this.players.get(playerId);
    if (player) player.connected = connected;
  }

  addChips(playerId: string, amount: number): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error("not seated");
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("top-up must be positive");
    if (player.stack + amount > this.config.maxBuyIn) {
      throw new Error(`a stack may not exceed the ${this.config.maxBuyIn} chip maximum`);
    }
    if (this.hand && !this.hand.isComplete && this.hand.players.has(player.seat)) {
      throw new Error("you cannot top up in the middle of a hand");
    }
    player.stack += amount;
    player.boughtIn += amount;
    player.sittingOut = false;
    this.note(`${player.name} tops up to ${player.stack} chips`);
  }

  // ------------------------------------------------------------------- hands

  get canStartHand(): boolean {
    return (!this.hand || this.hand.isComplete) && this.readyPlayers.length >= 2;
  }

  /** Deals the next hand if there are two ready players. Returns true if it did. */
  startHand(now: number = Date.now()): boolean {
    if (!this.canStartHand) return false;

    const contenders = this.readyPlayers;
    this.buttonSeat = this.nextButtonSeat(contenders.map((p) => p.seat));

    const seats: HandSeat[] = contenders.map((p) => ({ seat: p.seat, stack: p.stack }));
    this.handNumber++;
    this.currentSeed = this.nextSeed ?? randomSeed();
    this.nextSeed = null;

    this.hand = new PokerHand({
      handId: `${this.config.id}#${this.handNumber}`,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      ante: this.config.ante,
      buttonSeat: this.buttonSeat,
      seed: this.currentSeed,
      seats,
    });

    this.note(`— Hand #${this.handNumber} — button on seat ${this.buttonSeat + 1}`);
    for (const event of this.hand.events) this.describe(event);
    this.syncStacks();
    this.resetClock(now);

    // Blinds alone can put everyone all in, finishing the hand immediately.
    if (this.hand.isComplete) this.finishHand(now);
    return true;
  }

  /** Next occupied seat clockwise from the current button. */
  private nextButtonSeat(occupied: number[]): number {
    const sorted = [...occupied].sort((a, b) => a - b);
    if (this.buttonSeat === null) return sorted[0]!;
    for (const seat of sorted) if (seat > this.buttonSeat) return seat;
    return sorted[0]!;
  }

  act(playerId: string, action: Action, now: number = Date.now()): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error("you are not seated at this table");
    if (!this.hand || this.hand.isComplete) throw new Error("no hand is in progress");
    if (this.hand.actingSeat !== player.seat) throw new Error("it is not your turn");

    const before = this.hand.events.length;
    this.hand.act(player.seat, action);
    for (const event of this.hand.events.slice(before)) this.describe(event);

    this.syncStacks();
    this.lastActivityAt = now;
    if (this.hand.isComplete) this.finishHand(now);
    else this.resetClock(now);
  }

  /**
   * Folds (or checks) for a seat whose clock has expired. Returns the seat that
   * was acted for, or null when nothing was due.
   */
  timeoutAct(now: number = Date.now()): number | null {
    if (!this.hand || this.hand.isComplete) return null;
    if (this.actionDeadline === null || now < this.actionDeadline) return null;

    const seat = this.hand.actingSeat;
    if (seat === null) return null;
    const player = this.playerAtSeat(seat);
    if (!player) return null;

    const legal = this.hand.legalActions(seat)!;
    // Checking is free, so time out into a check rather than throwing the hand away.
    const action: Action = legal.canCheck ? { type: "check" } : { type: "fold" };
    this.note(`${player.name} timed out and ${legal.canCheck ? "checks" : "folds"}`);
    this.act(player.id, action, now);
    // Repeated timeouts mean nobody is home; park them until they come back.
    if (!legal.canCheck) player.sittingOut = true;
    return seat;
  }

  private resetClock(now: number): void {
    this.actionDeadline =
      this.hand && !this.hand.isComplete && this.hand.actingSeat !== null
        ? now + this.config.actionTimeoutMs
        : null;
  }

  /** Mirrors hand stacks back onto the seated players. */
  private syncStacks(): void {
    if (!this.hand) return;
    for (const [seat, inHand] of this.hand.players) {
      const player = this.playerAtSeat(seat);
      if (player) player.stack = inHand.stack;
    }
  }

  private finishHand(now: number): void {
    const hand = this.hand;
    if (!hand || !hand.result) return;

    this.actionDeadline = null;
    this.syncStacks();

    const names: Record<number, string> = {};
    const players: Record<number, string> = {};
    const holeCards: Record<number, string[]> = {};
    for (const [seat, inHand] of hand.players) {
      const occupant = this.playerAtSeat(seat);
      names[seat] = occupant?.name ?? `Seat ${seat + 1}`;
      if (occupant) players[seat] = occupant.id;
      holeCards[seat] = inHand.holeCards.map(cardToString);
    }

    this.history.push({
      handId: hand.handId,
      handNumber: this.handNumber,
      buttonSeat: hand.buttonSeat,
      board: hand.board.map(cardToString),
      events: hand.events,
      result: hand.result,
      names,
      players,
      holeCards,
      seed: this.currentSeed,
      endedAt: now,
    });
    while (this.history.length > MAX_HISTORY) this.history.shift();

    // Players who asked to leave go now; players with no chips sit out until
    // they top up.
    for (const player of [...this.players.values()]) {
      if (player.leaving) {
        this.players.delete(player.id);
        this.note(`${player.name} leaves the table`);
      } else if (player.stack === 0) {
        player.sittingOut = true;
        this.note(`${player.name} is out of chips and sits out`);
      }
    }
    this.lastActivityAt = now;
  }

  // ------------------------------------------------------------------- views

  /**
   * The table as `viewerId` is allowed to see it. Hole cards are only ever
   * included for the viewer's own seat, or at a showdown.
   */
  view(viewerId?: string, now: number = Date.now()): TableView {
    const viewer = viewerId ? this.players.get(viewerId) : undefined;
    const hand = this.hand;
    const showdownVisible = hand?.result != null && hand.result.showdown.length > 0;

    const seats: SeatView[] = [];
    for (let seat = 0; seat < this.config.maxSeats; seat++) {
      const player = this.playerAtSeat(seat);
      const inHand = hand?.players.get(seat);
      const isOwn = viewer?.seat === seat;

      // A hand is shown to its owner always, and to everyone at a showdown —
      // the whole table sees them there when the table is in teaching mode.
      const reveal =
        inHand !== undefined &&
        (isOwn ||
          (showdownVisible &&
            inHand.status !== "folded" &&
            (this.config.revealShowdown ||
              hand!.result!.showdown.some((e) => e.seat === seat && !e.mucked))));

      const showdownEntry = hand?.result?.showdown.find((e) => e.seat === seat);

      seats.push({
        seat,
        playerId: player?.id ?? null,
        name: player?.name ?? null,
        kind: player?.kind ?? null,
        stack: player?.stack ?? 0,
        sittingOut: player?.sittingOut ?? false,
        connected: player?.connected ?? false,
        holeCards: reveal ? inHand!.holeCards.map(cardToString) : null,
        hiddenCards: inHand && !reveal && inHand.status !== "folded" ? inHand.holeCards.length : 0,
        inHand: inHand !== undefined,
        status: inHand?.status ?? null,
        committed: inHand?.committed ?? 0,
        isButton: this.buttonSeat === seat && hand !== null,
        isActing: hand?.actingSeat === seat,
        handDescription: reveal ? (showdownEntry?.handDescription ?? null) : null,
      });
    }

    const legalActions =
      viewer && hand && !hand.isComplete ? hand.legalActions(viewer.seat) : null;

    return {
      id: this.config.id,
      name: this.config.name,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      ante: this.config.ante,
      maxSeats: this.config.maxSeats,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      coaching: this.config.coaching,
      actionTimeoutMs: this.config.actionTimeoutMs,
      handNumber: this.handNumber,
      handId: hand?.handId ?? null,
      street: hand && !hand.isComplete ? hand.street : hand ? "complete" : "idle",
      board: hand?.board.map(cardToString) ?? [],
      pot: hand?.pot ?? 0,
      pots: hand?.isComplete ? (hand.result?.pots ?? []) : (hand?.buildPots() ?? []),
      buttonSeat: this.buttonSeat,
      actingSeat: hand?.actingSeat ?? null,
      actionDeadline: this.actionDeadline,
      seats,
      youSeat: viewer?.seat ?? null,
      legalActions,
      log: this.log.slice(-40),
      waitingFor: this.waitingFor(now),
    };
  }

  private waitingFor(_now: number): string | null {
    if (this.hand && !this.hand.isComplete) {
      const seat = this.hand.actingSeat;
      if (seat === null) return "dealing";
      return `${this.playerAtSeat(seat)?.name ?? `seat ${seat + 1}`} to act`;
    }
    const ready = this.readyPlayers.length;
    if (ready < 2) return `waiting for players (${ready}/2)`;
    return "next hand";
  }

  // ---------------------------------------------------------------- commentary

  private note(line: string): void {
    this.log.push(line);
    while (this.log.length > MAX_LOG) this.log.shift();
  }

  /** Turns an engine event into a line of table talk. */
  private describe(event: HandEvent): void {
    const name = (seat: number) => this.playerAtSeat(seat)?.name ?? `Seat ${seat + 1}`;
    switch (event.type) {
      case "post":
        this.note(
          `${name(event.seat)} posts the ${event.blind === "ante" ? "ante" : `${event.blind} blind`} (${event.amount})`,
        );
        break;
      case "action": {
        const verb: Record<string, string> = {
          fold: "folds",
          check: "checks",
          call: `calls ${event.amount}`,
          bet: `bets ${event.total}`,
          raise: `raises to ${event.total}`,
        };
        const allIn = this.hand?.players.get(event.seat)?.status === "all-in";
        this.note(`${name(event.seat)} ${verb[event.action] ?? event.action}${allIn ? " and is all in" : ""}`);
        break;
      }
      case "street":
        this.note(
          `${event.street[0]!.toUpperCase()}${event.street.slice(1)}: ${event.cards.map(cardToString).join(" ")} — pot ${event.pot}`,
        );
        break;
      case "uncalled-returned":
        this.note(`${event.amount} returned to ${name(event.seat)} (uncalled)`);
        break;
      case "showdown":
        for (const entry of event.entries) {
          this.note(`${name(entry.seat)} shows ${entry.handDescription}`);
        }
        break;
      case "payout":
        this.note(`${name(event.seat)} wins ${event.amount}`);
        break;
      default:
        break;
    }
  }
}
