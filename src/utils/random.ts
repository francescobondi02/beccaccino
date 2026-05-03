// src/utils/random.ts
// Centralised random number generator.
// In production it uses Math.random().
// In tests it can be seeded for deterministic behaviour.

export type RNG = () => number;

let _rng: RNG = Math.random;

/**
 * Returns the current random number generator function.
 * Always use this instead of calling Math.random() directly when randomness
 * needs to be deterministic in tests (e.g. deck shuffling, room codes).
 */
export function getRng(): RNG {
  return _rng;
}

/**
 * Replace the global RNG with a custom one (e.g. a seeded PRNG for tests).
 * Returns a restore function that resets it back.
 */
export function setRng(rng: RNG): () => void {
  const prev = _rng;
  _rng = rng;
  return () => {
    _rng = prev;
  };
}

/**
 * Create a deterministic PRNG using a simple mulberry32 algorithm.
 * Useful for tests that need reproducible randomness.
 */
export function createSeededRng(seed: number): RNG {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
