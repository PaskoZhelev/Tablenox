import type { CameraState, Vec2 } from './types';

/** Far enough out for big tables on small (phone) screens. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.2;

export const DEFAULT_CAMERA: CameraState = { x: 0, y: 0, scale: 1 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export function worldToScreen(camera: CameraState, p: Vec2): Vec2 {
  return { x: p.x * camera.scale + camera.x, y: p.y * camera.scale + camera.y };
}

export function screenToWorld(camera: CameraState, p: Vec2): Vec2 {
  return { x: (p.x - camera.x) / camera.scale, y: (p.y - camera.y) / camera.scale };
}

/** Zoom to `nextScale` keeping the world point under `anchor` (screen coords) stationary. */
export function zoomAt(camera: CameraState, anchor: Vec2, nextScale: number): CameraState {
  const scale = clampScale(nextScale);
  const world = screenToWorld(camera, anchor);
  return { scale, x: anchor.x - world.x * scale, y: anchor.y - world.y * scale };
}

export function zoomBy(camera: CameraState, anchor: Vec2, factor: number): CameraState {
  return zoomAt(camera, anchor, camera.scale * factor);
}

export function panBy(camera: CameraState, dx: number, dy: number): CameraState {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

/** Two fingers on a touch screen: their midpoint (screen coords) and distance apart (px). */
export interface PinchPoint {
  center: Vec2;
  dist: number;
}

/**
 * Two-finger pinch / pan step: zooms by the change in finger distance and moves the camera with the midpoint,
 * so the world point that was between the fingers stays between them.
 */
export function pinchBy(camera: CameraState, from: PinchPoint, to: PinchPoint): CameraState {
  if (!(from.dist > 0) || !(to.dist > 0)) return panBy(camera, to.center.x - from.center.x, to.center.y - from.center.y);
  const zoomed = zoomBy(camera, from.center, to.dist / from.dist);
  return panBy(zoomed, to.center.x - from.center.x, to.center.y - from.center.y);
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen space (px) along each edge that is covered by floating UI; fitting centres the scene in the rest. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Camera that fits `bounds` into a viewport of the given size, with padding in screen px. */
export function fitBounds(
  bounds: Rect | null,
  viewport: { width: number; height: number },
  padding = 48,
  insets: Insets = NO_INSETS,
): CameraState {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { x: viewport.width / 2, y: viewport.height / 2, scale: 1 };
  }
  // Insets that would leave too little room are ignored rather than squeezing the scene.
  const inset =
    viewport.width - insets.left - insets.right < viewport.width / 2 || viewport.height - insets.top - insets.bottom < viewport.height / 2
      ? NO_INSETS
      : insets;
  const freeW = viewport.width - inset.left - inset.right;
  const freeH = viewport.height - inset.top - inset.bottom;
  const availW = Math.max(1, freeW - padding * 2);
  const availH = Math.max(1, freeH - padding * 2);
  const scale = clampScale(Math.min(availW / bounds.width, availH / bounds.height));
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return { scale, x: inset.left + freeW / 2 - cx * scale, y: inset.top + freeH / 2 - cy * scale };
}

/** Set zoom to an exact scale around the viewport centre. */
export function zoomToCenter(camera: CameraState, viewport: { width: number; height: number }, scale: number): CameraState {
  return zoomAt(camera, { x: viewport.width / 2, y: viewport.height / 2 }, scale);
}
