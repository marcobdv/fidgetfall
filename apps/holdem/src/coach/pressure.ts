/**
 * How much the price you are being asked to pay should make you distrust your
 * own equity number.
 *
 * The coach measures equity against *random* hands, because that needs no
 * assumptions about how anyone plays. But nobody shoves a random hand. The
 * bigger the bet you are facing, the narrower and stronger the range behind it,
 * and the more your random-hand equity flatters you.
 *
 * Rather than fake a range model, this asks for a **margin**: a bet you could
 * call on a hair-thin edge against random hands needs a clear edge against
 * someone who just bet the pot. The thresholds below are rules of thumb, not
 * derived numbers, and the coach says so — but they encode the real lesson,
 * which is that a coin flip against a shove is usually not a coin flip.
 *
 * This lives in its own module because the live coach and the post-hand review
 * must apply the same standard. A review that praises a call the coach would
 * have warned about teaches nothing.
 */

export type PressureLevel = "none" | "light" | "heavy" | "shove";

export interface Pressure {
  level: PressureLevel;
  /**
   * Extra equity, as a fraction, to demand on top of the raw pot-odds
   * break-even before a call looks good.
   */
  margin: number;
  /** What to tell the player, or null when the price speaks for itself. */
  note: string | null;
}

export interface PressureInput {
  /** Chips it costs to continue. */
  toCall: number;
  /** Chips already in the pot, before the call. */
  pot: number;
  /** The player's remaining stack, when known. */
  stack?: number;
}

/** A bet up to about a third of the pot barely narrows anyone's range. */
const LIGHT_RATIO = 0.35;
/** Up to about pot-sized is a real bet, but not yet a commitment. */
const HEAVY_RATIO = 0.9;
/** Calling this share of your stack is a stack-off whatever it is called. */
const COMMITTING_SHARE = 0.5;

const MARGINS: Record<PressureLevel, number> = {
  none: 0,
  light: 0.02,
  heavy: 0.08,
  shove: 0.15,
};

export function pressureOf({ toCall, pot, stack }: PressureInput): Pressure {
  if (toCall <= 0) return { level: "none", margin: MARGINS.none, note: null };

  const ratio = pot > 0 ? toCall / pot : Number.POSITIVE_INFINITY;
  const committing = stack !== undefined && toCall >= stack * COMMITTING_SHARE;

  let level: PressureLevel;
  if (committing || ratio > HEAVY_RATIO) level = "shove";
  else if (ratio > LIGHT_RATIO) level = "heavy";
  else level = "light";

  return { level, margin: MARGINS[level], note: noteFor(level, committing) };
}

function noteFor(level: PressureLevel, committing: boolean): string | null {
  switch (level) {
    case "shove":
      return (
        (committing
          ? "This call puts most of your stack in. "
          : "This is a pot-sized bet or bigger. ") +
        "Nobody bets like that with a random hand, so the equity above — measured against " +
        "random hands — is an overestimate here. Against a range this strong you want a clear " +
        "edge, not a coin flip. When it is close, folding costs you nothing you had a claim to."
      );
    case "heavy":
      return (
        "A bet this size is usually made with something. Your equity is measured against " +
        "random hands, so shade it down a little and look for more than a hair's margin."
      );
    default:
      return null;
  }
}
