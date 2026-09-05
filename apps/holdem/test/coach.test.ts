import { describe, expect, it } from "vitest";
import { parseCards } from "../src/engine/cards.js";
import { equityVsRandom } from "../src/coach/equity.js";
import { countOuts } from "../src/coach/outs.js";
import { coach, startingHandLabel } from "../src/coach/advice.js";
import { reviewHand } from "../src/coach/review.js";
import { pressureOf } from "../src/coach/pressure.js";
import { Table, type TableConfig } from "../src/engine/table.js";

const cards = (text: string) => parseCards(text);

describe("equity", () => {
  it("gives a made nut hand almost all of it on the river", () => {
    // Royal flush — nothing can beat it, and it is enumerated exactly.
    const result = equityVsRandom(cards("As Ks"), cards("Qs Js Ts 2c 3d"), 1);
    expect(result.exact).toBe(true);
    expect(result.equity).toBe(1);
  });

  it("gives the worst hand on a finished board close to nothing", () => {
    const result = equityVsRandom(cards("2c 3d"), cards("As Ks Qs Js Ts"), 1);
    // Both players play the board's royal flush: it is a certain split.
    expect(result.tie).toBe(1);
    expect(result.equity).toBeCloseTo(0.5, 5);
  });

  it("puts pocket aces near the textbook 85% against one random hand", () => {
    const result = equityVsRandom(cards("As Ad"), [], 1, { samples: 12000, seed: 7 });
    expect(result.equity).toBeGreaterThan(0.82);
    expect(result.equity).toBeLessThan(0.88);
  });

  it("puts pocket aces near the textbook 56% against four random hands", () => {
    const result = equityVsRandom(cards("As Ad"), [], 4, { samples: 12000, seed: 11 });
    expect(result.equity).toBeGreaterThan(0.5);
    expect(result.equity).toBeLessThan(0.62);
  });

  it("puts a flush draw on the flop near the textbook 35% heads-up", () => {
    const result = equityVsRandom(cards("As 4s"), cards("Ks 9s 2d"), 1, { samples: 12000, seed: 3 });
    expect(result.equity).toBeGreaterThan(0.55); // ace-high plus the nut flush draw
    expect(result.equity).toBeLessThan(0.8);
  });

  it("is deterministic for a given seed", () => {
    const a = equityVsRandom(cards("Jh Th"), cards("9c 8d 2s"), 2, { samples: 1000, seed: 99 });
    const b = equityVsRandom(cards("Jh Th"), cards("9c 8d 2s"), 2, { samples: 1000, seed: 99 });
    expect(a.equity).toBe(b.equity);
  });

  it("refuses impossible inputs", () => {
    expect(() => equityVsRandom(cards("As"), [], 1)).toThrow(/two hole cards/);
    expect(() => equityVsRandom(cards("As Ad"), cards("As 2c 3d"), 1)).toThrow(/duplicate/);
  });
});

describe("outs", () => {
  it("counts nine outs for a flush draw", () => {
    const result = countOuts(cards("As 4s"), cards("Ks 9s 2d"));
    const flush = result.groups.find((g) => g.makes === "Flush");
    expect(flush!.cards).toHaveLength(9);
    expect(result.cardsToCome).toBe(2);
  });

  it("counts eight outs for an open-ended straight draw", () => {
    const result = countOuts(cards("9c 8d"), cards("7h 6s 2c"));
    const straight = result.groups.find((g) => g.makes === "Straight");
    expect(straight!.cards).toHaveLength(8); // any five or any ten
  });

  it("applies the rule of two on the turn and the rule of four on the flop", () => {
    const flop = countOuts(cards("As 4s"), cards("Ks 9s 2d"));
    const turn = countOuts(cards("As 4s"), cards("Ks 9s 2d 7h"));
    expect(flop.ruleOfThumbPct).toBe(flop.count * 4);
    expect(turn.ruleOfThumbPct).toBe(turn.count * 2);
  });

  it("reports nothing to draw to once the river is out", () => {
    expect(countOuts(cards("As 4s"), cards("Ks 9s 2d 7h Tc")).count).toBe(0);
  });

  it("does not count cards that pair the board for everyone", () => {
    // KJ on A-8-4. A king or a jack is an out; an eight, a four or an ace just
    // pairs the board, which every player at the table shares.
    const result = countOuts(cards("Kd Js"), cards("8d 4c Ac"));
    expect(result.count).toBe(6);
    expect(result.groups.flatMap((g) => g.cards).sort()).toEqual(
      ["Jc", "Jd", "Jh", "Kc", "Kh", "Ks"].sort(),
    );
  });

  it("still counts a card that pairs a hole card even when the board is paired", () => {
    // Q7 on 5-5-2: a queen or a seven makes two pair, which the board does not
    // hand to everyone.
    const result = countOuts(cards("Qd 7s"), cards("5c 5h 2d"));
    expect(result.count).toBe(6);
    expect(result.groups[0]!.makes).toBe("Two pair");
  });
});

describe("advice", () => {
  it("names the starting hand the way a player would", () => {
    expect(startingHandLabel(cards("As Ad"))).toBe("pocket aces");
    expect(startingHandLabel(cards("7s 7d"))).toBe("pocket sevens");
    expect(startingHandLabel(cards("Ah Kh"))).toBe("AK suited");
    expect(startingHandLabel(cards("Ah Kd"))).toBe("AK offsuit");
  });

  it("folds a hopeless hand at a bad price and explains the shortfall", () => {
    const advice = coach({
      hole: cards("7c 2d"),
      board: cards("As Ks Qh"),
      opponents: 2,
      pot: 100,
      toCall: 100,
      street: "flop",
      legal: legalFacing(100),
    });
    expect(advice.suggestion).toBe("Fold");
    expect(advice.potOdds!.breakEven).toBeCloseTo(0.5, 5);
    expect(advice.tips.some((t) => t.label === "Pot odds")).toBe(true);
    expect(advice.tips.some((t) => /short by/.test(t.text))).toBe(true);
  });

  it("raises with a monster getting a cheap price", () => {
    const advice = coach({
      hole: cards("As Ad"),
      board: cards("Ac Kd 7h"),
      opponents: 1,
      pot: 200,
      toCall: 20,
      street: "flop",
      legal: legalFacing(20),
    });
    expect(advice.suggestion).toBe("Raise");
    expect(advice.handDescription).toMatch(/Three of a kind/);
  });

  it("calls a clear edge clear, rather than describing it as thin", () => {
    const advice = coach({
      hole: cards("Kd Js"),
      board: cards("8d 4c Ac"),
      opponents: 1,
      pot: 1000,
      toCall: 60,
      street: "flop",
      stack: 2000,
      legal: { ...legalFacing(60), canRaise: false, maxRaiseTo: 0 },
    });
    expect(advice.suggestion).toBe("Call");
    expect(advice.confidence).toBe("high");
    expect(advice.tips.find((t) => t.label === "Why")!.text).toMatch(/comfortably ahead/);
  });

  it("shows the arithmetic rather than only the answer", () => {
    const advice = coach({
      hole: cards("As 4s"),
      board: cards("Ks 9s 2d"),
      opponents: 1,
      pot: 60,
      toCall: 20,
      street: "flop",
      legal: legalFacing(20),
    });
    const potOdds = advice.tips.find((t) => t.label === "Pot odds")!;
    expect(potOdds.text).toMatch(/Calling 20 into a pot of 60 makes it 80/);
    expect(advice.tips.find((t) => t.label === "Outs")!.text).toMatch(/to a flush/);
  });

  it("suggests a bet with a strong made hand and no bet to face", () => {
    const advice = coach({
      hole: cards("Ac Ad"),
      board: cards("Ah Kd 7h"),
      opponents: 1,
      pot: 100,
      toCall: 0,
      street: "flop",
      legal: legalUnbet(),
    });
    expect(advice.suggestion).toBe("Bet");
    expect(advice.potOdds).toBeNull();
  });
});

describe("reading the bet size", () => {
  it("treats a small bet as barely narrowing anyone's range", () => {
    const p = pressureOf({ toCall: 20, pot: 200 });
    expect(p.level).toBe("light");
    expect(p.note).toBeNull();
  });

  it("treats a pot-sized bet as a real commitment", () => {
    expect(pressureOf({ toCall: 200, pot: 200 }).level).toBe("shove");
    expect(pressureOf({ toCall: 120, pot: 200 }).level).toBe("heavy");
  });

  it("treats a call for most of the stack as a stack-off however small the pot", () => {
    const p = pressureOf({ toCall: 600, pot: 5000, stack: 1000 });
    expect(p.level).toBe("shove");
    expect(p.note).toMatch(/most of your stack/);
  });

  it("asks for nothing extra when there is no bet to face", () => {
    expect(pressureOf({ toCall: 0, pot: 200 })).toMatchObject({ level: "none", margin: 0 });
  });

  it("demands progressively more equity as the bet grows", () => {
    const light = pressureOf({ toCall: 20, pot: 200 }).margin;
    const heavy = pressureOf({ toCall: 120, pot: 200 }).margin;
    const shove = pressureOf({ toCall: 400, pot: 200 }).margin;
    expect(light).toBeLessThan(heavy);
    expect(heavy).toBeLessThan(shove);
  });
});

describe("the coach against a big bet", () => {
  // The spot that beat a test agent: a hand that clears the raw pot-odds price
  // by a whisker, facing a shove. The old coach said "Call" with medium
  // confidence; against a shoving range that is a losing recommendation.
  const marginalVsShove = {
    hole: cards("Kd Js"),
    board: cards("8d 4c Ac"),
    opponents: 1,
    pot: 1000,
    toCall: 900,
    street: "flop" as const,
    stack: 900,
    legal: { ...legalFacing(900), minRaiseTo: 1800, maxRaiseTo: 900 },
  };

  it("stops recommending a coin flip for a whole stack", () => {
    const advice = coach(marginalVsShove);
    expect(advice.pressure.level).toBe("shove");
    expect(advice.suggestion).toBe("Fold");
  });

  it("says why, in terms of the opponent's range rather than the raw price", () => {
    const advice = coach(marginalVsShove);
    const read = advice.tips.find((t) => t.label === "Read the bet")!;
    expect(read.text).toMatch(/random hand/);
    expect(read.text).toMatch(/overestimate/);
  });

  it("quotes a bar that matches the standard it applied", () => {
    const advice = coach(marginalVsShove);
    const why = advice.tips.find((t) => t.label === "Why")!;
    // The raw price and the adjusted bar are both shown, and the shortfall is
    // measured against the adjusted one — no incoherent arithmetic.
    expect(why.text).toMatch(/once you allow for the size of the bet/);
    const shortfall = Number(/short by (\d+)%/.exec(why.text)![1]);
    const equity = Math.round(advice.equity.equity * 100);
    const bar = Math.round((advice.potOdds!.breakEven + advice.pressure.margin) * 100);
    expect(shortfall).toBeCloseTo(bar - equity, 0);
  });

  it("still calls comfortably when the edge is real", () => {
    const advice = coach({
      ...marginalVsShove,
      hole: cards("Ah Ad"),
    });
    expect(["Call", "Raise"]).toContain(advice.suggestion);
  });

  it("leaves a cheap call alone", () => {
    const advice = coach({
      hole: cards("As 4s"),
      board: cards("Ks 9s 2d"),
      opponents: 1,
      pot: 300,
      toCall: 20,
      street: "flop",
      stack: 2000,
      legal: legalFacing(20),
    });
    expect(advice.pressure.level).toBe("light");
    expect(advice.tips.find((t) => t.label === "Read the bet")).toBeUndefined();
  });
});

describe("post-hand review", () => {
  const config: TableConfig = {
    id: "t1",
    name: "Review table",
    smallBlind: 10,
    bigBlind: 20,
    ante: 0,
    maxSeats: 6,
    minBuyIn: 200,
    maxBuyIn: 2000,
    actionTimeoutMs: 30000,
    coaching: true,
    revealShowdown: true,
  };

  function playedHand() {
    const table = new Table(config, 0);
    table.sit({ id: "a", name: "Ada", kind: "human" }, 1000, 0, 0);
    table.sit({ id: "b", name: "Bo", kind: "agent" }, 1000, 1, 0);
    table.nextSeed = 20250905;
    table.startHand(0);
    // Play it out with checks and calls so the hand reaches a showdown.
    let guard = 0;
    while (table.hand && !table.hand.isComplete && guard++ < 40) {
      const seat = table.hand.actingSeat!;
      const player = table.playerAtSeat(seat)!;
      const legal = table.hand.legalActions(seat)!;
      table.act(player.id, legal.canCheck ? { type: "check" } : { type: "call" }, 0);
    }
    return table;
  }

  it("reviews every decision the player faced", () => {
    const table = playedHand();
    const review = reviewHand(table.history[0]!, 0)!;
    expect(review.seat).toBe(0);
    expect(review.holeCards).toHaveLength(2);
    expect(review.moments.length).toBeGreaterThan(0);
    for (const moment of review.moments) {
      expect(moment.equityPct).toBeGreaterThanOrEqual(0);
      expect(moment.equityPct).toBeLessThanOrEqual(100);
      expect(moment.note.length).toBeGreaterThan(10);
    }
  });

  it("picks a key moment and writes a summary that names the result", () => {
    const table = playedHand();
    const review = reviewHand(table.history[0]!, 0)!;
    expect(review.keyMoment).not.toBeNull();
    expect(review.summary).toMatch(/won|lost|broke even/);
  });

  it("calls out a call that the pot odds did not justify", () => {
    const table = new Table(config, 0);
    table.sit({ id: "a", name: "Ada", kind: "human" }, 1000, 0, 0);
    table.sit({ id: "b", name: "Bo", kind: "agent" }, 1000, 1, 0);
    table.nextSeed = 5;
    table.startHand(0);

    // Seat 0 (button/SB heads-up) calls off a large shove blind.
    table.act("a", { type: "call" }, 0);
    table.act("b", { type: "raise", amount: 900 }, 0);
    table.act("a", { type: "call" }, 0);
    // Check the rest down so the hand reaches a showdown and lands in history.
    let guard = 0;
    while (table.hand && !table.hand.isComplete && guard++ < 40) {
      const seat = table.hand.actingSeat!;
      const legal = table.hand.legalActions(seat)!;
      table.act(table.playerAtSeat(seat)!.id, legal.canCheck ? { type: "check" } : { type: "call" }, 0);
    }

    const review = reviewHand(table.history[0]!, 0)!;
    const bigCall = review.moments.find((m) => m.action === "call" && m.toCall > 500)!;
    expect(bigCall).toBeDefined();
    expect(["loose", "thin", "good"]).toContain(bigCall.verdict);
    // Calling 880 into a pot of 920 needs close to half the pot to break even.
    expect(bigCall.breakEvenPct).toBeGreaterThan(40);
    expect(bigCall.note).toMatch(/%/);
  });

  it("returns nothing for a seat that was not in the hand", () => {
    const table = playedHand();
    expect(reviewHand(table.history[0]!, 4)).toBeNull();
  });
});

function legalFacing(toCall: number) {
  return {
    seat: 0,
    toCall,
    canFold: true,
    canCheck: false,
    canCall: true,
    canBet: false,
    canRaise: true,
    minBet: 0,
    maxBet: 0,
    minRaiseTo: toCall * 2,
    maxRaiseTo: 1000,
    allInOnly: false,
  };
}

function legalUnbet() {
  return {
    seat: 0,
    toCall: 0,
    canFold: true,
    canCheck: true,
    canCall: false,
    canBet: true,
    canRaise: false,
    minBet: 20,
    maxBet: 1000,
    minRaiseTo: 0,
    maxRaiseTo: 0,
    allInOnly: false,
  };
}
