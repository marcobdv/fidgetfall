/**
 * The counting drill: ask the player before telling them.
 *
 * The coach knows how to work out outs, the rule of two and four, and pot odds.
 * A player who reads those numbers off a panel learns to read a panel. This
 * turns each of them into a question first, marks the answer, and only then
 * shows the working — including, for outs, exactly which cards were missed and
 * which were counted that should not have been.
 *
 * Answers never leave the server before the player has committed to theirs. A
 * practice spot is identified by its seed and rebuilt here to be marked, so
 * there is nothing in the page to peek at. That is not a security boundary —
 * it is a learning aid, and the point is simply that the honest path is also
 * the easy one.
 */

import { type Card, cardToString, fullDeck, parseCards } from "../engine/cards.js";
import { describeHand, evaluate } from "../engine/handRank.js";
import { createRng, shuffle } from "../engine/rng.js";
import { classifyOut, countOuts } from "./outs.js";

/** A spot to be drilled, as the player sees it — no answers here. */
export interface DrillSpot {
  hole: string[];
  board: string[];
  pot: number;
  toCall: number;
  opponents: number;
  /** 2 on the flop, 1 on the turn. */
  cardsToCome: number;
  /** Every card the player could plausibly click, i.e. the unseen deck. */
  unseen: string[];
  /** Which questions apply to this spot. */
  asks: { outs: boolean; ruleOfThumb: boolean; potOdds: boolean };
  /** What the player already holds, so they are not also guessing that. */
  handNow: string;
}

export interface DrillAnswer {
  outs?: number;
  /** Optional: the specific cards the player believes are outs. */
  outCards?: string[];
  ruleOfThumbPct?: number;
  breakEvenPct?: number;
}

export interface MarkedNumber {
  asked: true;
  yours: number | null;
  correct: number;
  right: boolean;
  note: string;
}

export interface OutsMarking extends MarkedNumber {
  /** Outs the player did not count, and what each one makes. */
  missed: Array<{ card: string; makes: string }>;
  /** Cards the player counted that are not outs, and why not. */
  wrong: Array<{ card: string; why: string }>;
  /** The full truth, revealed only now. */
  groups: Array<{ makes: string; cards: string[] }>;
  /** Set when the player picked cards as well as a number. */
  cardsChecked: boolean;
}

export interface DrillMarking {
  outs?: OutsMarking;
  ruleOfThumb?: MarkedNumber;
  potOdds?: MarkedNumber;
  /** How many of the asked questions were right. */
  score: { right: number; asked: number };
}

/** Mental arithmetic deserves a little slack; the concept is what is tested. */
const PERCENT_TOLERANCE = 2;

export function drillQuestions(
  hole: readonly Card[],
  board: readonly Card[],
  pot: number,
  toCall: number,
  opponents: number,
): DrillSpot {
  const seen = new Set([...hole, ...board]);
  const cardsToCome = Math.max(0, Math.min(2, 5 - board.length));
  const canCount = board.length >= 3 && cardsToCome > 0;

  return {
    hole: hole.map(cardToString),
    board: board.map(cardToString),
    pot,
    toCall,
    opponents,
    cardsToCome,
    unseen: fullDeck()
      .filter((card) => !seen.has(card))
      .map(cardToString),
    asks: {
      outs: canCount,
      ruleOfThumb: canCount,
      potOdds: toCall > 0,
    },
    handNow: board.length >= 3 ? describeHand(evaluate([...hole, ...board])) : "nothing made yet",
  };
}

/** True when a spot has at least one question worth asking. */
export function isDrillable(spot: DrillSpot): boolean {
  return spot.asks.outs || spot.asks.potOdds;
}

export function markDrill(
  hole: readonly Card[],
  board: readonly Card[],
  pot: number,
  toCall: number,
  answer: DrillAnswer,
): DrillMarking {
  const spot = drillQuestions(hole, board, pot, toCall, 1);
  const truth = countOuts(hole, board);
  const marking: DrillMarking = { score: { right: 0, asked: 0 } };

  if (spot.asks.outs) {
    marking.outs = markOuts(hole, board, truth, answer);
    marking.score.asked++;
    if (marking.outs.right) marking.score.right++;
  }

  if (spot.asks.ruleOfThumb) {
    marking.ruleOfThumb = markRuleOfThumb(truth, answer, spot.cardsToCome);
    marking.score.asked++;
    if (marking.ruleOfThumb.right) marking.score.right++;
  }

  if (spot.asks.potOdds) {
    marking.potOdds = markPotOdds(pot, toCall, answer);
    marking.score.asked++;
    if (marking.potOdds.right) marking.score.right++;
  }

  return marking;
}

function markOuts(
  hole: readonly Card[],
  board: readonly Card[],
  truth: ReturnType<typeof countOuts>,
  answer: DrillAnswer,
): OutsMarking {
  const yours = answer.outs ?? null;

  const missed: OutsMarking["missed"] = [];
  const wrong: OutsMarking["wrong"] = [];

  // Marking the individual cards only makes sense if they picked some.
  const picked = answer.outCards ? new Set(answer.outCards) : null;
  if (picked) {
    for (const card of fullDeck()) {
      const code = cardToString(card);
      const verdict = classifyOut(hole, board, card);
      if (verdict.out && !picked.has(code)) missed.push({ card: code, makes: verdict.makes });
      if (!verdict.out && picked.has(code)) wrong.push({ card: code, why: verdict.explain });
    }
  }

  // When the cards were named, they have to be the right ones: arriving at the
  // right total by picking six wrong cards is not counting.
  const cardsRight = picked === null || (missed.length === 0 && wrong.length === 0);
  const right = yours === truth.count && cardsRight;

  return {
    asked: true,
    yours,
    correct: truth.count,
    right,
    cardsChecked: picked !== null,
    missed,
    wrong,
    groups: truth.groups,
    note: outsNote(yours, truth.count, missed, wrong),
  };
}

function outsNote(
  yours: number | null,
  correct: number,
  missed: OutsMarking["missed"],
  wrong: OutsMarking["wrong"],
): string {
  if (yours === null) return `${correct} outs.`;

  if (yours === correct) {
    // The right total reached with the wrong cards is a coincidence, not a
    // count. Saying "that is right" would teach exactly the wrong lesson.
    if (wrong.length === 0 && missed.length === 0) return `${correct} — that is right.`;
    return (
      `${correct} is the right number, but not the right cards: you counted ` +
      `${wrong.length} that do not help and missed ${missed.length} that do.`
    );
  }

  const boardPairers = wrong.filter((w) => /every player/.test(w.why)).length;
  if (yours > correct && boardPairers > 0) {
    return (
      `${correct}, not ${yours}. You counted ${boardPairers} card${boardPairers === 1 ? "" : "s"} ` +
      "that only pair the board — those help everyone equally, so they are nobody's out."
    );
  }
  if (yours > correct) {
    return `${correct}, not ${yours}. Some of what you counted does not actually lift your hand.`;
  }
  return `${correct}, not ${yours}. There is more here than you spotted.`;
}

function markRuleOfThumb(
  truth: ReturnType<typeof countOuts>,
  answer: DrillAnswer,
  cardsToCome: number,
): MarkedNumber {
  const yours = answer.ruleOfThumbPct ?? null;
  const correct = truth.ruleOfThumbPct;
  const multiplier = cardsToCome === 2 ? 4 : 2;
  const right = yours !== null && Math.abs(yours - correct) <= PERCENT_TOLERANCE;

  // Getting the arithmetic right on your own (wrong) out count is worth saying:
  // the method is the thing being taught, and it was applied correctly.
  const consistent =
    yours !== null &&
    answer.outs !== undefined &&
    Math.abs(yours - Math.min(100, answer.outs * multiplier)) <= PERCENT_TOLERANCE;

  return {
    asked: true,
    yours,
    correct,
    right,
    note: right
      ? `${truth.count} outs x ${multiplier} = ${correct}%.`
      : consistent
        ? `Your arithmetic was right — ${answer.outs} x ${multiplier} — but on the wrong out count. With ${truth.count} outs it is ${correct}%.`
        : `${truth.count} outs x ${multiplier} = ${correct}%, with ${cardsToCome} card${cardsToCome === 1 ? "" : "s"} to come.`,
  };
}

function markPotOdds(pot: number, toCall: number, answer: DrillAnswer): MarkedNumber {
  const yours = answer.breakEvenPct ?? null;
  const exact = (toCall / (pot + toCall)) * 100;
  const correct = Math.round(exact);
  const right = yours !== null && Math.abs(yours - exact) <= PERCENT_TOLERANCE;

  return {
    asked: true,
    yours,
    correct,
    right,
    note:
      `You put in ${toCall} to win a pot that becomes ${pot + toCall}. ` +
      `${toCall} / ${pot + toCall} = ${correct}%.`,
  };
}

// ------------------------------------------------------------------ practice

/**
 * A practice spot built from a seed, so it can be handed out without its
 * answers and rebuilt identically for marking.
 *
 * Spots are rejected until they have something worth counting: a hand with no
 * draw teaches nothing, and a hand with twenty outs is a curiosity rather than a
 * lesson.
 */
export function practiceSpot(seed: number): DrillSpot {
  const rng = createRng(seed);

  for (let attempt = 0; attempt < 200; attempt++) {
    const deck = shuffle(fullDeck(), rng);
    const hole = deck.slice(0, 2);
    // Two thirds flop, one third turn, so both multipliers get practised.
    const boardSize = rng.next() < 0.66 ? 3 : 4;
    const board = deck.slice(2, 2 + boardSize);

    const outs = countOuts(hole, board);
    if (outs.count < 3 || outs.count > 15) continue;

    const pot = 40 + rng.nextInt(18) * 20;
    // A price between a fifth and a full pot — the band real decisions live in.
    const toCall = Math.max(10, Math.round((pot * (0.2 + rng.next() * 0.8)) / 10) * 10);
    return drillQuestions(hole, board, pot, toCall, 1);
  }

  // Vanishingly unlikely, but a drill that throws would be worse than an easy one.
  const deck = shuffle(fullDeck(), createRng(seed + 1));
  return drillQuestions(deck.slice(0, 2), deck.slice(2, 5), 100, 40, 1);
}

/** Rebuilds a practice spot from its seed and marks an attempt against it. */
export function markPracticeSpot(seed: number, answer: DrillAnswer): DrillMarking {
  const spot = practiceSpot(seed);
  return markDrill(
    parseCards(spot.hole.join("")),
    parseCards(spot.board.join("")),
    spot.pot,
    spot.toCall,
    answer,
  );
}
