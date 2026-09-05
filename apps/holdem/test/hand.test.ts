import { describe, expect, it } from "vitest";
import { PokerHand, type HandConfig, IllegalActionError } from "../src/engine/hand.js";
import { cardsToString } from "../src/engine/cards.js";

function makeHand(overrides: Partial<HandConfig> = {}): PokerHand {
  return new PokerHand({
    handId: "h1",
    smallBlind: 10,
    bigBlind: 20,
    buttonSeat: 0,
    seed: 1234,
    seats: [
      { seat: 0, stack: 1000 },
      { seat: 1, stack: 1000 },
      { seat: 2, stack: 1000 },
    ],
    ...overrides,
  });
}

function totalChips(hand: PokerHand): number {
  let total = 0;
  for (const player of hand.players.values()) total += player.stack;
  return total + (hand.isComplete ? 0 : hand.pot);
}

function startingChips(hand: PokerHand): number {
  let total = 0;
  for (const player of hand.players.values()) total += player.startingStack;
  return total;
}

describe("blinds and position", () => {
  it("posts small then big to the button's left when three-handed", () => {
    const hand = makeHand();
    expect(hand.players.get(1)!.committed).toBe(10);
    expect(hand.players.get(2)!.committed).toBe(20);
    expect(hand.players.get(0)!.committed).toBe(0);
  });

  it("starts preflop action left of the big blind", () => {
    // Button 0, SB 1, BB 2 → first to act wraps back around to the button.
    expect(makeHand().actingSeat).toBe(0);
  });

  it("starts postflop action left of the button", () => {
    const hand = makeHand();
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    hand.act(2, { type: "check" });
    expect(hand.street).toBe("flop");
    expect(hand.actingSeat).toBe(1);
  });

  it("gives the button the small blind heads-up, and first action preflop", () => {
    const hand = makeHand({ seats: [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }] });
    expect(hand.players.get(0)!.committed).toBe(10);
    expect(hand.players.get(1)!.committed).toBe(20);
    expect(hand.actingSeat).toBe(0);
  });

  it("gives the big blind first action postflop heads-up", () => {
    const hand = makeHand({ seats: [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }] });
    hand.act(0, { type: "call" });
    hand.act(1, { type: "check" });
    expect(hand.street).toBe("flop");
    expect(hand.actingSeat).toBe(1);
  });

  it("gives the big blind the option to raise after a round of calls", () => {
    const hand = makeHand();
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    expect(hand.actingSeat).toBe(2);
    expect(hand.legalActions(2)!.canCheck).toBe(true);
    expect(hand.legalActions(2)!.canRaise).toBe(true);
    hand.act(2, { type: "raise", amount: 60 });
    expect(hand.street).toBe("preflop");
    expect(hand.actingSeat).toBe(0);
  });

  it("deals two hole cards to every seat", () => {
    const hand = makeHand();
    for (const player of hand.players.values()) expect(player.holeCards).toHaveLength(2);
    const dealt = [...hand.players.values()].flatMap((p) => p.holeCards);
    expect(new Set(dealt).size).toBe(6);
  });
});

describe("legal actions", () => {
  it("prices a call at the difference, not the whole bet", () => {
    const hand = makeHand();
    hand.act(0, { type: "raise", amount: 60 });
    // The small blind already has 10 in, so it costs 50 more.
    expect(hand.legalActions(1)!.toCall).toBe(50);
  });

  it("sets the minimum open raise at two big blinds preflop", () => {
    expect(makeHand().legalActions(0)!.minRaiseTo).toBe(40);
  });

  it("sets the minimum re-raise at the size of the last raise", () => {
    const hand = makeHand();
    hand.act(0, { type: "raise", amount: 60 }); // a raise of 40 over the blind
    expect(hand.legalActions(1)!.minRaiseTo).toBe(100);
  });

  it("offers bet, not raise, when the betting round opens unbet", () => {
    const hand = makeHand();
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    hand.act(2, { type: "check" });
    const legal = hand.legalActions(1)!;
    expect(legal.canBet).toBe(true);
    expect(legal.canRaise).toBe(false);
    expect(legal.minBet).toBe(20);
    expect(() => hand.act(1, { type: "raise", amount: 40 })).toThrow(IllegalActionError);
  });

  it("refuses a check when facing a bet, and a call when facing none", () => {
    const hand = makeHand();
    expect(() => hand.act(0, { type: "check" })).toThrow(/cannot check/);
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    expect(() => hand.act(2, { type: "call" })).toThrow(/nothing to call/);
  });

  it("refuses an undersized raise but allows a short all-in", () => {
    const hand = makeHand({
      seats: [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 75 }],
    });
    hand.act(0, { type: "raise", amount: 60 });
    hand.act(1, { type: "fold" });
    // A full raise would be to 100, but seat 2 only has 75 — so 75 is the floor,
    // and it is all-in-or-nothing.
    expect(() => hand.act(2, { type: "raise", amount: 70 })).toThrow(/at least 75/);
    expect(hand.legalActions(2)!.allInOnly).toBe(true);
    hand.act(2, { type: "raise", amount: 75 }); // all in for less than a full raise
    expect(hand.players.get(2)!.status).toBe("all-in");
  });

  it("returns null for a seat that is not to act", () => {
    const hand = makeHand();
    expect(hand.legalActions(1)).toBeNull();
    expect(() => hand.act(1, { type: "fold" })).toThrow(/it is seat 0's turn/);
  });
});

describe("short all-in raises", () => {
  it("does not reopen the betting for a player who already acted", () => {
    const hand = makeHand({
      seats: [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
        { seat: 2, stack: 75 },
      ],
    });
    hand.act(0, { type: "raise", amount: 60 });
    hand.act(1, { type: "call" }); // seat 1 has now acted at level 60
    hand.act(2, { type: "raise", amount: 75 }); // short all-in: +15, not a full raise

    // Seat 0 has not acted at level 60 as a caller — it made the bet — so it is
    // also closed out of re-raising.
    const legalForZero = hand.legalActions(0)!;
    expect(legalForZero.canCall).toBe(true);
    expect(legalForZero.canRaise).toBe(false);
    hand.act(0, { type: "call" });

    const legalForOne = hand.legalActions(1)!;
    expect(legalForOne.canRaise).toBe(false);
    expect(legalForOne.toCall).toBe(15);
  });

  it("does reopen the betting after a full-sized raise", () => {
    const hand = makeHand();
    hand.act(0, { type: "raise", amount: 60 });
    hand.act(1, { type: "raise", amount: 140 });
    expect(hand.legalActions(2)!.canRaise).toBe(true);
    hand.act(2, { type: "fold" });
    expect(hand.legalActions(0)!.canRaise).toBe(true);
  });
});

describe("settlement", () => {
  it("awards the pot without a showdown when everyone folds", () => {
    const hand = makeHand();
    hand.act(0, { type: "raise", amount: 60 });
    hand.act(1, { type: "fold" });
    hand.act(2, { type: "fold" });

    expect(hand.isComplete).toBe(true);
    expect(hand.result!.showdown).toHaveLength(0);
    expect(hand.result!.net[0]).toBe(30); // won the two blinds
    expect(hand.result!.net[1]).toBe(-10);
    expect(hand.result!.net[2]).toBe(-20);
  });

  it("returns the uncalled part of a bet nobody could cover", () => {
    const hand = makeHand();
    hand.act(0, { type: "raise", amount: 500 });
    hand.act(1, { type: "fold" });
    hand.act(2, { type: "fold" });
    const returned = hand.events.find((e) => e.type === "uncalled-returned");
    expect(returned).toMatchObject({ seat: 0, amount: 480 });
    expect(hand.players.get(0)!.stack).toBe(1030);
  });

  it("runs the board out when everyone is all in", () => {
    const hand = makeHand({ seats: [{ seat: 0, stack: 200 }, { seat: 1, stack: 200 }] });
    hand.act(0, { type: "raise", amount: 200 });
    hand.act(1, { type: "call" });

    expect(hand.board).toHaveLength(5);
    expect(hand.isComplete).toBe(true);
    expect(hand.result!.showdown).toHaveLength(2);
    expect(cardsToString(hand.board).split(" ")).toHaveLength(5);
  });

  it("never lets a seat act after the hand is complete", () => {
    const hand = makeHand({ seats: [{ seat: 0, stack: 200 }, { seat: 1, stack: 200 }] });
    hand.act(0, { type: "raise", amount: 200 });
    hand.act(1, { type: "call" });
    expect(() => hand.act(0, { type: "check" })).toThrow(/already complete/);
  });
});

describe("side pots", () => {
  it("splits into a main pot and a side pot when a short stack is all in", () => {
    const hand = makeHand({
      seats: [
        { seat: 0, stack: 1000 }, // button
        { seat: 1, stack: 1000 }, // small blind
        { seat: 2, stack: 100 }, // big blind, short
      ],
    });
    hand.act(0, { type: "raise", amount: 300 });
    hand.act(1, { type: "call" });
    hand.act(2, { type: "call" }); // all in for 100

    const pots = hand.buildPots();
    expect(pots).toHaveLength(2);
    expect(pots[0]).toMatchObject({ amount: 300, eligible: [0, 1, 2] });
    expect(pots[1]).toMatchObject({ amount: 400, eligible: [0, 1] });
    expect(pots[0]!.amount + pots[1]!.amount).toBe(hand.pot);
  });

  it("keeps a folded player's chips in the pot but bars them from winning it", () => {
    const hand = makeHand();
    hand.act(0, { type: "raise", amount: 100 });
    hand.act(1, { type: "call" });
    hand.act(2, { type: "fold" });

    const pots = hand.buildPots();
    expect(pots.reduce((sum, p) => sum + p.amount, 0)).toBe(220);
    for (const pot of pots) expect(pot.eligible).not.toContain(2);
  });

  it("builds three tiers when three stacks are all in for different amounts", () => {
    const hand = makeHand({
      smallBlind: 5,
      bigBlind: 10,
      seats: [
        { seat: 0, stack: 500 },
        { seat: 1, stack: 100 },
        { seat: 2, stack: 50 },
      ],
    });
    hand.act(0, { type: "raise", amount: 500 });
    hand.act(1, { type: "call" }); // all in 100
    hand.act(2, { type: "call" }); // all in 50

    const pots = hand.buildPots();
    expect(pots.map((p) => p.amount)).toEqual([150, 100]);
    expect(pots[0]!.eligible).toEqual([0, 1, 2]);
    expect(pots[1]!.eligible).toEqual([0, 1]);
    // Seat 0's uncalled 400 came back rather than sitting in a pot of its own.
    expect(hand.players.get(0)!.totalCommitted).toBe(100);
  });
});

describe("invariants over many random hands", () => {
  it("conserves chips and never leaves a negative stack", () => {
    for (let seed = 0; seed < 400; seed++) {
      const stacks = [200, 640, 75, 1000];
      const hand = new PokerHand({
        handId: `h${seed}`,
        smallBlind: 10,
        bigBlind: 20,
        buttonSeat: seed % 4,
        seed,
        seats: stacks.map((stack, seat) => ({ seat, stack })),
      });

      let guard = 0;
      while (!hand.isComplete) {
        if (guard++ > 500) throw new Error(`hand ${seed} did not terminate`);
        const seat = hand.actingSeat!;
        const legal = hand.legalActions(seat)!;
        const roll = (seed * 31 + guard * 17) % 100;

        if (roll < 12 && legal.canFold && legal.toCall > 0) hand.act(seat, { type: "fold" });
        else if (roll < 25 && legal.canBet) hand.act(seat, { type: "bet", amount: legal.minBet });
        else if (roll < 32 && legal.canRaise) hand.act(seat, { type: "raise", amount: legal.maxRaiseTo });
        else if (roll < 45 && legal.canRaise) hand.act(seat, { type: "raise", amount: legal.minRaiseTo });
        else if (legal.canCheck) hand.act(seat, { type: "check" });
        else if (legal.canCall) hand.act(seat, { type: "call" });
        else hand.act(seat, { type: "fold" });
      }

      expect(totalChips(hand)).toBe(startingChips(hand));
      for (const player of hand.players.values()) expect(player.stack).toBeGreaterThanOrEqual(0);

      const paid = hand.result!.payouts.reduce((sum, p) => sum + p.amount, 0);
      expect(paid).toBe(hand.buildPots().reduce((sum, p) => sum + p.amount, 0));

      // Every board card and hole card is distinct.
      const seen = [...hand.board, ...[...hand.players.values()].flatMap((p) => p.holeCards)];
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it("only ever shows a board of 0, 3, 4 or 5 cards", () => {
    for (let seed = 0; seed < 200; seed++) {
      const hand = new PokerHand({
        handId: `b${seed}`,
        smallBlind: 5,
        bigBlind: 10,
        buttonSeat: 0,
        seed,
        seats: [{ seat: 0, stack: 300 }, { seat: 1, stack: 300 }, { seat: 2, stack: 300 }],
      });
      let guard = 0;
      while (!hand.isComplete && guard++ < 200) {
        const seat = hand.actingSeat!;
        const legal = hand.legalActions(seat)!;
        if (legal.canCheck) hand.act(seat, { type: "check" });
        else hand.act(seat, { type: "call" });
      }
      expect([0, 3, 4, 5]).toContain(hand.board.length);
    }
  });
});
