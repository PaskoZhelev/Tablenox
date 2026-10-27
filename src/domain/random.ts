/** Source of uniformly distributed 32-bit unsigned integers. */
export type RandomSource = () => number;

export const secureRandomSource: RandomSource = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
};

/** Unbiased integer in [0, maxExclusive) using rejection sampling. */
export function randomInt(maxExclusive: number, source: RandomSource = secureRandomSource): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 2 ** 32) {
    throw new RangeError(`randomInt: invalid bound ${maxExclusive}`);
  }
  const range = 2 ** 32;
  const limit = range - (range % maxExclusive);
  let value: number;
  do {
    value = source() >>> 0;
  } while (value >= limit);
  return value % maxExclusive;
}

/** Returns a Fisher–Yates permutation of indices [0, n). */
export function shuffledIndices(n: number, source: RandomSource = secureRandomSource): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = randomInt(i + 1, source);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function applyPermutation<T>(items: readonly T[], order: readonly number[]): T[] {
  if (order.length !== items.length) throw new Error('Permutation length mismatch');
  const seen = new Set<number>();
  return order.map((i) => {
    if (i < 0 || i >= items.length || seen.has(i)) throw new Error('Invalid permutation');
    seen.add(i);
    return items[i];
  });
}

/** Deterministic PRNG (mulberry32) for tests. */
export function seededSource(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
