// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mipLevel } from '../objects/useAssetImage';

function fakeImage(width: number, height: number): HTMLImageElement {
  const img = new Image();
  Object.defineProperty(img, 'naturalWidth', { value: width });
  Object.defineProperty(img, 'naturalHeight', { value: height });
  return img;
}

describe('image mipmaps', () => {
  it('halves an image only while the copy still covers the size it is drawn at', () => {
    const img = fakeImage(800, 1100);
    expect(mipLevel(img, 800, 1100)).toBe(0);
    expect(mipLevel(img, 401, 300)).toBe(0);
    expect(mipLevel(img, 400, 550)).toBe(1);
    expect(mipLevel(img, 100, 137)).toBe(3);
    expect(mipLevel(img, 2000, 3000)).toBe(0);
    expect(mipLevel(img, 0.5, 0.5)).toBeGreaterThan(5);
  });
});
