import { distanceToSegment, pointInRect } from './geometry';
import type { InkStroke, TextAnnotation, Vec2 } from './types';

export function strokeHit(stroke: InkStroke, p: Vec2, radius: number): boolean {
  const pts = stroke.points;
  const tolerance = radius + stroke.width / 2;
  if (pts.length === 2) return Math.hypot(pts[0] - p.x, pts[1] - p.y) <= tolerance;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    if (distanceToSegment(p, { x: pts[i], y: pts[i + 1] }, { x: pts[i + 2], y: pts[i + 3] }) <= tolerance) return true;
  }
  return false;
}

export const TEXT_LINE_HEIGHT = 1.2;

/** Approximate world-space bounds of a text annotation (used for eraser hit tests). */
export function textBounds(t: TextAnnotation) {
  const lines = t.text.split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return {
    x: t.position.x,
    y: t.position.y,
    width: longest * t.fontSize * 0.6,
    height: lines.length * t.fontSize * TEXT_LINE_HEIGHT,
  };
}

export function textHit(t: TextAnnotation, p: Vec2, radius: number): boolean {
  const b = textBounds(t);
  return pointInRect(p, { x: b.x - radius, y: b.y - radius, width: b.width + radius * 2, height: b.height + radius * 2 });
}

/** Drops points closer than `minDist` to the previous kept point; always keeps the last point. */
export function simplifyPoints(points: number[], minDist: number): number[] {
  if (points.length <= 4) return points.slice();
  const out = [points[0], points[1]];
  for (let i = 2; i < points.length; i += 2) {
    const lx = out[out.length - 2];
    const ly = out[out.length - 1];
    const isLast = i === points.length - 2;
    if (Math.hypot(points[i] - lx, points[i + 1] - ly) >= minDist || isLast) {
      out.push(points[i], points[i + 1]);
    }
  }
  return out.map((v) => Math.round(v * 100) / 100);
}
