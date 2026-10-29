import { distanceToSegment, pointInRect } from './geometry';
import type { Annotations, InkStroke, ObjectKind, TableState, TabletopObject, TextAnnotation, Vec2 } from './types';

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

const round2 = (v: number) => Math.round(v * 100) / 100;

type Frame = Pick<TabletopObject, 'position' | 'width' | 'height' | 'rotation'>;

/** Kinds that pen marks, stamps and text made on them belong to (sheets). */
export const MARK_ANCHOR_KINDS: ReadonlySet<ObjectKind> = new Set<ObjectKind>(['board', 'image']);

export function isMarkAnchor(o: TabletopObject): boolean {
  return MARK_ANCHOR_KINDS.has(o.kind);
}

/** A world point in an object's own coordinates (origin = top-left of its unrotated box). */
export function worldToLocal(o: Frame, p: Vec2): Vec2 {
  const rad = (-o.rotation * Math.PI) / 180;
  const dx = p.x - (o.position.x + o.width / 2);
  const dy = p.y - (o.position.y + o.height / 2);
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad) + o.width / 2,
    y: dx * Math.sin(rad) + dy * Math.cos(rad) + o.height / 2,
  };
}

/** A point in an object's own coordinates on the table (inverse of `worldToLocal`). */
export function localToWorld(o: Frame, p: Vec2): Vec2 {
  const rad = (o.rotation * Math.PI) / 180;
  const dx = p.x - o.width / 2;
  const dy = p.y - o.height / 2;
  return {
    x: o.position.x + o.width / 2 + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: o.position.y + o.height / 2 + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** The topmost visible sheet under world point `p`: marks made there belong to it. */
export function markAnchorAt(objects: readonly TabletopObject[], p: Vec2): TabletopObject | undefined {
  let best: TabletopObject | undefined;
  for (const o of objects) {
    if (!o.visible || !isMarkAnchor(o) || (best && best.zIndex > o.zIndex)) continue;
    const l = worldToLocal(o, p);
    if (l.x >= 0 && l.y >= 0 && l.x <= o.width && l.y <= o.height) best = o;
  }
  return best;
}

/**
 * The object a mark belongs to: `undefined` for a mark on the table itself, `null` when its sheet isn't on the table
 * (e.g. an image put into a bag): such a mark is neither shown nor erasable until the sheet comes back.
 */
export function markAnchor(objects: readonly TabletopObject[], mark: { objectId?: string }): TabletopObject | null | undefined {
  if (!mark.objectId) return undefined;
  return objects.find((o) => o.id === mark.objectId) ?? null;
}

/**
 * `stroke` (world points) attached to the sheet under `at` (default: its first point), in that sheet's coordinates;
 * unchanged when there is no sheet there.
 */
export function anchorStroke(objects: readonly TabletopObject[], stroke: InkStroke, at?: Vec2): InkStroke {
  const anchor = markAnchorAt(objects, at ?? { x: stroke.points[0], y: stroke.points[1] });
  if (!anchor) return stroke;
  const points: number[] = [];
  for (let i = 0; i + 1 < stroke.points.length; i += 2) {
    const l = worldToLocal(anchor, { x: stroke.points[i], y: stroke.points[i + 1] });
    points.push(round2(l.x), round2(l.y));
  }
  return { ...stroke, points, objectId: anchor.id };
}

/** Where text placed with its top-left at world point `p` goes: onto the sheet there (its coordinates) or the table. */
export function placeText(objects: readonly TabletopObject[], p: Vec2): { position: Vec2; objectId?: string } {
  const anchor = markAnchorAt(objects, p);
  if (!anchor) return { position: { x: Math.round(p.x), y: Math.round(p.y) } };
  const l = worldToLocal(anchor, p);
  return { position: { x: round2(l.x), y: round2(l.y) }, objectId: anchor.id };
}

/** World position of a text annotation's top-left; null when its sheet isn't on the table. */
export function textWorldPosition(objects: readonly TabletopObject[], t: TextAnnotation): Vec2 | null {
  const anchor = markAnchor(objects, t);
  if (anchor === null) return null;
  return anchor ? localToWorld(anchor, t.position) : t.position;
}

/** Eraser hit test of any stroke at world point `p`. */
export function strokeHitAt(objects: readonly TabletopObject[], stroke: InkStroke, p: Vec2, radius: number): boolean {
  const anchor = markAnchor(objects, stroke);
  if (anchor === null) return false;
  return strokeHit(stroke, anchor ? worldToLocal(anchor, p) : p, radius);
}

/** Eraser hit test of any text annotation at world point `p`. */
export function textHitAt(objects: readonly TabletopObject[], t: TextAnnotation, p: Vec2, radius: number): boolean {
  const anchor = markAnchor(objects, t);
  if (anchor === null) return false;
  return textHit(t, anchor ? worldToLocal(anchor, p) : p, radius);
}

function hasAnchoredMarks(a: Annotations): boolean {
  return a.strokes.some((s) => s.objectId) || a.text.some((t) => t.objectId);
}

/** `annotations` without the marks made on the objects `ids` (they go when their sheet is deleted). */
export function withoutMarksOn(annotations: Annotations, ids: ReadonlySet<string>): Annotations {
  const strokes = annotations.strokes.filter((s) => !s.objectId || !ids.has(s.objectId));
  const text = annotations.text.filter((t) => !t.objectId || !ids.has(t.objectId));
  return strokes.length === annotations.strokes.length && text.length === annotations.text.length ? annotations : { strokes, text };
}

/**
 * After a change from `prev` to `next`, stretches the marks of every sheet whose size changed, so they stay where they
 * were drawn on it (moving and turning need nothing: marks use the sheet's own coordinates). Returns `next` itself when
 * nothing needs to change.
 */
export function followResizedSheets(prev: TableState, next: TableState): TableState {
  if (prev.objects === next.objects || !hasAnchoredMarks(next.annotations)) return next;
  const before = new Map(prev.objects.map((o) => [o.id, o]));
  const scales = new Map<string, { sx: number; sy: number }>();
  for (const o of next.objects) {
    const old = before.get(o.id);
    if (old && isMarkAnchor(o) && (old.width !== o.width || old.height !== o.height)) {
      scales.set(o.id, { sx: o.width / old.width, sy: o.height / old.height });
    }
  }
  if (scales.size === 0) return next;
  const strokes = next.annotations.strokes.map((s) => {
    const k = s.objectId && scales.get(s.objectId);
    if (!k) return s;
    return {
      ...s,
      points: s.points.map((v, i) => round2(v * (i % 2 === 0 ? k.sx : k.sy))),
      width: Math.max(0.1, round2(s.width * Math.sqrt(k.sx * k.sy))),
    };
  });
  const text = next.annotations.text.map((t) => {
    const k = t.objectId && scales.get(t.objectId);
    if (!k) return t;
    return {
      ...t,
      position: { x: round2(t.position.x * k.sx), y: round2(t.position.y * k.sy) },
      fontSize: Math.max(1, round2(t.fontSize * Math.sqrt(k.sx * k.sy))),
    };
  });
  return { ...next, annotations: { strokes, text } };
}
