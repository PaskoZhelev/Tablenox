import { describe, expect, it } from 'vitest';
import { applyCommand } from '../domain/commands';
import { objectCenter } from '../domain/geometry';
import { createObject } from '../domain/objects';
import { pasteObjects, copyObjects } from '../domain/clipboard';
import {
  cardSlots,
  findGroupDropTarget,
  pieceStacks,
  resolveDrop,
  resolveGroupDrop,
  spreadLayout,
  splitTokensCommand,
} from '../domain/rules';
import {
  MAX_TOKEN_STACK,
  type BagObject,
  type DeckObject,
  type TableState,
  type TabletopObject,
  type TokenObject,
  type Vec2,
} from '../domain/types';
import { fixtureGame, tableOf } from './fixtures';

const find = (s: TableState, id: string) => s.objects.find((o) => o.id === id)!;
const holderOf = (s: TableState) => s.objects.find((o): o is DeckObject => o.kind === 'deck' && o.name === 'Holder')!;
const deckOf = (s: TableState) => s.objects.find((o): o is DeckObject => o.kind === 'deck' && !o.isPile && o.cards.length > 0)!;
/** Top-left position that puts `o`'s centre at `p`. */
const centredAt = (o: TabletopObject, p: Vec2) => ({ x: p.x - o.width / 2, y: p.y - o.height / 2 });

/** The fixture with a wide, empty spread holder far from everything else and three dice off to the side. */
function setup(): TableState {
  let s = tableOf(fixtureGame());
  const holder = holderOf(s);
  s = applyCommand(s, {
    type: 'TransformObject',
    id: holder.id,
    position: { x: 3000, y: 3000 },
    width: 600,
    height: 160,
    rotation: 0,
  });
  s = applyCommand(s, { type: 'UpdateObject', id: holder.id, patch: { layout: 'spread' } });
  const dice = ['d1', 'd2', 'd3'].map((id, i) => ({
    ...createObject('die', { center: { x: 2000 + i * 100, y: 2000 }, zIndex: 50 + i }),
    id,
  }));
  return { ...s, objects: [...s.objects, ...dice] };
}

/** Drops `id` with its centre at `p` (as a single drag would). */
function dropAt(s: TableState, id: string, p: Vec2, free = false): TableState {
  return applyCommand(s, resolveDrop(s, id, centredAt(find(s, id), p), 'play', { free }));
}

describe('pieces in holders', () => {
  it('a piece dropped on a spread holder goes into it and lines up in the order they were dropped along it', () => {
    let s = setup();
    const h = holderOf(s);
    const cy = h.position.y + h.height / 2;
    s = dropAt(s, 'd1', { x: h.position.x + 400, y: cy });
    expect(find(s, 'd1').holderId).toBe(h.id);
    // Dropped left of d1, d2 comes first.
    s = dropAt(s, 'd2', { x: h.position.x + 100, y: cy + 20 });
    const d1 = find(s, 'd1');
    const d2 = find(s, 'd2');
    expect(d2.position.x).toBeLessThan(d1.position.x);
    // Centred across the holder, both inside it, a step apart.
    expect(objectCenter(d1).y).toBeCloseTo(cy, 0);
    expect(objectCenter(d2).y).toBeCloseTo(cy, 0);
    expect(d1.position.x - d2.position.x).toBe(d1.width + 8);
    expect(d2.position.x).toBeGreaterThanOrEqual(h.position.x);
    expect(d1.position.x + d1.width).toBeLessThanOrEqual(h.position.x + h.width);
  });

  it('a piece taken out of a spread closes the gap; Shift places one freely without putting it in', () => {
    let s = setup();
    const h = holderOf(s);
    const cy = h.position.y + h.height / 2;
    s = dropAt(s, 'd1', { x: h.position.x + 100, y: cy });
    s = dropAt(s, 'd2', { x: h.position.x + 300, y: cy });
    s = dropAt(s, 'd3', { x: h.position.x + 500, y: cy });
    const firstX = find(s, 'd1').position.x;
    s = dropAt(s, 'd1', { x: 0, y: 0 });
    expect(find(s, 'd1').holderId).toBeUndefined();
    // The two that are left move together around the centre: d2 now starts where the pair starts.
    const pair = spreadLayout(s.objects, holderOf(s)).pieces;
    expect(pair.map((p) => p.id)).toEqual(['d2', 'd3']);
    expect(find(s, 'd2').position.x).toBeGreaterThan(firstX);
    s = dropAt(s, 'd1', { x: h.position.x + 20, y: cy }, true);
    expect(find(s, 'd1').holderId).toBeUndefined();
    expect(spreadLayout(s.objects, holderOf(s)).pieces).toHaveLength(2);
  });

  it('cards and pieces share one row in a spread: the cards first, making room for the pieces', () => {
    let s = setup();
    const deck = deckOf(s);
    s = applyCommand(s, { type: 'UpdateObject', id: deck.id, patch: { layout: 'spread', width: 700 } });
    const before = cardSlots(s.objects, deckOf(s));
    const dc = objectCenter(deckOf(s));
    s = dropAt(s, 'd1', { x: deckOf(s).position.x + 20, y: dc.y });
    expect(find(s, 'd1').holderId).toBe(deck.id);
    const after = cardSlots(s.objects, deckOf(s));
    const last = Math.max(...after.map((sl) => sl.x + sl.width));
    // The die lies after (right of) every card, inside the holder, and the cards moved left to make room.
    const dieX = find(s, 'd1').position.x - deckOf(s).position.x;
    expect(dieX).toBeGreaterThan(Math.max(...after.map((sl) => sl.x)));
    expect(dieX + find(s, 'd1').width).toBeGreaterThan(last);
    expect(dieX + find(s, 'd1').width).toBeLessThanOrEqual(deckOf(s).width);
    expect(after[0].x).toBeLessThan(before[0].x);
    // Drawing a card closes up the row, the die moves along.
    const x0 = find(s, 'd1').position.x;
    s = applyCommand(s, { type: 'DrawCard', deckId: deck.id, cardId: 'drawn', position: { x: 0, y: 0 }, faceUp: true });
    expect(find(s, 'd1').position.x).not.toBe(x0);
  });

  it('pieces move and turn with their holder, without being moved twice when they are moved along with it', () => {
    let s = setup();
    const h = holderOf(s);
    s = applyCommand(s, { type: 'UpdateObject', id: h.id, patch: { layout: 'stack' } });
    s = dropAt(s, 'd1', objectCenter(h));
    expect(find(s, 'd1').holderId).toBe(h.id);
    const offset = (id: string) => ({
      x: objectCenter(find(s, id)).x - objectCenter(holderOf(s)).x,
      y: objectCenter(find(s, id)).y - objectCenter(holderOf(s)).y,
    });
    expect(offset('d1')).toEqual({ x: 0, y: 0 });
    s = applyCommand(s, { type: 'MoveObject', id: h.id, position: { x: h.position.x + 50, y: h.position.y - 30 } });
    expect(offset('d1')).toEqual({ x: 0, y: 0 });
    // A die off-centre on a holder that is turned 90° swings round with it.
    s = applyCommand(s, { type: 'UpdateObject', id: h.id, patch: { snapToCenter: false } });
    s = dropAt(s, 'd2', { x: objectCenter(holderOf(s)).x + 100, y: objectCenter(holderOf(s)).y });
    const hb = holderOf(s);
    s = applyCommand(s, { type: 'TransformObject', id: hb.id, position: hb.position, width: hb.width, height: hb.height, rotation: 90 });
    expect(offset('d2').x).toBeCloseTo(0, 0);
    expect(offset('d2').y).toBeCloseTo(100, 0);
    expect(find(s, 'd2').rotation).toBe(90);
    // Nudged together with its holder (the piece listed first): moved once.
    const d1 = find(s, 'd1');
    const hc = holderOf(s);
    s = applyCommand(s, {
      type: 'Batch',
      commands: [
        { type: 'MoveObject', id: d1.id, position: { x: d1.position.x + 10, y: d1.position.y } },
        { type: 'MoveObject', id: hc.id, position: { x: hc.position.x + 10, y: hc.position.y } },
      ],
    });
    expect(find(s, 'd1').position.x).toBe(d1.position.x + 10);
    expect(find(s, 'd1').holderId).toBe(h.id);
  });

  it('a selection dropped on a holder goes in: cards join it, pieces line up; dropped on a bag, the bag takes them', () => {
    let s = setup();
    const h = holderOf(s);
    const card = s.objects.find((o) => o.kind === 'card')!;
    const ids = ['d1', 'd2', card.id];
    const hc = objectCenter(h);
    // The dragged die is over the holder; the rest keep their places relative to it, partly off the holder.
    const moves = [
      { id: 'd1', position: centredAt(find(s, 'd1'), hc) },
      { id: 'd2', position: centredAt(find(s, 'd2'), { x: hc.x + 150, y: hc.y + 120 }) },
      { id: card.id, position: centredAt(card, { x: hc.x - 150, y: hc.y }) },
    ];
    expect(findGroupDropTarget(s, ids, hc)?.id).toBe(h.id);
    s = applyCommand(s, resolveGroupDrop(s, moves, 'd1', 'play'));
    expect(holderOf(s).cards).toHaveLength(1);
    expect(s.objects.some((o) => o.id === card.id)).toBe(false);
    expect(find(s, 'd1').holderId).toBe(h.id);
    expect(find(s, 'd2').holderId).toBe(h.id);
    expect(spreadLayout(s.objects, holderOf(s)).pieces.map((p) => p.id)).toEqual(['d1', 'd2']);
    expect(objectCenter(find(s, 'd2')).y).toBeCloseTo(hc.y, 0);

    // A stack that centres pieces piles them up in its centre.
    s = setup();
    s = applyCommand(s, { type: 'UpdateObject', id: holderOf(s).id, patch: { layout: 'stack' } });
    const stackMoves = moves.slice(0, 2);
    s = applyCommand(s, resolveGroupDrop(s, stackMoves, 'd1', 'play'));
    expect(objectCenter(find(s, 'd1'))).toEqual(hc);
    expect(objectCenter(find(s, 'd2'))).toEqual(hc);

    // A bag takes the dice; with Shift they just move.
    s = setup();
    const bag = s.objects.find((o): o is BagObject => o.kind === 'bag')!;
    const bc = objectCenter(bag);
    const bagMoves = [
      { id: 'd1', position: centredAt(find(s, 'd1'), bc) },
      { id: 'd2', position: centredAt(find(s, 'd2'), { x: bc.x + 80, y: bc.y }) },
    ];
    const free = applyCommand(s, resolveGroupDrop(s, bagMoves, 'd1', 'play', { free: true }));
    expect(find(free, 'd1').position).toEqual(bagMoves[0].position);
    s = applyCommand(s, resolveGroupDrop(s, bagMoves, 'd1', 'play'));
    expect(s.objects.some((o) => o.id === 'd1' || o.id === 'd2')).toBe(false);
    expect((find(s, bag.id) as BagObject).items.map((i) => i.id)).toEqual(expect.arrayContaining(['d1', 'd2']));
    expect((find(s, bag.id) as BagObject).items.every((i) => i.holderId === undefined)).toBe(true);
  });

  it('a pile does not take dice from a dropped selection; dice dropped elsewhere leave their holder', () => {
    let s = setup();
    s = applyCommand(s, { type: 'TakeStack', deckId: deckOf(s).id, pileId: 'pile', position: { x: 5000, y: 5000 } });
    const pc = objectCenter(find(s, 'pile'));
    expect(findGroupDropTarget(s, ['d1', 'd2'], pc)).toBeUndefined();
    const h = holderOf(s);
    s = dropAt(s, 'd1', objectCenter(h));
    const moves = [{ id: 'd1', position: { x: 10, y: 10 } }];
    s = applyCommand(s, resolveGroupDrop(s, moves, 'd1', 'play'));
    expect(find(s, 'd1')).toMatchObject({ position: { x: 10, y: 10 } });
    expect(find(s, 'd1').holderId).toBeUndefined();
  });

  it('identical tokens put into a slot pile up as one stack with a count; other tokens and spreads keep them apart', () => {
    let s = setup();
    s = applyCommand(s, { type: 'UpdateObject', id: holderOf(s).id, patch: { layout: 'stack' } });
    const h = holderOf(s);
    const token = s.objects.find((o): o is TokenObject => o.kind === 'token')!;
    const twin = (id: string, patch: Partial<TokenObject> = {}): TokenObject => ({
      ...token,
      id,
      position: { x: 1500 + s.objects.length * 80, y: 1500 },
      zIndex: 90,
      ...patch,
    });
    s = { ...s, objects: [...s.objects, twin('t2'), twin('t3'), twin('red', { color: '#ff0000' })] };
    const hc = objectCenter(h);
    // Dropped on the holder (not on the token already there): it joins that token's stack.
    s = dropAt(s, token.id, hc);
    s = dropAt(s, 't2', { x: h.position.x + 20, y: h.position.y + 20 });
    expect(s.objects.some((o) => o.id === 't2')).toBe(false);
    expect((find(s, token.id) as TokenObject).count).toBe(2);
    // A token that looks different lies on top as itself.
    s = dropAt(s, 'red', hc);
    expect(find(s, 'red').holderId).toBe(h.id);
    expect((find(s, token.id) as TokenObject).count).toBe(2);
    // A group drop counts the tokens it puts in on the way; never past the stack limit.
    s = applyCommand(s, resolveGroupDrop(s, [{ id: 't3', position: centredAt(find(s, 't3'), hc) }], 't3', 'play'));
    expect((find(s, token.id) as TokenObject).count).toBe(3);
    s = applyCommand(s, { type: 'UpdateObject', id: token.id, patch: { count: MAX_TOKEN_STACK } });
    s = { ...s, objects: [...s.objects, twin('t4')] };
    s = dropAt(s, 't4', hc);
    expect(find(s, 't4').holderId).toBe(h.id);

    // Two loose identical tokens dropped together make one stack; in a spread they stay side by side.
    s = setup();
    const t = s.objects.find((o): o is TokenObject => o.kind === 'token')!;
    s = { ...s, objects: [...s.objects, { ...t, id: 'u2', position: { x: t.position.x + 100, y: t.position.y } }] };
    const pair = (st: TableState) => [
      { id: t.id, position: centredAt(t, objectCenter(holderOf(st))) },
      { id: 'u2', position: centredAt(t, { x: objectCenter(holderOf(st)).x + 100, y: objectCenter(holderOf(st)).y }) },
    ];
    const spread = applyCommand(s, resolveGroupDrop(s, pair(s), t.id, 'play'));
    expect(spread.objects.filter((o) => o.kind === 'token' && o.holderId)).toHaveLength(2);
    s = applyCommand(s, { type: 'UpdateObject', id: holderOf(s).id, patch: { layout: 'stack' } });
    s = applyCommand(s, resolveGroupDrop(s, pair(s), t.id, 'play'));
    const inHolder = s.objects.filter((o): o is TokenObject => o.kind === 'token' && o.holderId === holderOf(s).id);
    expect(inHolder).toHaveLength(1);
    expect(inHolder[0].count).toBe(2);
  });

  it('copies and tokens taken off a stack are not in the holder', () => {
    let s = setup();
    const h = holderOf(s);
    const token = s.objects.find((o) => o.kind === 'token')!;
    s = applyCommand(s, { type: 'UpdateObject', id: token.id, patch: { count: 3 } });
    s = dropAt(s, token.id, objectCenter(h));
    expect(find(s, token.id).holderId).toBe(h.id);
    const split = splitTokensCommand(find(s, token.id) as TokenObject, 1, { x: 0, y: 0 })!;
    s = applyCommand(s, split);
    const taken = s.objects.find((o) => o.kind === 'token' && o.id !== token.id)!;
    expect(taken.holderId).toBeUndefined();
    const pasted = pasteObjects(copyObjects(s.objects, [token.id], '')!, s, { x: 0, y: 0 });
    expect(pasted[0].holderId).toBeUndefined();
    const both = pasteObjects(copyObjects(s.objects, [token.id, h.id], '')!, s, { x: 0, y: 0 });
    expect(both.find((o) => o.kind === 'token')!.holderId).toBe(both.find((o) => o.kind === 'deck')!.id);
  });
  it('different pieces in a stacked holder form one stack: its top piece carries the count, a badge drag moves them all', () => {
    let s = setup();
    const h = holderOf(s);
    s = applyCommand(s, { type: 'UpdateObject', id: h.id, patch: { layout: 'stack' } });
    const a = { ...createObject('token', { center: { x: 2000, y: 2400 }, zIndex: 60 }), id: 'ta', assetId: 'img-a' } as TokenObject;
    const b = {
      ...createObject('token', { center: { x: 2100, y: 2400 }, zIndex: 61 }),
      id: 'tb',
      assetId: 'img-b',
      count: 3,
    } as TokenObject;
    s = { ...s, objects: [...s.objects, a, b] };
    s = dropAt(s, 'ta', objectCenter(holderOf(s)));
    expect(pieceStacks(s.objects).size).toBe(0);
    s = dropAt(s, 'tb', objectCenter(holderOf(s)));
    s = dropAt(s, 'd1', objectCenter(holderOf(s)));
    // Different looks don't merge, but they stack: the top piece (the die dropped last) shows 1 + 3 + 1.
    expect(
      s.objects
        .filter((o) => o.holderId === h.id)
        .map((o) => o.id)
        .sort(),
    ).toEqual(['d1', 'ta', 'tb']);
    expect(pieceStacks(s.objects).get('d1')).toEqual({ holderId: h.id, ids: ['ta', 'tb', 'd1'], count: 5 });
    // Dragging the badge moves the stack as a selection: onto the table they all leave the holder�
    const off = (id: string) => ({ id, position: centredAt(find(s, id), { x: 9000, y: 9000 }) });
    const out = applyCommand(s, resolveGroupDrop(s, ['ta', 'tb', 'd1'].map(off), 'd1', 'play'));
    expect(['ta', 'tb', 'd1'].every((id) => !find(out, id).holderId)).toBe(true);
    expect(pieceStacks(out.objects).size).toBe(0);
    // �and onto another stacked holder they go in and stack there.
    const other = { ...createObject('deck', { center: { x: 6000, y: 6000 }, zIndex: 1 }), id: 'other', cards: [] } as DeckObject;
    let t: TableState = { ...s, objects: [...s.objects, other] };
    const onto = (id: string) => ({ id, position: centredAt(find(t, id), { x: 6000, y: 6000 }) });
    t = applyCommand(t, resolveGroupDrop(t, ['ta', 'tb', 'd1'].map(onto), 'd1', 'play'));
    expect(pieceStacks(t.objects).get('d1')).toMatchObject({ holderId: 'other', count: 5 });
    // A spread lays its pieces out instead, and one that doesn't centre pieces leaves them where they were dropped.
    expect(pieceStacks(applyCommand(t, { type: 'UpdateObject', id: 'other', patch: { layout: 'spread' } }).objects).size).toBe(0);
    expect(pieceStacks(applyCommand(t, { type: 'UpdateObject', id: 'other', patch: { snapToCenter: false } }).objects).size).toBe(0);
  });
});
