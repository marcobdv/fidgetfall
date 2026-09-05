/**
 * Equity estimation: how often a hand wins against opponents holding unknown
 * cards.
 *
 * Opponents are modelled as holding *random* hands. That overstates a marginal
 * hand's equity against real opponents who fold their worst holdings, and the
 * coach says so rather than pretending otherwise — but it is the number a
 * beginner is taught first, and it is the honest one to teach against because
 * it needs no assumptions about how anyone plays.
 */

import { type Card, DECK_SIZE, fullDeck } from "../engine/cards.js";
import { evaluate } from "../engine/handRank.js";
import { createRng, shuffle } from "../engine/rng.js";

export interface EquityResult {
  /** Share of the pot won on average: wins plus a split of the ties. */
  equity: number;
  win: number;
  tie: number;
  lose: number;
  samples: number;
  /** True when every remaining runout was enumerated rather than sampled. */
  exact: boolean;
}

export interface EquityOptions {
  samples?: number;
  seed?: number;
}

/** Cards not visible to the player asking. */
function unseenCards(known: readonly Card[]): Card[] {
  const seen = new Set(known);
  return fullDeck().filter((card) => !seen.has(card));
}

/**
 * Hero's equity against `opponents` random hands.
 *
 * With one opponent on the river the whole space is 990 hands, so it is
 * enumerated exactly; every other case is sampled.
 */
export function equityVsRandom(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: number,
  options: EquityOptions = {},
): EquityResult {
  if (hole.length !== 2) throw new RangeError("hero needs exactly two hole cards");
  if (board.length > 5) throw new RangeError("a board holds at most five cards");
  if (opponents < 1) throw new RangeError("equity needs at least one opponent");

  const known = [...hole, ...board];
  if (new Set(known).size !== known.length) throw new RangeError("duplicate card");
  const needed = 5 - board.length + opponents * 2;
  if (needed > DECK_SIZE - known.length) throw new RangeError("not enough cards left to deal");

  const deck = unseenCards(known);

  if (board.length === 5 && opponents === 1) {
    return enumerateRiverHeadsUp(hole, board, deck);
  }

  const samples = options.samples ?? 4000;
  const rng = createRng(options.seed ?? 0x5eed);

  let win = 0;
  let tie = 0;
  let lose = 0;

  const pool = [...deck];
  for (let i = 0; i < samples; i++) {
    // Partial Fisher-Yates: only the cards we need get shuffled into place.
    for (let k = 0; k < needed; k++) {
      const j = k + rng.nextInt(pool.length - k);
      const tmp = pool[k]!;
      pool[k] = pool[j]!;
      pool[j] = tmp;
    }

    let cursor = 0;
    const runout = board.slice();
    while (runout.length < 5) runout.push(pool[cursor++]!);

    const heroScore = evaluate([...hole, ...runout]).score;
    let best = -1;
    let bestCount = 0;
    for (let o = 0; o < opponents; o++) {
      const score = evaluate([pool[cursor++]!, pool[cursor++]!, ...runout]).score;
      if (score > best) {
        best = score;
        bestCount = 1;
      } else if (score === best) {
        bestCount++;
      }
    }

    if (heroScore > best) win++;
    else if (heroScore === best) tie += 1 / (bestCount + 1);
    else lose++;
  }

  return {
    equity: (win + tie) / samples,
    win: win / samples,
    tie: tie / samples,
    lose: lose / samples,
    samples,
    exact: false,
  };
}

/** All 990 opponent holdings on a finished board — exact, and fast enough. */
function enumerateRiverHeadsUp(
  hole: readonly Card[],
  board: readonly Card[],
  deck: readonly Card[],
): EquityResult {
  const heroScore = evaluate([...hole, ...board]).score;
  let win = 0;
  let tie = 0;
  let lose = 0;
  let total = 0;

  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const score = evaluate([deck[i]!, deck[j]!, ...board]).score;
      if (heroScore > score) win++;
      else if (heroScore === score) tie++;
      else lose++;
      total++;
    }
  }

  return {
    equity: (win + tie / 2) / total,
    win: win / total,
    tie: tie / total,
    lose: lose / total,
    samples: total,
    exact: true,
  };
}
