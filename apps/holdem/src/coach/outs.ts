/**
 * Outs: the unseen cards that would improve the hand.
 *
 * "Improve" here means *lifts the hand into a higher category* — a flush draw's
 * nine flush cards, an open-ender's eight straight cards, the two cards that
 * turn a pair into trips. That is the definition beginners are taught and the
 * one the rule of two and four is calibrated against. It deliberately ignores
 * whether the improvement is actually good enough to win, which is why the coach
 * always shows real equity next to the out count rather than instead of it.
 *
 * `classifyOut` is the single judgement of whether one card counts, and both the
 * tally below and the drill's per-card feedback go through it. Teaching a player
 * a rule the coach does not itself follow would be worse than not teaching.
 */

import { cardToString, fullDeck, type Card } from "../engine/cards.js";
import { CATEGORY_NAMES, evaluate, HandCategory } from "../engine/handRank.js";
import { rankOf, suitOf } from "../engine/cards.js";

export interface OutGroup {
  /** What these cards make, e.g. "Flush". */
  makes: string;
  cards: string[];
}

/** Why one specific card does or does not count as an out. */
export type OutVerdict =
  | { out: true; makes: string }
  | { out: false; reason: "seen" | "no-improvement" | "board-pairs"; explain: string };

/** Judges a single card. The tally and the drill feedback both use this. */
export function classifyOut(
  hole: readonly Card[],
  board: readonly Card[],
  card: Card,
): OutVerdict {
  if ([...hole, ...board].includes(card)) {
    return { out: false, reason: "seen", explain: "that card is already on the table." };
  }

  const current = evaluate([...hole, ...board]);
  const improved = evaluate([...hole, ...board, card]);

  if (improved.category <= current.category) {
    return {
      out: false,
      reason: "no-improvement",
      explain: `it leaves you with ${CATEGORY_NAMES[current.category].toLowerCase()} — no better than you already hold.`,
    };
  }

  // A card that improves the board equally for everyone is not an out for us.
  // Pairing the board on the flop is the common case: an eight landing on
  // A-8-4 gives every player a pair of eights, so it is nobody's out.
  if (improved.category <= boardCategory([...board, card])) {
    return {
      out: false,
      reason: "board-pairs",
      explain:
        `it makes ${CATEGORY_NAMES[improved.category].toLowerCase()} out of the board itself, ` +
        "so every player still in the hand gets exactly the same thing.",
    };
  }

  return { out: true, makes: CATEGORY_NAMES[improved.category] };
}

export interface OutsResult {
  count: number;
  groups: OutGroup[];
  /** Rough equity from the rule of two and four, as a percentage. */
  ruleOfThumbPct: number;
  cardsToCome: number;
}

export function countOuts(hole: readonly Card[], board: readonly Card[]): OutsResult {
  const cardsToCome = Math.max(0, Math.min(2, 5 - board.length));
  if (board.length < 3 || cardsToCome === 0) {
    return { count: 0, groups: [], ruleOfThumbPct: 0, cardsToCome };
  }

  const grouped = new Map<string, string[]>();
  let count = 0;

  for (const card of fullDeck()) {
    const verdict = classifyOut(hole, board, card);
    if (!verdict.out) continue;

    count++;
    const bucket = grouped.get(verdict.makes) ?? [];
    bucket.push(cardToString(card));
    grouped.set(verdict.makes, bucket);
  }

  const groups = [...grouped.entries()]
    .map(([makes, cards]) => ({ makes, cards: cards.sort(byRankDescending) }))
    .sort((a, b) => b.cards.length - a.cards.length);

  return {
    count,
    groups,
    // The rule of two and four: outs x 4 with two cards to come, x 2 with one.
    ruleOfThumbPct: Math.min(100, count * (cardsToCome === 2 ? 4 : 2)),
    cardsToCome,
  };
}

const RANK_ORDER = "23456789TJQKA";

/**
 * The best category the board alone offers, for any number of cards.
 *
 * `evaluate` needs five, and a flop plus one card is only four — so this counts
 * ranks and suits directly. Straights and flushes are impossible below five
 * cards, which is why only the counting categories appear here.
 */
export function boardCategory(cards: readonly Card[]): HandCategory {
  if (cards.length >= 5) return evaluate(cards).category;

  const rankCounts = new Map<number, number>();
  const suitCounts = new Map<number, number>();
  for (const card of cards) {
    rankCounts.set(rankOf(card), (rankCounts.get(rankOf(card)) ?? 0) + 1);
    suitCounts.set(suitOf(card), (suitCounts.get(suitOf(card)) ?? 0) + 1);
  }

  const counts = [...rankCounts.values()].sort((a, b) => b - a);
  if (counts[0] === 4) return HandCategory.FourOfAKind;
  if (counts[0] === 3 && (counts[1] ?? 0) >= 2) return HandCategory.FullHouse;
  if (counts[0] === 3) return HandCategory.ThreeOfAKind;
  if (counts[0] === 2 && (counts[1] ?? 0) === 2) return HandCategory.TwoPair;
  if (counts[0] === 2) return HandCategory.Pair;
  return HandCategory.HighCard;
}

function byRankDescending(a: string, b: string): number {
  const rank = (text: string) => RANK_ORDER.indexOf(text[0]!.toUpperCase());
  return rank(b) - rank(a) || a.localeCompare(b);
}
