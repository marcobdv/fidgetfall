/**
 * The live coach: what a seat is holding, what it is worth, what a call costs,
 * and a plain-language suggestion.
 *
 * The suggestion is a *teaching* heuristic — pot odds against random-hand
 * equity, plus starting-hand guidance preflop. It is not a solver and never
 * claims to be; every tip carries the reasoning that produced it so the player
 * learns the arithmetic rather than the answer.
 */

import { cardToString, rankOf, suitOf, type Card } from "../engine/cards.js";
import { describeHand, evaluate, HandCategory, rankPlural } from "../engine/handRank.js";
import type { LegalActions, Street } from "../engine/types.js";
import { equityVsRandom, type EquityResult } from "./equity.js";
import { countOuts, type OutsResult } from "./outs.js";

export interface CoachInput {
  hole: readonly Card[];
  board: readonly Card[];
  opponents: number;
  pot: number;
  toCall: number;
  street: Street;
  legal?: LegalActions | null;
  /** Seats still to act behind, for a note on position. */
  playersLeftToAct?: number;
  seed?: number;
  samples?: number;
}

export interface CoachTip {
  /** Short label, e.g. "Pot odds". */
  label: string;
  text: string;
}

export interface CoachAdvice {
  handDescription: string;
  /** Estimated share of the pot this hand wins against random hands. */
  equity: EquityResult;
  outs: OutsResult;
  potOdds: {
    /** Chips it costs to continue. */
    toCall: number;
    /** Pot size once the call goes in. */
    potAfterCall: number;
    /** Equity needed to break even on the call, as a fraction. */
    breakEven: number;
  } | null;
  /** The action the heuristic favours, matched to what is actually legal. */
  suggestion: string;
  confidence: "low" | "medium" | "high";
  tips: CoachTip[];
}

/** How a player would say their starting hand out loud: "pocket aces", "AK suited". */
export function startingHandLabel(hole: readonly Card[]): string {
  const [a, b] = [hole[0]!, hole[1]!];
  const high = Math.max(rankOf(a), rankOf(b));
  const low = Math.min(rankOf(a), rankOf(b));
  const suited = suitOf(a) === suitOf(b);
  const names = "23456789TJQKA";
  if (high === low) return `pocket ${rankPlural(high)}`;
  return `${names[high]}${names[low]}${suited ? " suited" : " offsuit"}`;
}

/** True for a pocket pair — the one hand that is already made before the flop. */
function isPocketPair(hole: readonly Card[]): boolean {
  return rankOf(hole[0]!) === rankOf(hole[1]!);
}

export function coach(input: CoachInput): CoachAdvice {
  const { hole, board, opponents, pot, toCall } = input;
  // Before the flop there is no five-card hand to read, only a starting hand.
  const madeHand = board.length >= 3 ? evaluate([...hole, ...board]) : null;

  const equity = equityVsRandom(hole, board, opponents, {
    samples: input.samples ?? (board.length >= 4 ? 3000 : 4000),
    seed: input.seed ?? 0xc0ac,
  });
  const outs = countOuts(hole, board);

  const potOdds =
    toCall > 0
      ? {
          toCall,
          potAfterCall: pot + toCall,
          breakEven: toCall / (pot + toCall),
        }
      : null;

  const tips: CoachTip[] = [];
  const handDescription =
    madeHand !== null
      ? describeHand(madeHand)
      : `${startingHandLabel(hole)} (${hole.map(cardToString).join(" ")})`;

  tips.push({
    label: "Your hand",
    text:
      madeHand !== null
        ? `${handDescription} — using ${madeHand.cards.map(cardToString).join(" ")}.`
        : isPocketPair(hole)
          ? `You hold ${handDescription}. Already a made pair, but five cards are still to come.`
          : `You hold ${handDescription}. Nothing is made yet; the board decides it.`,
  });

  tips.push({
    label: "Equity",
    text:
      `Against ${opponents} random hand${opponents === 1 ? "" : "s"} you win about ` +
      `${pct(equity.equity)} of the time` +
      (equity.exact ? " (exact — every remaining hand was counted)." : ` (${equity.samples} simulations).`) +
      (opponents > 1 ? " More opponents means more ways to be beaten." : ""),
  });

  if (outs.count > 0) {
    const groups = outs.groups
      .map((g) => `${g.cards.length} to a ${g.makes.toLowerCase()}`)
      .join(", ");
    tips.push({
      label: "Outs",
      text:
        `${outs.count} card${outs.count === 1 ? "" : "s"} improve you: ${groups}. ` +
        `The rule of ${outs.cardsToCome === 2 ? "four" : "two"} puts that near ${outs.ruleOfThumbPct}% ` +
        `with ${outs.cardsToCome} card${outs.cardsToCome === 1 ? "" : "s"} to come.`,
    });
  }

  if (potOdds) {
    tips.push({
      label: "Pot odds",
      text:
        `Calling ${potOdds.toCall} into a pot of ${pot} makes it ${potOdds.potAfterCall}. ` +
        `You need to win ${pct(potOdds.breakEven)} of the time just to break even — ` +
        `you have about ${pct(equity.equity)}.`,
    });
  }

  const { suggestion, confidence, extraTips } = suggest(input, equity, outs, potOdds, madeHand);
  tips.push(...extraTips);

  if (input.playersLeftToAct !== undefined && input.playersLeftToAct > 0 && input.street === "preflop") {
    tips.push({
      label: "Position",
      text: `${input.playersLeftToAct} player${input.playersLeftToAct === 1 ? "" : "s"} still to act behind you. Acting early means playing tighter — you have less information.`,
    });
  }

  return {
    handDescription,
    equity,
    outs,
    potOdds,
    suggestion,
    confidence,
    tips,
  };
}

function suggest(
  input: CoachInput,
  equity: EquityResult,
  outs: OutsResult,
  potOdds: CoachAdvice["potOdds"],
  madeHand: ReturnType<typeof evaluate> | null,
): { suggestion: string; confidence: CoachAdvice["confidence"]; extraTips: CoachTip[] } {
  const legal = input.legal;
  const extraTips: CoachTip[] = [];

  // Facing a bet: the call is decided by whether equity clears the price.
  if (potOdds && legal?.canCall) {
    const margin = equity.equity - potOdds.breakEven;
    if (margin > 0.15 && legal.canRaise) {
      return {
        suggestion: "Raise",
        confidence: "medium",
        extraTips: [
          {
            label: "Why",
            text: `Your equity (${pct(equity.equity)}) is well clear of the ${pct(potOdds.breakEven)} the call needs. When you are this far ahead of the price, calling leaves money behind — build the pot.`,
          },
        ],
      };
    }
    if (margin > 0) {
      return {
        suggestion: "Call",
        confidence: margin > 0.05 ? "medium" : "low",
        extraTips: [
          {
            label: "Why",
            text: `The price is ${pct(potOdds.breakEven)} and you have about ${pct(equity.equity)} — a thin but profitable call against random hands. Real opponents bet their good hands more than their bad ones, so treat a thin edge as a coin flip.`,
          },
        ],
      };
    }
    const shortfall = potOdds.breakEven - equity.equity;
    extraTips.push({
      label: "Why",
      text:
        `You need ${pct(potOdds.breakEven)} and have about ${pct(equity.equity)} — short by ${pct(shortfall)}. ` +
        (input.street !== "river" && outs.count > 0
          ? "A draw can still be worth calling if you expect to win a lot more when it hits (implied odds), but not on pot odds alone."
          : "Folding here costs you nothing you had a claim to."),
    });
    return { suggestion: "Fold", confidence: shortfall > 0.1 ? "high" : "low", extraTips };
  }

  // Nobody has bet: the question is whether to bet ourselves.
  const strong = madeHand !== null && madeHand.category >= HandCategory.TwoPair;
  const decent = equity.equity > (input.opponents > 1 ? 0.55 : 0.6);

  if (legal?.canBet && (strong || decent)) {
    return {
      suggestion: "Bet",
      confidence: strong ? "medium" : "low",
      extraTips: [
        {
          label: "Why",
          text: strong
            ? `${describeHand(madeHand!)} is ahead of most hands here. Bet so worse hands pay you — checking a strong hand wins a small pot at best.`
            : `You are a favourite (${pct(equity.equity)}). Betting makes weaker hands pay and denies free cards to draws.`,
        },
      ],
    };
  }

  if (legal?.canCheck) {
    return {
      suggestion: "Check",
      confidence: "low",
      extraTips: [
        {
          label: "Why",
          text: `Around ${pct(equity.equity)} equity with nothing invested — see a free card and decide when it costs something.`,
        },
      ],
    };
  }

  return { suggestion: "Fold", confidence: "low", extraTips };
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
