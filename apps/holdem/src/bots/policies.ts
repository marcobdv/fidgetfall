/**
 * Built-in opponents, so a table is playable the moment it is created and a
 * human learning the game has someone to play against.
 *
 * The archetypes are the ones a beginner needs to learn to recognise: a rock
 * that only plays good hands, a calling station that never folds, a maniac that
 * bets relentlessly, and a balanced bot that actually does the pot-odds
 * arithmetic. None of them see anyone else's cards — they call the same equity
 * code the coach does, on their own hole cards only.
 */

import type { Card } from "../engine/cards.js";
import { evaluate, HandCategory } from "../engine/handRank.js";
import { createRng, type Rng } from "../engine/rng.js";
import type { Action, LegalActions, Street } from "../engine/types.js";
import { equityVsRandom } from "../coach/equity.js";

export interface BotContext {
  hole: readonly Card[];
  board: readonly Card[];
  opponents: number;
  pot: number;
  street: Street;
  legal: LegalActions;
  stack: number;
  bigBlind: number;
  rng: Rng;
}

export interface BotPolicy {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  decide(ctx: BotContext): Action;
}

/** Clamps a raise-to target into the legal band, preferring a legal raise. */
function raiseTo(legal: LegalActions, target: number): Action {
  const bounded = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(target)));
  return { type: "raise", amount: bounded };
}

function betTo(legal: LegalActions, target: number): Action {
  const bounded = Math.max(legal.minBet, Math.min(legal.maxBet, Math.round(target)));
  return { type: "bet", amount: bounded };
}

function passiveFallback(legal: LegalActions): Action {
  if (legal.canCheck) return { type: "check" };
  if (legal.canCall) return { type: "call" };
  return { type: "fold" };
}

/** Equity against random hands, cheap enough to run on every decision. */
function quickEquity(ctx: BotContext): number {
  return equityVsRandom(ctx.hole, ctx.board, ctx.opponents, {
    samples: ctx.board.length >= 4 ? 500 : 800,
    seed: ctx.rng.nextInt(0x7fffffff),
  }).equity;
}

export const rock: BotPolicy = {
  id: "rock",
  label: "Rock",
  blurb: "Folds almost everything, and means it when it bets.",
  decide(ctx) {
    const equity = quickEquity(ctx);
    const threshold = ctx.opponents > 1 ? 0.7 : 0.62;

    if (equity < threshold) {
      if (ctx.legal.canCheck) return { type: "check" };
      // It will defend for a token price, but not much more.
      const price = ctx.legal.toCall / Math.max(1, ctx.pot + ctx.legal.toCall);
      return price < 0.12 && equity > 0.4 ? { type: "call" } : { type: "fold" };
    }

    if (ctx.legal.canBet) return betTo(ctx.legal, ctx.pot * 0.6);
    if (ctx.legal.canRaise && equity > 0.78) return raiseTo(ctx.legal, ctx.legal.minRaiseTo * 1.5);
    return passiveFallback(ctx.legal);
  },
};

export const station: BotPolicy = {
  id: "station",
  label: "Calling station",
  blurb: "Calls far too much and almost never raises. Value-bet into it.",
  decide(ctx) {
    if (ctx.legal.canCheck) return { type: "check" };
    if (!ctx.legal.canCall) return { type: "fold" };
    // Folds only when the price is most of its stack and it has nothing.
    const equity = quickEquity(ctx);
    if (ctx.legal.toCall >= ctx.stack && equity < 0.35) return { type: "fold" };
    return { type: "call" };
  },
};

export const maniac: BotPolicy = {
  id: "maniac",
  label: "Maniac",
  blurb: "Bets and raises constantly. Wait for a hand and let it bluff at you.",
  decide(ctx) {
    const roll = ctx.rng.next();
    if (ctx.legal.canBet && roll < 0.75) return betTo(ctx.legal, ctx.pot * 0.8);
    if (ctx.legal.canRaise && roll < 0.35) return raiseTo(ctx.legal, ctx.legal.minRaiseTo * 1.6);
    if (ctx.legal.canCheck) return { type: "check" };
    if (ctx.legal.canCall) {
      const equity = quickEquity(ctx);
      return equity > 0.25 || roll < 0.6 ? { type: "call" } : { type: "fold" };
    }
    return { type: "fold" };
  },
};

export const balanced: BotPolicy = {
  id: "balanced",
  label: "Balanced",
  blurb: "Plays by pot odds and hand strength, with an occasional bluff.",
  decide(ctx) {
    const equity = quickEquity(ctx);
    const made = ctx.board.length >= 3 ? evaluate([...ctx.hole, ...ctx.board]) : null;
    const strong = made !== null && made.category >= HandCategory.TwoPair;

    if (ctx.legal.toCall > 0) {
      const breakEven = ctx.legal.toCall / (ctx.pot + ctx.legal.toCall);
      // A margin over the raw price covers the chips it still has to put in on
      // later streets, which pot odds alone ignore.
      if (equity > breakEven + 0.22 && ctx.legal.canRaise && ctx.rng.next() < 0.6) {
        return raiseTo(ctx.legal, ctx.pot * 0.7 + ctx.legal.toCall * 2);
      }
      if (equity > breakEven + 0.02) return { type: "call" };
      // Occasional bluff-raise keeps it from being a pure calculator.
      if (ctx.legal.canRaise && ctx.rng.next() < 0.06) {
        return raiseTo(ctx.legal, ctx.legal.minRaiseTo);
      }
      return { type: "fold" };
    }

    if (ctx.legal.canBet) {
      if (strong || equity > 0.62) return betTo(ctx.legal, ctx.pot * 0.65);
      if (ctx.rng.next() < 0.18) return betTo(ctx.legal, ctx.pot * 0.4); // a bluff
    }
    return passiveFallback(ctx.legal);
  },
};

export const BOT_POLICIES: Record<string, BotPolicy> = {
  rock: rock,
  station: station,
  maniac: maniac,
  balanced: balanced,
};

export const BOT_IDS = Object.keys(BOT_POLICIES);

export function policyFor(id: string): BotPolicy {
  const policy = BOT_POLICIES[id];
  if (!policy) throw new Error(`unknown bot "${id}" — try one of ${BOT_IDS.join(", ")}`);
  return policy;
}

/** A per-bot RNG so a bot's randomness is stable within a session. */
export function botRng(seed: number): Rng {
  return createRng(seed);
}
