import { describe, expect, it } from 'vitest';
import {
  anchorStroke,
  followResizedSheets,
  localToWorld,
  markAnchorAt,
  placeText,
  strokeHitAt,
  textHitAt,
  textWorldPosition,
  worldToLocal,
} from '../domain/annotations';
import { applyCommand } from '../domain/commands';
import { sceneBounds, snapPosition } from '../domain/geometry';
import { createObject } from '../domain/objects';
import { stampStroke, STAMP_SHAPES } from '../domain/stamps';
import type { InkStroke, TableState, TabletopObject } from '../domain/types';

function sheet(over: Partial<TabletopObject> = {}): TabletopObject {
  return { ...createObject('board', { center: { x: 100, y: 50 }, zIndex: 1 }), width: 200, height: 100, ...over } as TabletopObject;
}

const table = (objects: TabletopObject[], strokes: InkStroke[] = []): TableState => ({ objects, annotations: { strokes, text: [] } });

describe('marks on sheets', () => {
  it('converts between world and sheet coordinates, also for turned sheets', () => {
    const s = sheet({ position: { x: 0, y: 0 }, rotation: 90 });
    const local = { x: 20, y: 10 };
    const world = localToWorld(s, local);
    // Turned 90° about its centre (100, 50): the top-left corner goes to the top-right.
    expect(world.x).toBeCloseTo(140);
    expect(world.y).toBeCloseTo(-30);
    const back = worldToLocal(s, world);
    expect(back.x).toBeCloseTo(local.x);
    expect(back.y).toBeCloseTo(local.y);
  });

  it('finds the topmost visible sheet under a point; other pieces are not sheets', () => {
    const low = sheet({ id: 'low', position: { x: 0, y: 0 }, zIndex: 1 });
    const high = {
      ...createObject('image', { center: { x: 50, y: 50 }, zIndex: 5 }),
      id: 'high',
      position: { x: 30, y: 30 },
      width: 40,
      height: 40,
    } as TabletopObject;
    const hidden = sheet({ id: 'hidden', zIndex: 9, visible: false });
    const token = { ...createObject('token', { center: { x: 20, y: 20 }, zIndex: 10 }), id: 'tok' } as TabletopObject;
    const objects = [low, high, hidden, token];
    expect(markAnchorAt(objects, { x: 50, y: 50 })?.id).toBe('high');
    expect(markAnchorAt(objects, { x: 190, y: 90 })?.id).toBe('low');
    expect(markAnchorAt(objects, { x: 500, y: 500 })).toBeUndefined();
  });

  it('a stroke started on a sheet belongs to it; one started on the table stays world-anchored', () => {
    const s = sheet({ id: 's', position: { x: 100, y: 100 } });
    const stroke: InkStroke = { id: 'k', points: [110, 120, 150, 130], color: '#000', width: 4, opacity: 1 };
    const on = anchorStroke([s], stroke);
    expect(on).toMatchObject({ objectId: 's', points: [10, 20, 50, 30] });
    const offSheet = { ...stroke, points: [0, 0, 150, 130] };
    expect(anchorStroke([s], offSheet)).toBe(offSheet);
    // Placing text works the same way.
    expect(placeText([s], { x: 105, y: 110 })).toEqual({ objectId: 's', position: { x: 5, y: 10 } });
    expect(placeText([s], { x: 5.4, y: 9.6 })).toEqual({ position: { x: 5, y: 10 } });
  });

  it('marks move and turn with their sheet; the eraser finds them where they show', () => {
    const s = sheet({ id: 's', position: { x: 0, y: 0 } });
    const mark: InkStroke = { id: 'k', points: [10, 10, 30, 10], color: '#000', width: 2, opacity: 1, objectId: 's' };
    let state = table([s], [mark]);
    state = applyCommand(state, { type: 'MoveObject', id: 's', position: { x: 500, y: 300 } });
    expect(state.annotations.strokes[0]).toBe(mark);
    expect(strokeHitAt(state.objects, mark, { x: 520, y: 310 }, 2)).toBe(true);
    expect(strokeHitAt(state.objects, mark, { x: 20, y: 10 }, 2)).toBe(false);
    const text = { id: 't', position: { x: 10, y: 10 }, text: 'hi', fontSize: 20, color: '#000', objectId: 's' };
    expect(textWorldPosition(state.objects, text)).toEqual({ x: 510, y: 310 });
    expect(textHitAt(state.objects, text, { x: 515, y: 315 }, 1)).toBe(true);
    // A sheet that isn't on the table (e.g. in a bag) hides its marks.
    expect(strokeHitAt([], mark, { x: 20, y: 10 }, 2)).toBe(false);
    expect(textWorldPosition([], text)).toBeNull();
  });

  it('resizing a sheet stretches its marks; resizing something else leaves them', () => {
    const s = sheet({ id: 's', position: { x: 0, y: 0 } });
    const mark: InkStroke = { id: 'k', points: [10, 10, 100, 50], color: '#000', width: 4, opacity: 1, objectId: 's' };
    const free: InkStroke = { ...mark, id: 'f', objectId: undefined };
    const state = applyCommand(table([s], [mark, free]), {
      type: 'TransformObject',
      id: 's',
      position: { x: 0, y: 0 },
      width: 400,
      height: 200,
      rotation: 0,
    });
    expect(state.annotations.strokes[0]).toMatchObject({ points: [20, 20, 200, 100], width: 8 });
    expect(state.annotations.strokes[1]).toBe(free);
    // Once per batch, not once per level.
    const batched = applyCommand(table([s], [mark]), {
      type: 'Batch',
      commands: [{ type: 'UpdateObject', id: 's', patch: { width: 400 } }],
    });
    expect(batched.annotations.strokes[0].points).toEqual([20, 10, 200, 50]);
    const same = table([s], [mark]);
    expect(followResizedSheets(same, same)).toBe(same);
  });

  it('deleting a sheet removes its marks (undo brings both back); text can move off a sheet', () => {
    const s = sheet({ id: 's' });
    const mark: InkStroke = { id: 'k', points: [1, 1, 2, 2], color: '#000', width: 2, opacity: 1, objectId: 's' };
    const free: InkStroke = { ...mark, id: 'f', objectId: undefined };
    const after = applyCommand(table([s], [mark, free]), { type: 'DeleteObject', id: 's' });
    expect(after.annotations.strokes.map((x) => x.id)).toEqual(['f']);

    const withText: TableState = {
      objects: [s],
      annotations: { strokes: [], text: [{ id: 't', position: { x: 1, y: 2 }, text: 'x', fontSize: 10, color: '#000', objectId: 's' }] },
    };
    const moved = applyCommand(withText, { type: 'EditTextAnnotation', id: 't', patch: { position: { x: 9, y: 9 }, objectId: undefined } });
    expect(moved.annotations.text[0]).toEqual({ id: 't', position: { x: 9, y: 9 }, text: 'x', fontSize: 10, color: '#000' });
  });

  it('only marks on the table itself count for the scene bounds', () => {
    const mark: InkStroke = { id: 'k', points: [5000, 5000, 5010, 5010], color: '#000', width: 2, opacity: 1, objectId: 's' };
    expect(sceneBounds([], { strokes: [mark], text: [] })).toBeNull();
  });
});

describe('stamps', () => {
  it('are straight strokes centred on the click, sized as asked', () => {
    for (const shape of STAMP_SHAPES) {
      const s = stampStroke(shape, { x: 100, y: 200 }, 40, '#f00', 'id');
      expect(s).toMatchObject({ id: 'id', color: '#f00', straight: true, opacity: 1 });
      const xs = s.points.filter((_, i) => i % 2 === 0);
      const ys = s.points.filter((_, i) => i % 2 === 1);
      expect(Math.max(...xs.map((x) => Math.abs(x - 100)))).toBeLessThanOrEqual(20);
      expect(Math.max(...ys.map((y) => Math.abs(y - 200)))).toBeLessThanOrEqual(20);
    }
    expect(stampStroke('dot', { x: 1, y: 2 }, 40, '#000', 'd')).toMatchObject({ points: [1, 2], width: 20 });
  });

  it('a stamp on a sheet belongs to it', () => {
    const s = sheet({ id: 's', position: { x: 0, y: 0 } });
    const stamp = stampStroke('check', { x: 50, y: 50 }, 20, '#000', 'st');
    expect(anchorStroke([s], stamp, { x: 50, y: 50 }).objectId).toBe('s');
  });
});

describe('snap to grid', () => {
  it('puts the top-left corner of the bounding box on the grid', () => {
    expect(snapPosition({ width: 60, height: 40, rotation: 0 }, { x: 37, y: 74 }, 25)).toEqual({ x: 25, y: 75 });
    // Turned 90°: the box seen on the table is 40 × 60, its corner lands on the grid.
    const p = snapPosition({ width: 60, height: 40, rotation: 90 }, { x: 37, y: 74 }, 25);
    expect(p.x + 10).toBeCloseTo(50);
    expect(p.y - 10).toBeCloseTo(75);
  });
});
