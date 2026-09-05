/** Shared vocabulary for the engine, the server protocol and the MCP tools. */

import type { Card } from "./cards.js";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";

/** Streets on which cards are dealt, in dealing order. */
export const BOARD_STREETS = ["flop", "turn", "river"] as const;

export type PlayerStatus = "active" | "folded" | "all-in";

export type ActionType = "fold" | "check" | "call" | "bet" | "raise";

/**
 * A player's decision. `amount` uses **raise-to** semantics: it is the player's
 * total contribution to the *current betting round* once the action is applied,
 * not the extra chips pushed forward. Bets and raises require it; fold, check
 * and call ignore it.
 */
export interface Action {
  type: ActionType;
  amount?: number;
}

/** What a seat may legally do right now, with the arithmetic already done. */
export interface LegalActions {
  seat: number;
  /** Chips the seat must add to match the current bet. */
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean;
  canRaise: boolean;
  /** Raise-to bounds; only meaningful when `canBet` / `canRaise` is true. */
  minBet: number;
  maxBet: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  /** True when the only remaining aggressive action is shoving the whole stack. */
  allInOnly: boolean;
}

export interface PotShare {
  seat: number;
  amount: number;
}

export interface Pot {
  amount: number;
  /** Seats still contesting this pot (folded players are never eligible). */
  eligible: number[];
}

export interface ShowdownEntry {
  seat: number;
  holeCards: Card[];
  /** Absent when the player won without showing. */
  handScore?: number;
  handDescription?: string;
  bestCards?: Card[];
  /** True when the player mucked rather than showing. */
  mucked: boolean;
}

export interface HandResult {
  pots: Pot[];
  payouts: PotShare[];
  showdown: ShowdownEntry[];
  /** Net chip change per seat across the whole hand, blinds included. */
  net: Record<number, number>;
}

export type HandEvent =
  | { type: "hand-start"; handId: string; buttonSeat: number; seats: number[] }
  | { type: "post"; seat: number; amount: number; blind: "small" | "big" | "ante" }
  | { type: "deal-hole"; seats: number[] }
  | { type: "action"; seat: number; action: ActionType; amount: number; toCall: number; potBefore: number; street: Street }
  | { type: "street"; street: Street; cards: Card[]; pot: number }
  | { type: "uncalled-returned"; seat: number; amount: number }
  | { type: "showdown"; entries: ShowdownEntry[] }
  | { type: "payout"; seat: number; amount: number; potIndex: number }
  | { type: "hand-end"; net: Record<number, number> };
