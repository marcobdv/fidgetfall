/**
 * A single no-limit Texas Hold'em hand, from posting blinds to paying out.
 *
 * The hand is a pure state machine: it owns no I/O, no timers and no network.
 * Feed it actions with `act()` and it advances streets, builds side pots and
 * settles the showdown on its own. Everything it does is derived from the seed
 * it was constructed with, so a hand can be replayed exactly — which the tests
 * and the coach's post-hand review both rely on.
 *
 * Chip amounts are integers throughout. There are no fractional chips; odd
 * chips in a split pot go to the first eligible seat left of the button, which
 * is the standard house rule.
 */

import { type Card, fullDeck } from "./cards.js";
import { describeHand, evaluate } from "./handRank.js";
import { type Rng, createRng, shuffle } from "./rng.js";
import type {
  Action,
  ActionType,
  HandEvent,
  HandResult,
  LegalActions,
  PlayerStatus,
  Pot,
  PotShare,
  ShowdownEntry,
  Street,
} from "./types.js";

export interface HandSeat {
  seat: number;
  stack: number;
}

export interface HandConfig {
  handId: string;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  buttonSeat: number;
  seed: number;
  /** Seats in the hand with their starting stacks, in ascending seat order. */
  seats: HandSeat[];
}

export interface HandPlayer {
  seat: number;
  startingStack: number;
  stack: number;
  holeCards: Card[];
  status: PlayerStatus;
  /** Chips committed during the current betting round. */
  committed: number;
  /** Chips committed across the whole hand. */
  totalCommitted: number;
  /**
   * The bet level in force the last time this player acted this round, or null
   * if they have not acted yet. Drives both "has the round closed?" and "may
   * this player re-raise?" — a short all-in does not reopen the betting.
   */
  lastActedAtLevel: number | null;
}

/** Raised when an action is not legal in the current state. */
export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalActionError";
  }
}

export class PokerHand {
  readonly handId: string;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly ante: number;
  readonly buttonSeat: number;
  readonly players: Map<number, HandPlayer> = new Map();
  readonly events: HandEvent[] = [];

  board: Card[] = [];
  street: Street = "preflop";
  /** Seat to act, or null when no one is left to act on this street. */
  actingSeat: number | null = null;
  result: HandResult | null = null;

  /** Highest per-round contribution any player has made this round. */
  private betLevel = 0;
  /** Smallest legal raise increment on top of `betLevel`. */
  private minRaiseIncrement: number;
  /** Highest bet level created by a *full* bet or raise this round. */
  private fullRaiseLevel = 0;

  private readonly deck: Card[];
  private deckIndex = 0;
  private readonly order: number[];
  private readonly rng: Rng;

  constructor(config: HandConfig) {
    if (config.seats.length < 2) {
      throw new RangeError("a hand needs at least two seats");
    }
    if (config.smallBlind <= 0 || config.bigBlind < config.smallBlind) {
      throw new RangeError("blinds must be positive with bigBlind >= smallBlind");
    }

    this.handId = config.handId;
    this.smallBlind = config.smallBlind;
    this.bigBlind = config.bigBlind;
    this.ante = config.ante ?? 0;
    this.buttonSeat = config.buttonSeat;
    this.minRaiseIncrement = config.bigBlind;
    this.rng = createRng(config.seed);
    this.deck = shuffle(fullDeck(), this.rng);

    for (const { seat, stack } of config.seats) {
      if (stack <= 0) throw new RangeError(`seat ${seat} cannot play with a ${stack} stack`);
      this.players.set(seat, {
        seat,
        startingStack: stack,
        stack,
        holeCards: [],
        status: "active",
        committed: 0,
        totalCommitted: 0,
        lastActedAtLevel: null,
      });
    }

    // Seating order starting left of the button, which is the order every
    // postflop street acts in and the order odd chips are awarded in.
    const seats = [...this.players.keys()].sort((a, b) => a - b);
    const buttonIdx = seats.findIndex((s) => s === config.buttonSeat);
    if (buttonIdx < 0) throw new RangeError(`button seat ${config.buttonSeat} is not in the hand`);
    this.order = [...seats.slice(buttonIdx + 1), ...seats.slice(0, buttonIdx + 1)];

    this.begin(seats);
  }

  get isComplete(): boolean {
    return this.street === "complete";
  }

  get pot(): number {
    let total = 0;
    for (const player of this.players.values()) total += player.totalCommitted;
    return total;
  }

  /** Players who have not folded. All-in players are included. */
  get livePlayers(): HandPlayer[] {
    return [...this.players.values()].filter((p) => p.status !== "folded");
  }

  /** Players who can still put chips in — i.e. not folded and not all-in. */
  get actablePlayers(): HandPlayer[] {
    return [...this.players.values()].filter((p) => p.status === "active");
  }

  private begin(seats: number[]): void {
    this.emit({ type: "hand-start", handId: this.handId, buttonSeat: this.buttonSeat, seats });

    if (this.ante > 0) {
      // Antes are posted in seating order so a short stack's forced all-in is
      // deterministic rather than dependent on Map iteration order.
      for (const seat of this.order) {
        const player = this.players.get(seat)!;
        const amount = Math.min(this.ante, player.stack);
        this.commit(player, amount);
        this.emit({ type: "post", seat, amount, blind: "ante" });
      }
      // Antes are dead money: they belong to the pot, not to the bet level.
      this.resetRoundCommitments();
    }

    const [smallSeat, bigSeat] = this.blindSeats();
    this.postBlind(smallSeat, this.smallBlind, "small");
    this.postBlind(bigSeat, this.bigBlind, "big");

    // A short all-in blind does not lower the price: the field still owes a
    // full big blind, and the short blind's shortfall becomes a side pot.
    this.betLevel = Math.max(this.bigBlind, ...[...this.players.values()].map((p) => p.committed));
    this.minRaiseIncrement = this.bigBlind;
    this.fullRaiseLevel = this.betLevel;

    this.dealHoleCards();

    // Everyone might already be all-in from blinds and antes alone.
    this.actingSeat = this.bettingIsPossible() ? this.firstToActPreflop() : null;
    if (this.actingSeat === null) this.finishBettingRound();
  }

  /**
   * Whether any chips can still move this round. Two players who can act is the
   * usual case; one is enough only while they still owe chips to a bet they are
   * facing, which they must call or fold to.
   */
  private bettingIsPossible(): boolean {
    const active = this.actablePlayers;
    if (active.length >= 2) return true;
    return active.length === 1 && active[0]!.committed < this.betLevel;
  }

  /** Small-blind and big-blind seats. Heads-up, the button posts the small. */
  private blindSeats(): [number, number] {
    if (this.order.length === 2) {
      // `order` starts left of the button, so index 1 *is* the button.
      return [this.order[1]!, this.order[0]!];
    }
    return [this.order[0]!, this.order[1]!];
  }

  private postBlind(seat: number, amount: number, blind: "small" | "big"): void {
    const player = this.players.get(seat)!;
    const posted = Math.min(amount, player.stack);
    this.commit(player, posted);
    this.emit({ type: "post", seat, amount: posted, blind });
  }

  private dealHoleCards(): void {
    // Two rounds of one card each, as at a real table.
    for (let round = 0; round < 2; round++) {
      for (const seat of this.order) {
        this.players.get(seat)!.holeCards.push(this.draw());
      }
    }
    this.emit({ type: "deal-hole", seats: [...this.order] });
  }

  private draw(): Card {
    const card = this.deck[this.deckIndex];
    if (card === undefined) throw new Error("deck exhausted");
    this.deckIndex++;
    return card;
  }

  private firstToActPreflop(): number | null {
    const [, bigSeat] = this.blindSeats();
    // Action starts left of the big blind — which heads-up wraps back to the
    // button/small blind.
    return this.nextActor(bigSeat);
  }

  private firstToActPostflop(): number | null {
    return this.nextActor(this.buttonSeat);
  }

  /** Next seat after `fromSeat` in table order that can still act, or null. */
  private nextActor(fromSeat: number): number | null {
    const start = this.order.indexOf(fromSeat);
    for (let step = 1; step <= this.order.length; step++) {
      const seat = this.order[(start + step) % this.order.length]!;
      if (this.players.get(seat)!.status === "active") return seat;
    }
    return null;
  }

  private commit(player: HandPlayer, amount: number): void {
    if (amount <= 0) return;
    const paid = Math.min(amount, player.stack);
    player.stack -= paid;
    player.committed += paid;
    player.totalCommitted += paid;
    if (player.stack === 0) player.status = player.status === "folded" ? "folded" : "all-in";
  }

  private resetRoundCommitments(): void {
    for (const player of this.players.values()) {
      player.committed = 0;
      player.lastActedAtLevel = null;
    }
    this.betLevel = 0;
    this.minRaiseIncrement = this.bigBlind;
    this.fullRaiseLevel = 0;
  }

  private emit(event: HandEvent): void {
    this.events.push(event);
  }

  // ---------------------------------------------------------------- legality

  /** What `seat` may legally do, or null when it is not their turn. */
  legalActions(seat: number): LegalActions | null {
    if (this.actingSeat !== seat) return null;
    const player = this.players.get(seat);
    if (!player || player.status !== "active") return null;

    const toCall = Math.min(this.betLevel - player.committed, player.stack);
    const maxTo = player.committed + player.stack;
    const facingBet = this.betLevel > player.committed;

    // A short all-in raise does not reopen the betting for anyone who already
    // acted at that level.
    const mayAggress =
      player.lastActedAtLevel === null || this.fullRaiseLevel > player.lastActedAtLevel;

    // Raising does not require facing a bet: the big blind's option is a raise
    // over a bet it has already matched.
    const canBet = this.betLevel === 0 && mayAggress && player.stack > 0;
    const canRaise = this.betLevel > 0 && mayAggress && maxTo > this.betLevel;

    const minBet = Math.min(this.bigBlind, maxTo);
    const minRaiseTo = Math.min(this.betLevel + this.minRaiseIncrement, maxTo);

    return {
      seat,
      toCall,
      canFold: true,
      canCheck: !facingBet,
      canCall: facingBet,
      canBet,
      canRaise,
      minBet,
      maxBet: canBet ? maxTo : 0,
      minRaiseTo,
      maxRaiseTo: canRaise ? maxTo : 0,
      allInOnly: (canBet && minBet >= maxTo) || (canRaise && minRaiseTo >= maxTo),
    };
  }

  // ------------------------------------------------------------------ acting

  /**
   * Applies `action` for `seat` and advances the hand as far as it can go —
   * through street changes, an all-in runout, and settlement.
   */
  act(seat: number, action: Action): void {
    if (this.isComplete) throw new IllegalActionError("the hand is already complete");
    if (this.actingSeat !== seat) {
      throw new IllegalActionError(
        this.actingSeat === null
          ? `seat ${seat} cannot act: no one is to act`
          : `seat ${seat} cannot act: it is seat ${this.actingSeat}'s turn`,
      );
    }

    const player = this.players.get(seat)!;
    const legal = this.legalActions(seat)!;
    const potBefore = this.pot;
    const stackBefore = player.stack;

    let recordedAmount = 0;

    switch (action.type) {
      case "fold": {
        player.status = "folded";
        break;
      }
      case "check": {
        if (!legal.canCheck) {
          throw new IllegalActionError(`seat ${seat} cannot check facing a bet of ${legal.toCall}`);
        }
        break;
      }
      case "call": {
        if (!legal.canCall) throw new IllegalActionError(`seat ${seat} has nothing to call`);
        recordedAmount = legal.toCall;
        this.commit(player, legal.toCall);
        break;
      }
      case "bet":
      case "raise": {
        recordedAmount = this.applyAggression(player, legal, action);
        break;
      }
      default:
        throw new IllegalActionError(`unknown action ${JSON.stringify((action as Action).type)}`);
    }

    player.lastActedAtLevel = this.betLevel;

    this.emit({
      type: "action",
      seat,
      action: action.type as ActionType,
      amount: recordedAmount,
      total: player.committed,
      stackBefore,
      toCall: legal.toCall,
      potBefore,
      street: this.street,
    });

    this.advance();
  }

  /** Shared bet/raise handling. Returns the chips added to the pot. */
  private applyAggression(player: HandPlayer, legal: LegalActions, action: Action): number {
    const isBet = action.type === "bet";
    if (isBet && !legal.canBet) {
      throw new IllegalActionError(
        this.betLevel > 0
          ? `seat ${player.seat} must raise, not bet — there is already a bet of ${this.betLevel}`
          : `seat ${player.seat} cannot bet`,
      );
    }
    if (!isBet && !legal.canRaise) {
      throw new IllegalActionError(
        this.betLevel === 0
          ? `seat ${player.seat} must bet, not raise — there is no bet to raise`
          : `seat ${player.seat} cannot raise (the betting is not open to them)`,
      );
    }

    const target = action.amount;
    if (typeof target !== "number" || !Number.isFinite(target)) {
      throw new IllegalActionError(`${action.type} needs an amount (total chips in for this round)`);
    }
    if (!Number.isInteger(target)) {
      throw new IllegalActionError(`${action.type} amount must be a whole number of chips`);
    }

    const maxTo = player.committed + player.stack;
    const minTo = isBet ? legal.minBet : legal.minRaiseTo;

    if (target > maxTo) {
      throw new IllegalActionError(
        `seat ${player.seat} cannot ${action.type} to ${target}: only ${maxTo} available`,
      );
    }
    // Anything below the minimum is legal only as an all-in for the full stack.
    if (target < minTo && target !== maxTo) {
      throw new IllegalActionError(
        `seat ${player.seat} must ${action.type} to at least ${minTo} (or all in for ${maxTo})`,
      );
    }

    const added = target - player.committed;
    const previousLevel = this.betLevel;
    this.commit(player, added);

    this.betLevel = Math.max(this.betLevel, player.committed);
    const increment = this.betLevel - previousLevel;
    if (increment >= this.minRaiseIncrement) {
      this.minRaiseIncrement = increment;
      this.fullRaiseLevel = this.betLevel;
    }

    return added;
  }

  // --------------------------------------------------------------- advancing

  private advance(): void {
    // Everyone but one player folded — the hand is over without a showdown.
    if (this.livePlayers.length === 1) {
      this.actingSeat = null;
      this.settle();
      return;
    }

    const next = this.nextToAct();
    if (next !== null) {
      this.actingSeat = next;
      return;
    }
    this.finishBettingRound();
  }

  /**
   * The next seat that still owes an action this round, or null when the round
   * has closed. A player owes an action if they have not acted at the current
   * bet level, or have acted but are short of it.
   */
  private nextToAct(): number | null {
    const from = this.actingSeat;
    if (from === null) return null;
    const start = this.order.indexOf(from);
    for (let step = 1; step <= this.order.length; step++) {
      const seat = this.order[(start + step) % this.order.length]!;
      const player = this.players.get(seat)!;
      if (player.status !== "active") continue;
      if (player.lastActedAtLevel === null || player.committed < this.betLevel) return seat;
    }
    return null;
  }

  private finishBettingRound(): void {
    this.actingSeat = null;
    this.returnUncalled();
    this.resetRoundCommitments();

    if (this.street === "river") {
      this.settle();
      return;
    }

    // With no further betting possible, the rest of the board just runs out.
    const runout = !this.bettingIsPossible();
    this.dealNextStreet();

    if (runout) {
      this.runOutBoard();
      this.settle();
      return;
    }

    this.actingSeat = this.bettingIsPossible() ? this.firstToActPostflop() : null;
    if (this.actingSeat === null) {
      // Nobody left who can act; run the rest of the board out.
      this.runOutBoard();
      this.settle();
    }
  }

  /** Deals every remaining board card, for when no one can act any more. */
  private runOutBoard(): void {
    while ((this.street as Street) !== "river") this.dealNextStreet();
  }

  private dealNextStreet(): void {
    const next: Street =
      this.street === "preflop" ? "flop" : this.street === "flop" ? "turn" : "river";
    const count = next === "flop" ? 3 : 1;

    this.draw(); // burn card, as at a real table
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) cards.push(this.draw());

    this.board.push(...cards);
    this.street = next;
    this.emit({ type: "street", street: next, cards, pot: this.pot });
  }

  /**
   * Returns the portion of the last bet nobody could cover. Without this the
   * uncalled chips would sit in a one-player side pot; refunding them keeps the
   * pot equal to what is actually contested.
   */
  private returnUncalled(): void {
    const contributions = [...this.players.values()]
      .map((p) => p.committed)
      .sort((a, b) => b - a);
    const top = contributions[0] ?? 0;
    const second = contributions[1] ?? 0;
    if (top <= second) return;

    const owner = [...this.players.values()].find((p) => p.committed === top);
    if (!owner) return;

    const refund = top - second;
    owner.stack += refund;
    owner.committed -= refund;
    owner.totalCommitted -= refund;
    // Refunding a shove leaves the player with chips again, so they are no
    // longer all-in.
    if (owner.status === "all-in" && owner.stack > 0) owner.status = "active";
    this.emit({ type: "uncalled-returned", seat: owner.seat, amount: refund });
  }

  // -------------------------------------------------------------- settlement

  /** Splits the hand's contributions into a main pot and any side pots. */
  buildPots(): Pot[] {
    const contributors = [...this.players.values()].filter((p) => p.totalCommitted > 0);
    const levels = [...new Set(contributors.map((p) => p.totalCommitted))].sort((a, b) => a - b);

    const pots: Pot[] = [];
    let previous = 0;
    for (const level of levels) {
      let amount = 0;
      const eligible: number[] = [];
      for (const player of this.players.values()) {
        amount += Math.min(player.totalCommitted, level) - Math.min(player.totalCommitted, previous);
        if (player.status !== "folded" && player.totalCommitted >= level) eligible.push(player.seat);
      }
      if (amount > 0) pots.push({ amount, eligible: eligible.sort((a, b) => a - b) });
      previous = level;
    }

    // Consecutive pots with the same contenders are one pot as far as anyone
    // watching is concerned; merging them keeps the UI honest.
    const merged: Pot[] = [];
    for (const pot of pots) {
      const last = merged[merged.length - 1];
      if (last && sameSeats(last.eligible, pot.eligible)) last.amount += pot.amount;
      else merged.push(pot);
    }
    return merged;
  }

  private settle(): void {
    this.returnUncalled();

    const pots = this.buildPots();
    const live = this.livePlayers;
    const contested = live.length > 1;
    this.street = contested ? "showdown" : "complete";

    const showdown: ShowdownEntry[] = [];
    const scores = new Map<number, { score: number; description: string; cards: Card[] }>();

    if (contested) {
      for (const player of live) {
        const value = evaluate([...player.holeCards, ...this.board]);
        scores.set(player.seat, {
          score: value.score,
          description: describeHand(value),
          cards: value.cards,
        });
      }
    }

    const payouts: PotShare[] = [];
    const won = new Map<number, number>();

    pots.forEach((pot, potIndex) => {
      const contenders = pot.eligible.filter((seat) => this.players.get(seat)!.status !== "folded");
      if (contenders.length === 0) return;

      let winners: number[];
      if (!contested || contenders.length === 1) {
        winners = [contenders[0]!];
      } else {
        const best = Math.max(...contenders.map((seat) => scores.get(seat)!.score));
        winners = contenders.filter((seat) => scores.get(seat)!.score === best);
      }

      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;

      // Odd chips go to the winners nearest the button's left, in order.
      const byPosition = this.order.filter((seat) => winners.includes(seat));
      for (const seat of byPosition) {
        let amount = share;
        if (remainder > 0) {
          amount += 1;
          remainder -= 1;
        }
        this.players.get(seat)!.stack += amount;
        won.set(seat, (won.get(seat) ?? 0) + amount);
        payouts.push({ seat, amount });
        this.emit({ type: "payout", seat, amount, potIndex });
      }
    });

    if (contested) {
      // Show in showdown order: last aggressor first would need betting history,
      // so we use table order and muck hands that cannot win any pot they are in.
      const winningSeats = new Set(payouts.map((p) => p.seat));
      for (const seat of this.order) {
        const player = this.players.get(seat);
        if (!player || player.status === "folded") continue;
        const value = scores.get(seat)!;
        const mucked = !winningSeats.has(seat);
        showdown.push({
          seat,
          holeCards: [...player.holeCards],
          handScore: value.score,
          handDescription: value.description,
          bestCards: value.cards,
          mucked,
        });
      }
      this.emit({ type: "showdown", entries: showdown });
    }

    const net: Record<number, number> = {};
    for (const player of this.players.values()) {
      net[player.seat] = player.stack - player.startingStack;
    }

    this.street = "complete";
    this.result = { pots, payouts, showdown, net };
    this.emit({ type: "hand-end", net });
  }
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((seat, i) => seat === b[i]);
}
