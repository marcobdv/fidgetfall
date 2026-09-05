/**
 * Deterministic RNG. Every shuffle in the engine goes through one of these, so a
 * hand can be replayed exactly from its seed — which is what makes the rules
 * tests reproducible and lets the coach re-run a hand for its post-hand review.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, bound). */
  nextInt(bound: number): number;
}

/** mulberry32 — small, fast, good enough for card shuffling and Monte Carlo. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt: (bound: number) => Math.floor(next() * bound),
  };
}

/** Seed derived from the clock and Math.random, for real (non-replay) play. */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

/** In-place Fisher-Yates. Returns the same array for convenience. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}
