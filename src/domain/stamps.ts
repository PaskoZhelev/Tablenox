import type { InkStroke, Vec2 } from './types';

/** Quick marks for roll-and-write sheets, placed with one click of the Stamp tool. */
export const STAMP_SHAPES = ['check', 'cross', 'circle', 'dot', 'slash', 'star'] as const;
export type StampShape = (typeof STAMP_SHAPES)[number];

export const STAMP_LABELS: Record<StampShape, string> = {
  check: 'Tick',
  cross: 'Cross',
  circle: 'Circle',
  dot: 'Dot',
  slash: 'Slash',
  star: 'Star',
};

export const STAMP_SIZES = [16, 24, 32, 48, 72];
export const DEFAULT_STAMP_SIZE = 32;

function ring(radius: number, points: number, inner?: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= points; i++) {
    const r = inner !== undefined && i % 2 === 1 ? inner : radius;
    const a = -Math.PI / 2 + (i / points) * Math.PI * 2;
    out.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return out;
}

/** The stamp's polyline for size 1, centred on 0,0 (x,y pairs). */
function unitPoints(shape: StampShape): number[] {
  switch (shape) {
    case 'check':
      return [-0.4, 0.02, -0.12, 0.32, 0.42, -0.36];
    case 'cross':
      // One line: down one diagonal, back to the middle, then along the other (the overlap doesn't show).
      return [-0.36, -0.36, 0.36, 0.36, 0, 0, 0.36, -0.36, -0.36, 0.36];
    case 'slash':
      return [-0.36, 0.36, 0.36, -0.36];
    case 'dot':
      return [0, 0];
    case 'circle':
      return ring(0.4, 32);
    case 'star':
      return ring(0.48, 10, 0.2);
  }
}

/** Line width of a stamp of `size` world units (a dot is one fat round point). */
export function stampWidth(shape: StampShape, size: number): number {
  return Math.round((shape === 'dot' ? size * 0.5 : Math.max(1.5, size * 0.12)) * 100) / 100;
}

/** A stamp centred on world point `center`, as a straight-segment pen stroke (erased, undone and anchored like one). */
export function stampStroke(shape: StampShape, center: Vec2, size: number, color: string, id: string): InkStroke {
  const points = unitPoints(shape).map((v, i) => Math.round(((i % 2 === 0 ? center.x : center.y) + v * size) * 100) / 100);
  return { id, points, color, width: stampWidth(shape, size), opacity: 1, straight: true };
}
