/**
 * Card primitives. A card is encoded as a small integer so decks, hands and
 * evaluator lookups stay allocation-free:
 *
 *     card = rank * 4 + suit        rank 0..12 (deuce..ace), suit 0..3
 *
 * Human-facing code uses the two-character notation `"As"`, `"Td"`, `"7c"`.
 */

export type Card = number;

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const SUITS = ["c", "d", "h", "s"] as const;

export type RankChar = (typeof RANKS)[number];
export type SuitChar = (typeof SUITS)[number];

/** Number of distinct cards in a standard deck. */
export const DECK_SIZE = 52;

export function makeCard(rank: number, suit: number): Card {
  if (rank < 0 || rank > 12) throw new RangeError(`rank out of range: ${rank}`);
  if (suit < 0 || suit > 3) throw new RangeError(`suit out of range: ${suit}`);
  return rank * 4 + suit;
}

export function rankOf(card: Card): number {
  return card >> 2;
}

export function suitOf(card: Card): number {
  return card & 3;
}

/** `"As"` → the card integer. Case-insensitive on the rank, e.g. `"as"` works. */
export function parseCard(text: string): Card {
  if (text.length !== 2) throw new SyntaxError(`not a card: ${JSON.stringify(text)}`);
  const rank = RANKS.indexOf(text[0]!.toUpperCase() as RankChar);
  const suit = SUITS.indexOf(text[1]!.toLowerCase() as SuitChar);
  if (rank < 0 || suit < 0) throw new SyntaxError(`not a card: ${JSON.stringify(text)}`);
  return makeCard(rank, suit);
}

/** `"As Kd 7c"` or `"AsKd7c"` → cards. Empty string yields an empty array. */
export function parseCards(text: string): Card[] {
  const compact = text.replace(/[\s,]+/g, "");
  if (compact.length === 0) return [];
  if (compact.length % 2 !== 0) throw new SyntaxError(`not a card list: ${JSON.stringify(text)}`);
  const cards: Card[] = [];
  for (let i = 0; i < compact.length; i += 2) cards.push(parseCard(compact.slice(i, i + 2)));
  return cards;
}

export function cardToString(card: Card): string {
  return RANKS[rankOf(card)]! + SUITS[suitOf(card)]!;
}

export function cardsToString(cards: readonly Card[]): string {
  return cards.map(cardToString).join(" ");
}

/** A fresh, ordered 52-card deck. Shuffle it before dealing. */
export function fullDeck(): Card[] {
  return Array.from({ length: DECK_SIZE }, (_, i) => i as Card);
}
