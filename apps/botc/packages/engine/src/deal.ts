/**
 * Dealing the bag.
 *
 * At a real table the Storyteller chooses which character tokens go into the bag
 * and then holds it shut. Players reach in and draw, so nobody — the Storyteller
 * included — knows who is sitting next to whom until it is done. That matters:
 * half the script reads the circle. The Empath, the Chef, the Clockmaker's
 * distance, the No Dashii's poisoned neighbours, the Fang Gu's jump — all of them
 * turn on adjacency, and a Storyteller who picks the seats picks those answers too.
 *
 * So the deal is a shuffle, and the shuffle is seeded. The seed goes in the log
 * and the journal before any character is assigned, which means the deal can be
 * replayed afterwards from the record and shown to have been what it says it was.
 */

/** xmur3: a string to a 32-bit seed. */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32: small, fast, and identical on every machine that runs it. */
export function rngFrom(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, driven by the seeded stream. Does not touch the input. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
