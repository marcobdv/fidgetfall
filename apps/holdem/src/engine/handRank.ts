/**
 * Seven-card hand evaluation.
 *
 * Evaluation is direct (rank/suit histograms) rather than by enumerating the 21
 * five-card subsets, so a showdown costs a handful of loops. The result is a
 * single comparable integer plus the five cards that make the hand, which the
 * UI and the coach both want to show.
 *
 *     score = category << 20 | k1 << 16 | k2 << 12 | k3 << 8 | k4 << 4 | k5
 *
 * Kickers are rank indexes (0 = deuce .. 12 = ace) in descending significance,
 * zero-padded for categories that need fewer than five. Higher score wins;
 * equal scores are an exact tie, which is what split pots are built on.
 */

import { type Card, RANKS, rankOf, suitOf } from "./cards.js";

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: "High card",
  [HandCategory.Pair]: "Pair",
  [HandCategory.TwoPair]: "Two pair",
  [HandCategory.ThreeOfAKind]: "Three of a kind",
  [HandCategory.Straight]: "Straight",
  [HandCategory.Flush]: "Flush",
  [HandCategory.FullHouse]: "Full house",
  [HandCategory.FourOfAKind]: "Four of a kind",
  [HandCategory.StraightFlush]: "Straight flush",
};

export interface HandValue {
  /** Comparable score; higher is better. */
  score: number;
  category: HandCategory;
  /** Rank indexes in descending significance (length 1..5, category-dependent). */
  kickers: number[];
  /** The exact five cards that make the hand. */
  cards: Card[];
}

const RANK_NAMES = [
  "deuce", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "jack", "queen", "king", "ace",
] as const;

const RANK_PLURALS = [
  "deuces", "threes", "fours", "fives", "sixes", "sevens", "eights",
  "nines", "tens", "jacks", "queens", "kings", "aces",
] as const;

export function rankName(rank: number): string {
  return RANK_NAMES[rank] ?? RANKS[rank] ?? "?";
}

export function rankPlural(rank: number): string {
  return RANK_PLURALS[rank] ?? `${RANKS[rank] ?? "?"}s`;
}

function makeScore(category: HandCategory, kickers: readonly number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = (score << 4) | (kickers[i] ?? 0);
  return score;
}

/**
 * Highest straight in a 13-bit rank mask, as the rank index of its top card, or
 * -1 for none. The wheel (A-5-4-3-2) reports 3 — the five — which is what makes
 * it the lowest straight.
 */
export function straightHigh(rankMask: number): number {
  for (let top = 12; top >= 4; top--) {
    const window = 0b11111 << (top - 4);
    if ((rankMask & window) === window) return top;
  }
  const WHEEL = (1 << 12) | 0b1111; // ace + five..deuce
  return (rankMask & WHEEL) === WHEEL ? 3 : -1;
}

/** Evaluates 5, 6 or 7 cards and returns the best five-card hand among them. */
export function evaluate(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new RangeError(`evaluate() needs 5-7 cards, got ${cards.length}`);
  }

  const rankCounts = new Array<number>(13).fill(0);
  const suitCounts = new Array<number>(4).fill(0);
  let rankMask = 0;

  for (const card of cards) {
    rankCounts[rankOf(card)]!++;
    suitCounts[suitOf(card)]!++;
    rankMask |= 1 << rankOf(card);
  }

  const flushSuit = suitCounts.findIndex((count) => count >= 5);

  // Straight flush — only possible in the flush suit, so check it there first.
  if (flushSuit >= 0) {
    const suited = cards.filter((card) => suitOf(card) === flushSuit);
    let suitedMask = 0;
    for (const card of suited) suitedMask |= 1 << rankOf(card);

    const sfHigh = straightHigh(suitedMask);
    if (sfHigh >= 0) {
      return finish(HandCategory.StraightFlush, [sfHigh], straightCards(suited, sfHigh));
    }

    const topFive = suited
      .map(rankOf)
      .sort((a, b) => b - a)
      .slice(0, 5);
    return finish(HandCategory.Flush, topFive, pickByRanks(suited, topFive));
  }

  const byCount = (count: number): number[] =>
    rankCounts
      .map((c, rank) => (c === count ? rank : -1))
      .filter((rank) => rank >= 0)
      .sort((a, b) => b - a);

  const quads = byCount(4);
  const trips = byCount(3);
  const pairs = byCount(2);

  if (quads.length > 0) {
    const quad = quads[0]!;
    const kicker = highestExcluding(rankCounts, [quad], 1);
    return finish(HandCategory.FourOfAKind, [quad, ...kicker], [
      ...pickByRanks(cards, [quad, quad, quad, quad]),
      ...pickByRanks(cards, kicker),
    ]);
  }

  // Two sets of trips make a full house with the lower set playing as the pair.
  if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
    const trip = trips[0]!;
    const pair = trips.length > 1 ? trips[1]! : pairs[0]!;
    return finish(HandCategory.FullHouse, [trip, pair], [
      ...pickByRanks(cards, [trip, trip, trip]),
      ...pickByRanks(cards, [pair, pair]),
    ]);
  }

  const straight = straightHigh(rankMask);
  if (straight >= 0) {
    return finish(HandCategory.Straight, [straight], straightCards(cards, straight));
  }

  if (trips.length > 0) {
    const trip = trips[0]!;
    const kickers = highestExcluding(rankCounts, [trip], 2);
    return finish(HandCategory.ThreeOfAKind, [trip, ...kickers], [
      ...pickByRanks(cards, [trip, trip, trip]),
      ...pickByRanks(cards, kickers),
    ]);
  }

  if (pairs.length >= 2) {
    const [high, low] = [pairs[0]!, pairs[1]!];
    const kicker = highestExcluding(rankCounts, [high, low], 1);
    return finish(HandCategory.TwoPair, [high, low, ...kicker], [
      ...pickByRanks(cards, [high, high, low, low]),
      ...pickByRanks(cards, kicker),
    ]);
  }

  if (pairs.length === 1) {
    const pair = pairs[0]!;
    const kickers = highestExcluding(rankCounts, [pair], 3);
    return finish(HandCategory.Pair, [pair, ...kickers], [
      ...pickByRanks(cards, [pair, pair]),
      ...pickByRanks(cards, kickers),
    ]);
  }

  const topFive = highestExcluding(rankCounts, [], 5);
  return finish(HandCategory.HighCard, topFive, pickByRanks(cards, topFive));
}

function finish(category: HandCategory, kickers: number[], cards: Card[]): HandValue {
  return { score: makeScore(category, kickers), category, kickers, cards };
}

/** The `count` highest ranks present, skipping any rank in `exclude`. */
function highestExcluding(rankCounts: readonly number[], exclude: readonly number[], count: number): number[] {
  const out: number[] = [];
  for (let rank = 12; rank >= 0 && out.length < count; rank--) {
    if (rankCounts[rank]! > 0 && !exclude.includes(rank)) out.push(rank);
  }
  return out;
}

/** Picks one distinct card per requested rank, in the order requested. */
function pickByRanks(cards: readonly Card[], ranks: readonly number[]): Card[] {
  const used = new Set<Card>();
  const out: Card[] = [];
  for (const rank of ranks) {
    const found = cards.find((card) => rankOf(card) === rank && !used.has(card));
    if (found !== undefined) {
      used.add(found);
      out.push(found);
    }
  }
  return out;
}

/** The five cards of the straight topped by `high` (handles the wheel's ace). */
function straightCards(cards: readonly Card[], high: number): Card[] {
  const ranks = high === 3 ? [3, 2, 1, 0, 12] : [high, high - 1, high - 2, high - 3, high - 4];
  return pickByRanks(cards, ranks);
}

/** "Two pair, aces and eights, king kicker" — the phrasing a dealer would use. */
export function describeHand(value: HandValue): string {
  const k = value.kickers;
  switch (value.category) {
    case HandCategory.StraightFlush:
      return k[0] === 12 ? "Royal flush" : `Straight flush, ${rankName(k[0]!)} high`;
    case HandCategory.FourOfAKind:
      return `Four of a kind, ${rankPlural(k[0]!)}${kickerSuffix(k.slice(1))}`;
    case HandCategory.FullHouse:
      return `Full house, ${rankPlural(k[0]!)} full of ${rankPlural(k[1]!)}`;
    case HandCategory.Flush:
      return `Flush, ${rankName(k[0]!)} high`;
    case HandCategory.Straight:
      return `Straight, ${rankName(k[0]!)} high`;
    case HandCategory.ThreeOfAKind:
      return `Three of a kind, ${rankPlural(k[0]!)}${kickerSuffix(k.slice(1))}`;
    case HandCategory.TwoPair:
      return `Two pair, ${rankPlural(k[0]!)} and ${rankPlural(k[1]!)}${kickerSuffix(k.slice(2))}`;
    case HandCategory.Pair:
      return `Pair of ${rankPlural(k[0]!)}${kickerSuffix(k.slice(1))}`;
    default:
      return `${rankName(k[0]!)} high${kickerSuffix(k.slice(1))}`;
  }
}

function kickerSuffix(kickers: readonly number[]): string {
  if (kickers.length === 0) return "";
  return `, ${rankName(kickers[0]!)} kicker`;
}

export function compareHands(a: HandValue, b: HandValue): number {
  return a.score - b.score;
}
