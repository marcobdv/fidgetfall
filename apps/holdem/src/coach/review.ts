/**
 * Post-hand review.
 *
 * Replays a finished hand from its event log, recomputes the player's equity at
 * each of their own decisions, and picks out the one that mattered most. The
 * point is not to grade — it is to show the player the number they could not see
 * at the time, next to the price they were being offered.
 */

import { parseCards } from "../engine/cards.js";
import type { CompletedHand } from "../engine/table.js";
import type { Street } from "../engine/types.js";
import { equityVsRandom } from "./equity.js";
import { pressureOf } from "./pressure.js";

export interface ReviewMoment {
  street: Street;
  action: string;
  /** Chips the action cost. */
  amount: number;
  toCall: number;
  potBefore: number;
  board: string[];
  equityPct: number;
  breakEvenPct: number | null;
  /** Non-null when the action ran against the pot odds on offer. */
  verdict: "good" | "thin" | "loose" | "tight" | "neutral";
  note: string;
}

export interface HandReview {
  handNumber: number;
  seat: number;
  holeCards: string[];
  board: string[];
  net: number;
  moments: ReviewMoment[];
  /** The decision that moved the most chips, or the clearest mistake. */
  keyMoment: ReviewMoment | null;
  summary: string;
}

/** Builds a review of `seat`'s play in a finished hand. */
export function reviewHand(hand: CompletedHand, seat: number, opponentsAtStart?: number): HandReview | null {
  const hole = hand.holeCards[seat];
  if (!hole || hole.length !== 2) return null;

  const holeCards = parseCards(hole.join(""));
  const moments: ReviewMoment[] = [];

  let board: string[] = [];
  let street: Street = "preflop";
  // Seats dealt in, minus the ones that have folded, tells us how many hands we
  // were actually up against at each decision.
  let live = new Set<number>(Object.keys(hand.holeCards).map(Number));

  for (const event of hand.events) {
    if (event.type === "street") {
      street = event.street;
      board = [...board, ...event.cards.map(cardCode)];
      continue;
    }
    if (event.type !== "action") continue;

    if (event.seat === seat) {
      const opponents = Math.max(1, live.size - 1);
      const equity = equityVsRandom(holeCards, parseCards(board.join("")), opponents, {
        samples: 1500,
        seed: hand.seed ^ (moments.length + 1),
      });
      const breakEven =
        event.toCall > 0 ? event.toCall / (event.potBefore + event.toCall) : null;

      moments.push(
        judge(
          {
            street,
            action: event.action,
            amount: event.amount,
            toCall: event.toCall,
            potBefore: event.potBefore,
            board: [...board],
            equityPct: equity.equity * 100,
            breakEvenPct: breakEven === null ? null : breakEven * 100,
          },
          event.stackBefore,
        ),
      );
    }

    if (event.action === "fold") live.delete(event.seat);
  }

  const net = hand.result.net[seat] ?? 0;
  const keyMoment = pickKeyMoment(moments);

  return {
    handNumber: hand.handNumber,
    seat,
    holeCards: hole,
    board: hand.board,
    net,
    moments,
    keyMoment,
    summary: summarise(moments, keyMoment, net),
  };
}

function cardCode(card: number): string {
  return "23456789TJQKA"[card >> 2]! + "cdhs"[card & 3]!;
}

/**
 * Grades one decision. Exported because this is the review's standard, and a
 * standard is worth testing directly rather than through a played-out hand.
 *
 * `stackBefore` matters: the same 400-chip call is a routine bet with 4000
 * behind and a stack-off with 500, and the live coach can tell the difference.
 * Without it a review would grade a shove by a softer bar than the coach applied
 * at the time — which is precisely the contradiction this module exists to stop.
 */
export function judge(
  base: Omit<ReviewMoment, "verdict" | "note">,
  stackBefore?: number,
): ReviewMoment {
  const { action, equityPct, breakEvenPct, toCall } = base;
  const pressure = pressureOf({ toCall, pot: base.potBefore, stack: stackBefore });
  const demanded = (breakEvenPct ?? 0) + pressure.margin * 100;

  if (breakEvenPct === null) {
    // Nothing to call: the only question is whether a check gave up value.
    if (action === "check" && equityPct > 65) {
      return {
        ...base,
        verdict: "tight",
        note: `You checked with about ${Math.round(equityPct)}% equity. A hand that good wants chips in the pot — betting here is where the profit is.`,
      };
    }
    return {
      ...base,
      verdict: "neutral",
      note: `${capitalise(action)} with about ${Math.round(equityPct)}% equity and nothing to call.`,
    };
  }

  const margin = equityPct - breakEvenPct;

  if (action === "fold") {
    // A fold is right when the equity was short of the bar. Above it the fold
    // gave something up — by a lot, or by a little. Calling that "right" and
    // then quoting numbers that say otherwise is how a review loses its reader.
    const surplus = equityPct - demanded;
    if (surplus > 12) {
      return {
        ...base,
        verdict: "tight",
        note: `You folded for ${toCall} when you needed ${Math.round(demanded)}% and had about ${Math.round(equityPct)}%. That fold gave up a profitable call.`,
      };
    }
    if (surplus > 0) {
      return {
        ...base,
        verdict: "thin",
        note: `Folding for ${toCall} was close: you had about ${Math.round(equityPct)}% against a ${Math.round(demanded)}% bar, so calling was defensible too.`,
      };
    }
    return {
      ...base,
      verdict: "good",
      note: `Folding for ${toCall} was right: you needed ${Math.round(demanded)}% and had about ${Math.round(equityPct)}%.`,
    };
  }

  if (action === "call" || action === "raise" || action === "bet") {
    const adjusted = margin - pressure.margin * 100;
    if (adjusted < -12) {
      return {
        ...base,
        verdict: "loose",
        note: `You put in ${base.amount} needing ${Math.round(demanded)}% with only about ${Math.round(equityPct)}%. This is the leak that costs the most over time.`,
      };
    }
    if (adjusted < 3) {
      return {
        ...base,
        verdict: "thin",
        note:
          `A close one: ${Math.round(equityPct)}% against a ${Math.round(breakEvenPct)}% price` +
          (pressure.margin > 0
            ? `, and a bet that size means a stronger range than random — nearer ${Math.round(demanded)}% in practice. Defensible, but nothing to rely on.`
            : ". Defensible, but nothing to rely on."),
      };
    }
    return {
      ...base,
      verdict: "good",
      note: `Well priced: ${Math.round(equityPct)}% equity against a ${Math.round(demanded)}% bar.`,
    };
  }

  return { ...base, verdict: "neutral", note: `${capitalise(action)}.` };
}

/** The costliest mistake if there was one, otherwise the biggest decision. */
function pickKeyMoment(moments: ReviewMoment[]): ReviewMoment | null {
  if (moments.length === 0) return null;
  const mistakes = moments.filter((m) => m.verdict === "loose" || m.verdict === "tight");
  const pool = mistakes.length > 0 ? mistakes : moments;
  return pool.reduce((best, m) =>
    Math.max(m.amount, m.toCall) > Math.max(best.amount, best.toCall) ? m : best,
  );
}

function summarise(moments: ReviewMoment[], key: ReviewMoment | null, net: number): string {
  const outcome = net > 0 ? `You won ${net} chips.` : net < 0 ? `You lost ${-net} chips.` : "You broke even.";
  if (moments.length === 0) return `${outcome} You were never put to a decision.`;
  if (!key) return outcome;

  const goods = moments.filter((m) => m.verdict === "good").length;
  const shape =
    key.verdict === "loose"
      ? "The hand turned on one call that the price did not justify."
      : key.verdict === "tight"
        ? "The hand turned on one spot you gave up too early."
        : `${goods} of your ${moments.length} decision${moments.length === 1 ? "" : "s"} were clearly priced right.`;

  return `${outcome} ${shape} ${key.note}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
