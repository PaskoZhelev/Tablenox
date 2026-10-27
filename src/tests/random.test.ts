import { describe, expect, it } from 'vitest';
import { applyPermutation, randomInt, seededSource, shuffledIndices } from '../domain/random';

describe('random', () => {
  it('randomInt stays within bounds and covers all values', () => {
    const src = seededSource(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = randomInt(6, src);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('randomInt is roughly uniform', () => {
    const src = seededSource(99);
    const counts = new Array(20).fill(0);
    const N = 40000;
    for (let i = 0; i < N; i++) counts[randomInt(20, src)]++;
    for (const c of counts) expect(Math.abs(c - N / 20)).toBeLessThan((N / 20) * 0.1);
  });

  it('randomInt rejects invalid bounds', () => {
    expect(() => randomInt(0)).toThrow();
    expect(() => randomInt(1.5)).toThrow();
  });

  it('works with the secure default source', () => {
    for (let i = 0; i < 100; i++) expect(randomInt(20)).toBeLessThan(20);
  });

  it('Fisher–Yates shuffle retains every card exactly once', () => {
    for (let seed = 0; seed < 50; seed++) {
      const order = shuffledIndices(52, seededSource(seed));
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
    }
  });

  it('applyPermutation rejects invalid permutations', () => {
    expect(() => applyPermutation(['a', 'b'], [0, 0])).toThrow();
    expect(() => applyPermutation(['a', 'b'], [0])).toThrow();
    expect(applyPermutation(['a', 'b', 'c'], [2, 0, 1])).toEqual(['c', 'a', 'b']);
  });
});
