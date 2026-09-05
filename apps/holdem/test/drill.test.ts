import { describe, expect, it } from "vitest";
import { parseCards } from "../src/engine/cards.js";
import {
  drillQuestions,
  isDrillable,
  markDrill,
  markPracticeSpot,
  practiceSpot,
} from "../src/coach/drill.js";
import { countOuts } from "../src/coach/outs.js";

const cards = (text: string) => parseCards(text);

/**
 * A flush draw with live overcards: nine spades make the flush, and the three
 * aces and three fours each make a pair. Fifteen outs in total.
 *
 * The folk answer to "how many outs on a flush draw" is nine, and a learner who
 * says nine here is not wrong about flushes — they have forgotten the pair
 * outs. That is why the marking hands back the grouping rather than a bare
 * number: "9 to a flush, 3 to a pair of aces, 3 to a pair of fours" teaches the
 * distinction that a single figure hides.
 */
const flushDraw = { hole: cards("As 4s"), board: cards("Ks 9s 2d") };
const FLUSH_DRAW_OUTS = 15;

describe("posing the question", () => {
  it("asks all three when there is a draw and a price", () => {
    const spot = drillQuestions(flushDraw.hole, flushDraw.board, 100, 40, 1);
    expect(spot.asks).toEqual({ outs: true, ruleOfThumb: true, potOdds: true });
    expect(spot.cardsToCome).toBe(2);
  });

  it("asks only pot odds once the river is out", () => {
    const spot = drillQuestions(flushDraw.hole, cards("Ks 9s 2d 7h Tc"), 100, 40, 1);
    expect(spot.asks).toEqual({ outs: false, ruleOfThumb: false, potOdds: true });
  });

  it("has nothing to ask preflop with no bet to face", () => {
    expect(isDrillable(drillQuestions(cards("As Ks"), [], 30, 0, 1))).toBe(false);
  });

  it("offers every unseen card to pick from, and no seen one", () => {
    const spot = drillQuestions(flushDraw.hole, flushDraw.board, 100, 40, 1);
    expect(spot.unseen).toHaveLength(47);
    for (const shown of [...spot.hole, ...spot.board]) {
      expect(spot.unseen).not.toContain(shown);
    }
  });

  it("carries no answer of any kind in the question", () => {
    // The whole design rests on this: a player cannot read the answer off the
    // page before committing to one.
    const spot = drillQuestions(flushDraw.hole, flushDraw.board, 100, 40, 1);
    const truth = countOuts(flushDraw.hole, flushDraw.board);
    const payload = JSON.stringify(spot);

    expect(Object.keys(spot)).not.toContain("outs");
    expect(Object.keys(spot)).not.toContain("groups");
    // 15 outs, 60% by the rule of four, 29% break-even — none of them present.
    expect(truth.count).toBe(FLUSH_DRAW_OUTS);
    expect(payload).not.toMatch(/"(count|correct|ruleOfThumbPct|breakEven)"/);
  });
});

describe("marking the outs count", () => {
  it("accepts the right number", () => {
    const marking = markDrill(flushDraw.hole, flushDraw.board, 100, 40, {
      outs: FLUSH_DRAW_OUTS,
    });
    expect(marking.outs!.right).toBe(true);
    expect(marking.outs!.correct).toBe(FLUSH_DRAW_OUTS);
    expect(marking.outs!.note).toMatch(/that is right/);
  });

  it("breaks the answer into what each group of outs makes", () => {
    const marking = markDrill(flushDraw.hole, flushDraw.board, 100, 40, { outs: 9 });
    const flush = marking.outs!.groups.find((g) => g.makes === "Flush")!;
    const pair = marking.outs!.groups.find((g) => g.makes === "Pair")!;
    expect(flush.cards).toHaveLength(9);
    expect(pair.cards).toHaveLength(6);
  });

  it("names board-pairing cards as the reason for an over-count", () => {
    // KJ on A-8-4: sixes and fours pair the board and belong to everyone.
    const hole = cards("Kd Js");
    const board = cards("8d 4c Ac");
    const overCounted = ["Kc", "Kh", "Ks", "Jc", "Jd", "Jh", "8c", "8h", "8s", "4d", "4h", "4s"];

    const marking = markDrill(hole, board, 100, 40, { outs: 12, outCards: overCounted });
    expect(marking.outs!.correct).toBe(6);
    expect(marking.outs!.note).toMatch(/pair the board/);
    expect(marking.outs!.wrong.map((w) => w.card).sort()).toEqual(
      ["4d", "4h", "4s", "8c", "8h", "8s"].sort(),
    );
    for (const wrong of marking.outs!.wrong) {
      expect(wrong.why).toMatch(/every player still in the hand gets exactly the same thing/);
    }
    expect(marking.outs!.missed).toHaveLength(0);
  });

  it("names the outs that were missed, and what each one makes", () => {
    // The player counts the flush and stops — the classic nine-outs answer.
    const spades = ["2s", "3s", "5s", "6s", "7s", "8s", "Ts", "Js", "Qs"];
    const marking = markDrill(flushDraw.hole, flushDraw.board, 100, 40, {
      outs: 9,
      outCards: spades,
    });

    expect(marking.outs!.right).toBe(false);
    expect(marking.outs!.wrong).toHaveLength(0);
    expect(marking.outs!.missed.map((m) => m.card).sort()).toEqual(
      ["Ac", "Ad", "Ah", "4c", "4d", "4h"].sort(),
    );
    for (const miss of marking.outs!.missed) expect(miss.makes).toBe("Pair");
    expect(marking.outs!.note).toMatch(/more here than you spotted/);
  });

  it("does not praise the right total reached with the wrong cards", () => {
    // Six cards picked, six outs — but none of the picks is actually an out.
    const marking = markDrill(flushDraw.hole, flushDraw.board, 100, 40, {
      outs: 15,
      outCards: ["2c", "2d", "2h", "3c", "3d", "3h"],
    });
    expect(marking.outs!.correct).toBe(FLUSH_DRAW_OUTS);

    const rightTotalWrongCards = markDrill(cards("Kd Js"), cards("8d 4c Ac"), 100, 40, {
      outs: 6,
      outCards: ["8c", "8h", "8s", "4d", "4h", "4s"],
    });
    expect(rightTotalWrongCards.outs!.yours).toBe(6);
    expect(rightTotalWrongCards.outs!.correct).toBe(6);
    expect(rightTotalWrongCards.outs!.note).toMatch(/right number, but not the right cards/);
    expect(rightTotalWrongCards.outs!.note).not.toMatch(/that is right/);
    // And it does not score as a correct answer.
    expect(rightTotalWrongCards.outs!.right).toBe(false);
    expect(rightTotalWrongCards.outs!.wrong).toHaveLength(6);
    expect(rightTotalWrongCards.outs!.missed).toHaveLength(6);
  });

  it("marks the count alone when no cards were picked", () => {
    const marking = markDrill(flushDraw.hole, flushDraw.board, 100, 40, { outs: 9 });
    expect(marking.outs!.right).toBe(false);
    expect(marking.outs!.cardsChecked).toBe(false);
    expect(marking.outs!.missed).toHaveLength(0);
  });
});

describe("marking the rule of two and four", () => {
  it("accepts outs x 4 on the flop and outs x 2 on the turn", () => {
    const onFlop = markDrill(flushDraw.hole, flushDraw.board, 100, 40, {
      outs: FLUSH_DRAW_OUTS,
      ruleOfThumbPct: 60,
    });
    expect(onFlop.ruleOfThumb!.right).toBe(true);

    const onTurn = markDrill(flushDraw.hole, cards("Ks 9s 2d 7h"), 100, 40, {
      outs: FLUSH_DRAW_OUTS,
      ruleOfThumbPct: 30,
    });
    expect(onTurn.ruleOfThumb!.right).toBe(true);
    expect(onTurn.ruleOfThumb!.note).toMatch(/x 2/);
  });

  it("credits correct arithmetic done on a wrong out count", () => {
    // 12 x 4 = 48: the method was applied properly, the input was not.
    const marking = markDrill(flushDraw.hole, flushDraw.board, 100, 40, {
      outs: 12,
      ruleOfThumbPct: 48,
    });
    expect(marking.ruleOfThumb!.right).toBe(false);
    expect(marking.ruleOfThumb!.note).toMatch(/arithmetic was right/);
    expect(marking.ruleOfThumb!.note).toMatch(/wrong out count/);
  });

  it("allows a couple of points of slack for mental arithmetic", () => {
    const marking = markDrill(flushDraw.hole, flushDraw.board, 100, 40, { ruleOfThumbPct: 59 });
    expect(marking.ruleOfThumb!.right).toBe(true);
  });
});

describe("marking pot odds", () => {
  it("checks the price and shows the division", () => {
    const marking = markDrill(flushDraw.hole, flushDraw.board, 60, 20, { breakEvenPct: 25 });
    expect(marking.potOdds!.right).toBe(true);
    expect(marking.potOdds!.correct).toBe(25);
    expect(marking.potOdds!.note).toMatch(/20 \/ 80 = 25%/);
  });

  it("rejects the common mistake of dividing by the pot before the call", () => {
    // 20/60 = 33%, which is not the break-even price.
    const marking = markDrill(flushDraw.hole, flushDraw.board, 60, 20, { breakEvenPct: 33 });
    expect(marking.potOdds!.right).toBe(false);
    expect(marking.potOdds!.correct).toBe(25);
  });
});

describe("practice spots", () => {
  it("are reproducible from their seed", () => {
    const first = practiceSpot(1234);
    expect(practiceSpot(1234)).toEqual(first);
    expect(practiceSpot(1235)).not.toEqual(first);
  });

  it("always have something worth counting", () => {
    for (let seed = 0; seed < 120; seed++) {
      const spot = practiceSpot(seed);
      const outs = countOuts(parseCards(spot.hole.join("")), parseCards(spot.board.join("")));
      expect(outs.count).toBeGreaterThanOrEqual(3);
      expect(outs.count).toBeLessThanOrEqual(15);
      expect(spot.toCall).toBeGreaterThan(0);
      expect([3, 4]).toContain(spot.board.length);
      expect(isDrillable(spot)).toBe(true);
    }
  });

  it("practise both the rule of four and the rule of two", () => {
    const toCome = new Set(Array.from({ length: 60 }, (_, i) => practiceSpot(i).cardsToCome));
    expect([...toCome].sort()).toEqual([1, 2]);
  });

  it("mark against the spot the seed produced", () => {
    const seed = 99;
    const spot = practiceSpot(seed);
    const outs = countOuts(parseCards(spot.hole.join("")), parseCards(spot.board.join("")));

    const marking = markPracticeSpot(seed, { outs: outs.count });
    expect(marking.outs!.right).toBe(true);
    expect(marking.score.asked).toBeGreaterThanOrEqual(2);
  });

  it("score every question that was asked", () => {
    const seed = 42;
    const spot = practiceSpot(seed);
    const marking = markPracticeSpot(seed, {});
    expect(marking.score.right).toBe(0);
    expect(marking.score.asked).toBe(
      Number(spot.asks.outs) + Number(spot.asks.ruleOfThumb) + Number(spot.asks.potOdds),
    );
  });
});
