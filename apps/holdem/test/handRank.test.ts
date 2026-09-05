import { describe, expect, it } from "vitest";
import { cardsToString, fullDeck, parseCards } from "../src/engine/cards.js";
import { createRng, shuffle } from "../src/engine/rng.js";
import { HandCategory, describeHand, evaluate, straightHigh } from "../src/engine/handRank.js";
import { bruteBestScore, combinations } from "./reference/brute.js";

const hand = (text: string) => evaluate(parseCards(text));

describe("straightHigh", () => {
  it("finds the top straight when several are present", () => {
    // 5 6 7 8 9 T — both the nine-high and ten-high straights are there.
    const mask = [3, 4, 5, 6, 7, 8].reduce((m, r) => m | (1 << r), 0);
    expect(straightHigh(mask)).toBe(8);
  });

  it("reports the wheel as five-high", () => {
    const mask = [12, 0, 1, 2, 3].reduce((m, r) => m | (1 << r), 0);
    expect(straightHigh(mask)).toBe(3);
  });

  it("rejects a four-card run", () => {
    const mask = [4, 5, 6, 7].reduce((m, r) => m | (1 << r), 0);
    expect(straightHigh(mask)).toBe(-1);
  });
});

describe("evaluate categories", () => {
  const cases: Array<[string, HandCategory, string]> = [
    ["As Ks Qs Js Ts 2c 3d", HandCategory.StraightFlush, "Royal flush"],
    ["9h 8h 7h 6h 5h Ac Kd", HandCategory.StraightFlush, "Straight flush, nine high"],
    ["5h 4h 3h 2h Ah Kd Qc", HandCategory.StraightFlush, "Straight flush, five high"],
    ["7c 7d 7h 7s Kc 2d 3h", HandCategory.FourOfAKind, "Four of a kind, sevens, king kicker"],
    ["8c 8d 8h Kc Kd 2s 3h", HandCategory.FullHouse, "Full house, eights full of kings"],
    ["Ac Jc 9c 5c 2c Kd Qh", HandCategory.Flush, "Flush, ace high"],
    ["9d 8c 7h 6s 5c Ad Kh", HandCategory.Straight, "Straight, nine high"],
    ["Ac 2d 3h 4s 5c Kd Qh", HandCategory.Straight, "Straight, five high"],
    ["Qc Qd Qh 8s 5c 2d 3h", HandCategory.ThreeOfAKind, "Three of a kind, queens, eight kicker"],
    ["Ac Ad 8h 8s Kc 5d 2h", HandCategory.TwoPair, "Two pair, aces and eights, king kicker"],
    ["Tc Td Kc 8s 5d 3h 2c", HandCategory.Pair, "Pair of tens, king kicker"],
    ["Ac Kd 9h 7s 5c 3d 2h", HandCategory.HighCard, "ace high, king kicker"],
  ];

  for (const [cards, category, description] of cases) {
    it(`reads ${cards} as ${description}`, () => {
      const value = hand(cards);
      expect(value.category).toBe(category);
      expect(describeHand(value)).toBe(description);
      expect(value.cards).toHaveLength(5);
    });
  }

  it("prefers the higher of two trips as the full house's trip", () => {
    const value = hand("Kc Kd Kh 9c 9d 9h 2s");
    expect(describeHand(value)).toBe("Full house, kings full of nines");
  });

  it("plays the board when the hole cards do not improve it", () => {
    const board = "As Ks Qs Js Ts";
    expect(hand(`${board} 2c 3d`).score).toBe(hand(`${board} 7h 8h`).score);
  });
});

describe("evaluate ordering", () => {
  it("ranks the categories in the standard order", () => {
    const ascending = [
      "Ac Kd 9h 7s 5c 3d 2h",
      "2c 2d Ah Ks Qc 9d 7h",
      "2c 2d 3h 3s Qc 9d 7h",
      "2c 2d 2h Ks Qc 9d 7h",
      "9d 8c 7h 6s 5c 2d 3h",
      "Ac Jc 9c 5c 2c Kd Qh",
      "8c 8d 8h Kc Kd 2s 3h",
      "7c 7d 7h 7s Kc 2d 3h",
      "9h 8h 7h 6h 5h Ac Kd",
    ].map(hand);

    for (let i = 1; i < ascending.length; i++) {
      expect(ascending[i]!.score).toBeGreaterThan(ascending[i - 1]!.score);
    }
  });

  it("separates flushes by every kicker, not just the top card", () => {
    expect(hand("Ac Jc 9c 5c 3c 2d 7h").score).toBeGreaterThan(hand("Ac Jc 9c 5c 2c 3d 7h").score);
  });

  it("scores identical hands with different suits as an exact tie", () => {
    expect(hand("Ac Kd 9h 7s 5c 3d 2h").score).toBe(hand("Ad Kh 9s 7c 5d 3h 2s").score);
  });
});

describe("evaluate against the brute-force reference", () => {
  it("agrees on 20000 random seven-card hands", () => {
    const rng = createRng(0xc0ffee);
    for (let i = 0; i < 20000; i++) {
      const deck = shuffle(fullDeck(), rng).slice(0, 7);
      const mine = evaluate(deck).score;
      const theirs = bruteBestScore(deck);
      if (mine !== theirs) {
        throw new Error(`disagreement on ${cardsToString(deck)}: ${mine} vs ${theirs}`);
      }
      expect(mine).toBe(theirs);
    }
  });

  it("agrees on the five cards it selected — they re-evaluate to the same score", () => {
    const rng = createRng(42);
    for (let i = 0; i < 2000; i++) {
      const deck = shuffle(fullDeck(), rng).slice(0, 7);
      const value = evaluate(deck);
      expect(evaluate(value.cards).score).toBe(value.score);
      expect(new Set(value.cards).size).toBe(5);
      for (const card of value.cards) expect(deck).toContain(card);
    }
  });

  it("agrees on every five-card hand drawn from a fixed nine-card pool", () => {
    const pool = parseCards("Ac Ad Ah Ks Kd Qc Jc Tc 9c");
    for (const combo of combinations(pool, 7)) {
      expect(evaluate(combo).score).toBe(bruteBestScore(combo));
    }
  });
});
