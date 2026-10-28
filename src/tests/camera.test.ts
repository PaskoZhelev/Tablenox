import { describe, expect, it } from 'vitest';
import { clampScale, fitBounds, MAX_ZOOM, MIN_ZOOM, panBy, pinchBy, screenToWorld, worldToScreen, zoomAt, zoomBy } from '../domain/camera';
import { seededSource } from '../domain/random';

describe('camera', () => {
  it('round-trips world <-> screen', () => {
    const cam = { x: 123.4, y: -56.7, scale: 1.7 };
    const p = { x: 42, y: -17.5 };
    const back = screenToWorld(cam, worldToScreen(cam, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it('clamps zoom to the configured range', () => {
    expect(MIN_ZOOM).toBeLessThanOrEqual(0.05);
    expect(clampScale(100)).toBe(MAX_ZOOM);
    expect(clampScale(0.0001)).toBe(MIN_ZOOM);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it('keeps the world point under the cursor stationary for any zoom in the allowed range (AC3)', () => {
    const rand = seededSource(7);
    const r = () => rand() / 2 ** 32;
    let cam = { x: 400, y: 300, scale: 1 };
    for (let i = 0; i < 500; i++) {
      const anchor = { x: r() * 1600, y: r() * 900 };
      const before = screenToWorld(cam, anchor);
      cam = zoomAt(cam, anchor, MIN_ZOOM + r() * (MAX_ZOOM - MIN_ZOOM));
      const after = screenToWorld(cam, anchor);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('does not drift a world point over repeated zoom/pan cycles (AC4)', () => {
    const world = { x: 250.5, y: -133.25 };
    let cam = { x: 0, y: 0, scale: 1 };
    for (let i = 0; i < 200; i++) {
      cam = zoomBy(cam, { x: 300 + i, y: 200 - i }, i % 2 ? 1.37 : 1 / 1.37);
      cam = panBy(cam, 13, -7);
      cam = panBy(cam, -13, 7);
    }
    const screen = worldToScreen(cam, world);
    const back = screenToWorld(cam, screen);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it('fits bounds in the viewport', () => {
    const cam = fitBounds({ x: 0, y: 0, width: 1000, height: 500 }, { width: 1100, height: 600 }, 50);
    expect(cam.scale).toBeCloseTo(1, 6);
    const c = worldToScreen(cam, { x: 500, y: 250 });
    expect(c.x).toBeCloseTo(550);
    expect(c.y).toBeCloseTo(300);
  });

  it('fits bounds into the space left free by floating UI', () => {
    const cam = fitBounds({ x: 0, y: 0, width: 1000, height: 500 }, { width: 1160, height: 650 }, 50, {
      top: 50,
      right: 0,
      bottom: 0,
      left: 60,
    });
    expect(cam.scale).toBeCloseTo(1, 6);
    const c = worldToScreen(cam, { x: 500, y: 250 });
    expect(c.x).toBeCloseTo(60 + 550);
    expect(c.y).toBeCloseTo(50 + 300);
    // Insets that would take more than half the viewport are ignored.
    const huge = fitBounds({ x: 0, y: 0, width: 1000, height: 500 }, { width: 1100, height: 600 }, 50, {
      top: 0,
      right: 0,
      bottom: 0,
      left: 700,
    });
    expect(huge).toEqual(fitBounds({ x: 0, y: 0, width: 1000, height: 500 }, { width: 1100, height: 600 }, 50));
  });

  it('pinch keeps the world point between the fingers under them while zooming and panning', () => {
    let cam = { x: 120, y: -40, scale: 1 };
    const start = { center: { x: 200, y: 300 }, dist: 100 };
    const world = screenToWorld(cam, start.center);
    const steps = [
      { center: { x: 210, y: 310 }, dist: 130 },
      { center: { x: 240, y: 290 }, dist: 180 },
      { center: { x: 260, y: 260 }, dist: 150 },
    ];
    let from = start;
    for (const to of steps) {
      cam = pinchBy(cam, from, to);
      from = to;
    }
    expect(cam.scale).toBeCloseTo(1.5, 6);
    const p = worldToScreen(cam, world);
    expect(p.x).toBeCloseTo(260, 6);
    expect(p.y).toBeCloseTo(260, 6);
  });

  it('pinch zoom stops at the zoom limits and a zero distance only pans', () => {
    const cam = { x: 0, y: 0, scale: MAX_ZOOM };
    expect(pinchBy(cam, { center: { x: 0, y: 0 }, dist: 10 }, { center: { x: 0, y: 0 }, dist: 100 }).scale).toBe(MAX_ZOOM);
    expect(pinchBy(cam, { center: { x: 0, y: 0 }, dist: 0 }, { center: { x: 5, y: 7 }, dist: 40 })).toEqual({
      x: 5,
      y: 7,
      scale: MAX_ZOOM,
    });
  });
});
