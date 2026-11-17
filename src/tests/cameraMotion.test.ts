import { afterEach, describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
import { applyCamera, isCameraMoving, releaseCamera, settleCamera } from '../canvas/cameraMotion';

/** The bits of a Konva stage / layer that `cameraMotion` uses. */
function fakeStage() {
  const attrs = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const layer = {
    drawHit: vi.fn(),
    shouldDrawHit: vi.fn((_top?: unknown) => true),
    getStage: () => stage,
  };
  const stage = {
    x: () => attrs.x,
    y: () => attrs.y,
    scaleX: () => attrs.scaleX,
    scaleY: () => attrs.scaleY,
    setAttrs: vi.fn((a: Partial<typeof attrs>) => Object.assign(attrs, a)),
    getLayers: () => [layer],
  };
  return { stage: stage as unknown as Konva.Stage, layer, attrs };
}

describe('cameraMotion', () => {
  afterEach(() => {
    settleCamera();
    vi.useRealTimers();
  });

  it('moves the stage and skips the hit graph until the camera has settled', () => {
    vi.useFakeTimers();
    const { stage, layer, attrs } = fakeStage();
    applyCamera(stage, { x: 10, y: 20, scale: 2 });
    expect(attrs).toEqual({ x: 10, y: 20, scaleX: 2, scaleY: 2 });
    expect(isCameraMoving()).toBe(true);
    expect(layer.shouldDrawHit()).toBe(false);
    // Drawing into a given top node (caching, export) is never skipped.
    expect(layer.shouldDrawHit({})).toBe(true);
    vi.advanceTimersByTime(100);
    applyCamera(stage, { x: 30, y: 20, scale: 2 });
    vi.advanceTimersByTime(100);
    expect(isCameraMoving()).toBe(true);
    expect(layer.drawHit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(isCameraMoving()).toBe(false);
    expect(layer.drawHit).toHaveBeenCalledTimes(1);
    expect(layer.shouldDrawHit()).toBe(true);
  });

  it('brings the hit graph up to date at once when asked', () => {
    vi.useFakeTimers();
    const { stage, layer } = fakeStage();
    applyCamera(stage, { x: 5, y: 5, scale: 1 });
    settleCamera();
    expect(isCameraMoving()).toBe(false);
    expect(layer.drawHit).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(layer.drawHit).toHaveBeenCalledTimes(1);
  });

  it('applies a camera without motion, and ignores an unchanged one', () => {
    const { stage, layer } = fakeStage();
    applyCamera(stage, { x: 5, y: 5, scale: 1 }, false);
    expect(isCameraMoving()).toBe(false);
    applyCamera(stage, { x: 5, y: 5, scale: 1 });
    expect(isCameraMoving()).toBe(false);
    expect(stage.setAttrs).toHaveBeenCalledTimes(1);
    expect(layer.drawHit).not.toHaveBeenCalled();
  });

  it('forgets a stage that goes away without drawing it', () => {
    const { stage, layer } = fakeStage();
    applyCamera(stage, { x: 1, y: 2, scale: 1 });
    releaseCamera(stage);
    expect(isCameraMoving()).toBe(false);
    settleCamera();
    expect(layer.drawHit).not.toHaveBeenCalled();
  });
});
