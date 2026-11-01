/**
 * Small, seeded random numbers (mulberry32): the same seed gives the same
 * sequence every time, on every machine. Used wherever "random" must repeat,
 * like the painted ground, the traffic's starting spots and the city generator.
 */
/**
 * A stable number in [0, 1) from a text (FNV-1a), for choices that must not
 * change as lists are reordered: which windows glow, which zinc a roof is
 * (on the street and on the map alike).
 */
export function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
