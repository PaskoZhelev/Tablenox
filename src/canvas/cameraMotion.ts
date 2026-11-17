import type Konva from 'konva';
import type { CameraState } from '../domain/types';

/** How long after the last camera change the hit graph is brought up to date. */
const SETTLE_MS = 150;

let movingStage: Konva.Stage | null = null;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
const guarded = new WeakSet<Konva.Layer>();

/**
 * Konva redraws each layer's hit graph (used to find what the pointer is on) with every frame, which a pan or zoom
 * doesn't need until it stops (Konva skips it the same way while a node is dragged). The layer's own checks still apply.
 */
function guardLayer(layer: Konva.Layer): void {
  if (guarded.has(layer)) return;
  guarded.add(layer);
  const shouldDrawHit = layer.shouldDrawHit.bind(layer);
  layer.shouldDrawHit = (top?: Konva.Node) => (!!top || movingStage !== layer.getStage()) && shouldDrawHit(top);
}

/** True while the table's camera is moving (the hit graph is then out of date). */
export function isCameraMoving(): boolean {
  return movingStage !== null;
}

/** Brings the hit graph up to date now if the camera moved (e.g. a press right after a wheel zoom). */
export function settleCamera(): void {
  const stage = movingStage;
  clearTimeout(settleTimer);
  settleTimer = undefined;
  movingStage = null;
  if (!stage) return;
  for (const layer of stage.getLayers()) layer.drawHit();
}

/**
 * Moves the stage to `camera` directly in Konva, so panning and zooming don't re-render the table's React tree. The
 * scene is redrawn on the next frame; the hit graph once the camera has been still for a moment (`moving` false: at once,
 * e.g. for a stage that was just created).
 */
export function applyCamera(stage: Konva.Stage, camera: CameraState, moving = true): void {
  if (stage.x() === camera.x && stage.y() === camera.y && stage.scaleX() === camera.scale && stage.scaleY() === camera.scale) return;
  if (moving) {
    for (const layer of stage.getLayers()) guardLayer(layer);
    if (movingStage && movingStage !== stage) settleCamera();
    movingStage = stage;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleCamera, SETTLE_MS);
  }
  stage.setAttrs({ x: camera.x, y: camera.y, scaleX: camera.scale, scaleY: camera.scale });
}

/** Forgets `stage` (unmounted) without drawing it. */
export function releaseCamera(stage: Konva.Stage | null): void {
  if (!stage || movingStage !== stage) return;
  clearTimeout(settleTimer);
  settleTimer = undefined;
  movingStage = null;
}
