import type { Command } from './commands';
import { objectBounds, unionRects } from './geometry';
import type { TabletopObject } from './types';

/** Lines up the selection's edges or centres, as seen on the table (rotated objects by their bounding box). */
export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
/** Equal space between the objects along one axis. */
export type DistributeAxis = 'horizontal' | 'vertical';

export const ALIGN_LABELS: Record<AlignMode, string> = {
  left: 'Align left edges',
  centerX: 'Align centres (horizontally)',
  right: 'Align right edges',
  top: 'Align top edges',
  centerY: 'Align middles (vertically)',
  bottom: 'Align bottom edges',
};

export const DISTRIBUTE_LABELS: Record<DistributeAxis, string> = {
  horizontal: 'Distribute horizontally',
  vertical: 'Distribute vertically',
};

const round = (v: number) => Math.round(v * 100) / 100;

function moves(shifts: { o: TabletopObject; dx: number; dy: number }[]): Command | null {
  const commands: Command[] = shifts
    .filter(({ o, dx, dy }) => !o.locked && (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001))
    .map(({ o, dx, dy }) => ({ type: 'MoveObject', id: o.id, position: { x: round(o.position.x + dx), y: round(o.position.y + dy) } }));
  return commands.length ? { type: 'Batch', commands } : null;
}

/**
 * Moves the objects `ids` so their edges / centres line up with the selection's bounding box. Locked objects stay
 * where they are (they still count for the bounding box). Null when nothing would move.
 */
export function alignCommand(objects: readonly TabletopObject[], ids: readonly string[], mode: AlignMode): Command | null {
  const members = objects.filter((o) => ids.includes(o.id)).map((o) => ({ o, b: objectBounds(o) }));
  const all = unionRects(members.map((m) => m.b));
  if (members.length < 2 || !all) return null;
  return moves(
    members.map(({ o, b }) => {
      switch (mode) {
        case 'left':
          return { o, dx: all.x - b.x, dy: 0 };
        case 'centerX':
          return { o, dx: all.x + all.width / 2 - (b.x + b.width / 2), dy: 0 };
        case 'right':
          return { o, dx: all.x + all.width - (b.x + b.width), dy: 0 };
        case 'top':
          return { o, dx: 0, dy: all.y - b.y };
        case 'centerY':
          return { o, dx: 0, dy: all.y + all.height / 2 - (b.y + b.height / 2) };
        case 'bottom':
          return { o, dx: 0, dy: all.y + all.height - (b.y + b.height) };
      }
    }),
  );
}

/**
 * Spreads three or more objects so the gaps between them are equal along `axis`; the first and last (by centre) stay
 * put, and so do locked objects. Null when nothing would move.
 */
export function distributeCommand(objects: readonly TabletopObject[], ids: readonly string[], axis: DistributeAxis): Command | null {
  const h = axis === 'horizontal';
  const members = objects
    .filter((o) => ids.includes(o.id))
    .map((o) => {
      const b = objectBounds(o);
      return { o, start: h ? b.x : b.y, size: h ? b.width : b.height };
    })
    .sort((a, b) => a.start + a.size / 2 - (b.start + b.size / 2));
  if (members.length < 3) return null;
  const first = members[0];
  const last = members[members.length - 1];
  const span = last.start + last.size - first.start;
  const gap = (span - members.reduce((sum, m) => sum + m.size, 0)) / (members.length - 1);
  let at = first.start;
  return moves(
    members.map((m) => {
      const d = at - m.start;
      at += m.size + gap;
      return { o: m.o, dx: h ? d : 0, dy: h ? 0 : d };
    }),
  );
}
