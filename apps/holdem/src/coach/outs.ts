/**
 * Outs: the unseen cards that would improve the hand.
 *
 * "Improve" here means *lifts the hand into a higher category* — a flush draw's
 * nine flush cards, an open-ender's eight straight cards, the two cards that
 * turn a pair into trips. That is the definition beginners are taught and the
 * one the rule of two and four is calibrated against. It deliberately ignores
 * whether the improvement is actually good enough to win, which is why the coach
 * always shows real equity next to the out count rather than instead of it.
 */

import { cardToString, fullDeck, type Card } from "../engine/cards.js";
import { CATEGORY_NAMES, evaluate, HandCategory } from "../engine/handRank.js";
import { rankOf, suitOf } from "../engine/cards.js";

export interface OutGroup {
  /** What these cards make, e.g. "Flush". */
  makes: string;
  cards: string[];
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

  const current = evaluate([...hole, ...board]);
  const seen = new Set([...hole, ...board]);
  const grouped = new Map<string, string[]>();
  let count = 0;

  for (const card of fullDeck()) {
    if (seen.has(card)) continue;
    const improved = evaluate([...hole, ...board, card]);
    if (improved.category <= current.category) continue;

    // A card that improves the board equally for everyone is not an out for us.
    // Pairing the board on the flop is the common case: an eight landing on
    // A-8-4 gives every player a pair of eights, so it is nobody's out.
    if (improved.category <= boardCategory([...board, card])) continue;

    count++;
    const label = CATEGORY_NAMES[improved.category];
    const bucket = grouped.get(label) ?? [];
    bucket.push(cardToString(card));
    grouped.set(label, bucket);
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
function boardCategory(cards: readonly Card[]): HandCategory {
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
