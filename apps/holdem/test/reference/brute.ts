/**
 * An intentionally naive five-card scorer used only by the tests: it enumerates
 * every five-card subset of a seven-card hand and scores each one from scratch.
 * It shares no code path with `evaluate()`, so agreement between the two is real
 * evidence rather than the same bug written twice.
 */

import { type Card, rankOf, suitOf } from "../../src/engine/cards.js";

export function bruteBestScore(cards: readonly Card[]): number {
  let best = -1;
  for (const combo of combinations(cards, 5)) {
    const score = scoreFive(combo);
    if (score > best) best = score;
  }
  return best;
}

export function* combinations<T>(items: readonly T[], size: number): Generator<T[]> {
  if (items.length < size) return;
  const idx = Array.from({ length: size }, (_, i) => i);
  for (;;) {
    yield idx.map((i) => items[i]!);
    let i = size - 1;
    while (i >= 0 && idx[i] === items.length - size + i) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < size; j++) idx[j] = idx[j - 1]! + 1;
  }
}

function scoreFive(cards: readonly Card[]): number {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const isFlush = suits.every((s) => s === suits[0]);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  // Sort ranks by (count desc, rank desc) — the canonical kicker ordering.
  const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = grouped.map(([, c]) => c).join("");
  const ordered = grouped.map(([r]) => r);

  const distinct = [...new Set(ranks)].sort((a, b) => b - a);
  let straightTop = -1;
  if (distinct.length === 5) {
    if (distinct[0]! - distinct[4]! === 4) straightTop = distinct[0]!;
    else if (distinct[0] === 12 && distinct[1] === 3 && distinct[4] === 0) straightTop = 3;
  }

  if (isFlush && straightTop >= 0) return pack(8, [straightTop]);
  if (shape === "41") return pack(7, ordered);
  if (shape === "32") return pack(6, ordered);
  if (isFlush) return pack(5, ranks);
  if (straightTop >= 0) return pack(4, [straightTop]);
  if (shape === "311") return pack(3, ordered);
  if (shape === "221") return pack(2, ordered);
  if (shape === "2111") return pack(1, ordered);
  return pack(0, ranks);
}

function pack(category: number, kickers: readonly number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = (score << 4) | (kickers[i] ?? 0);
  return score;
}
