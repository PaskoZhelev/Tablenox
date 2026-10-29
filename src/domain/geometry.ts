import type { Rect } from './camera';
import type { Annotations, TabletopObject, Vec2 } from './types';

export function objectCenter(o: Pick<TabletopObject, 'position' | 'width' | 'height'>): Vec2 {
  return { x: o.position.x + o.width / 2, y: o.position.y + o.height / 2 };
}

/** Axis-aligned bounds of a (possibly rotated) object. */
export function objectBounds(o: Pick<TabletopObject, 'position' | 'width' | 'height' | 'rotation'>): Rect {
  const c = objectCenter(o);
  const rad = (o.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = o.width * cos + o.height * sin;
  const h = o.width * sin + o.height * cos;
  return { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function sceneBounds(objects: TabletopObject[], annotations?: Annotations): Rect | null {
  const rects = objects.filter((o) => o.visible).map(objectBounds);
  if (annotations) {
    // Marks on a sheet use its coordinates and lie on it anyway; only marks on the table itself count here.
    for (const s of annotations.strokes) {
      if (s.objectId) continue;
      const xs = s.points.filter((_, i) => i % 2 === 0);
      const ys = s.points.filter((_, i) => i % 2 === 1);
      if (xs.length) {
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        rects.push({ x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY });
      }
    }
  }
  return unionRects(rects);
}

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

export const DEFAULT_GRID_SIZE = 50;
export const MIN_GRID_SIZE = 5;
export const MAX_GRID_SIZE = 500;

/** A grid size the editor accepts (whole world units, `MIN_GRID_SIZE`–`MAX_GRID_SIZE`). */
export function clampGridSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_GRID_SIZE;
  return Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, Math.round(size)));
}

export function snapToGrid(v: number, size: number): number {
  return Math.round(v / size) * size;
}

/**
 * The position (top-left of the unrotated box) that puts the top-left corner of the object's bounding box, as seen on
 * the table, on the grid. For unrotated objects that is the position itself, snapped.
 */
export function snapPosition(o: Pick<TabletopObject, 'width' | 'height' | 'rotation'>, position: Vec2, size: number): Vec2 {
  const b = objectBounds({ ...o, position });
  const round = (v: number) => Math.round(v * 100) / 100;
  return { x: round(position.x + snapToGrid(b.x, size) - b.x), y: round(position.y + snapToGrid(b.y, size) - b.y) };
}
