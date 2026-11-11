import { objectCenter, pointInHolderShape } from './geometry';
import { cardRotationOf, cardSizeOf, cardTurnOf, isHolder, ownerDeckOf, resolveCardLook, sortByStacking } from './objects';
import type { DeckObject, TableState, TabletopObject, Vec2 } from './types';

export const HOLDER_PADDING = 10;

export function rotateVec(v: Vec2, degrees: number): Vec2 {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/** True when `p` lies inside the (possibly rotated) object; for a shaped holder, inside its shape. */
export function pointInObject(p: Vec2, o: TabletopObject): boolean {
  const c = objectCenter(o);
  const local = rotateVec({ x: p.x - c.x, y: p.y - c.y }, -o.rotation);
  if (Math.abs(local.x) > o.width / 2 || Math.abs(local.y) > o.height / 2) return false;
  if (o.kind !== 'deck' || o.isPile || !o.zoneShape || o.zoneShape === 'rectangle') return true;
  return pointInHolderShape({ x: local.x + o.width / 2, y: local.y + o.height / 2 }, o.zoneShape, o.width, o.height);
}

/** `p` in the object's own, unrotated frame (origin at its top-left corner). */
export function toLocal(p: Vec2, o: TabletopObject): Vec2 {
  const c = objectCenter(o);
  const local = rotateVec({ x: p.x - c.x, y: p.y - c.y }, -o.rotation);
  return { x: local.x + o.width / 2, y: local.y + o.height / 2 };
}

export interface CardSlot {
  /** Index into `deck.cards`. */
  index: number;
  /** Top-left corner in the holder's unrotated frame. */
  x: number;
  y: number;
  /** Size of the slot: the box around the card as turned by the holder's `cardRotation`. */
  width: number;
  height: number;
}

/** Where a piece put into a spread holder lies, in the holder's own frame (the box around it as turned there). */
export interface PieceSlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isSpread(deck: DeckObject): boolean {
  return !deck.isPile && deck.layout === 'spread';
}

/** A spread runs down a holder that is taller than it is wide. */
export function spreadsVertically(deck: DeckObject): boolean {
  return deck.height > deck.width;
}

const normalizeDegrees = (d: number) => ((d % 360) + 360) % 360;

/** Size of the box around a `size` card turned by `degrees`. */
export function rotatedBox(size: { width: number; height: number }, degrees: number): { width: number; height: number } {
  if (degrees % 180 === 0) return { width: size.width, height: size.height };
  if (degrees % 90 === 0) return { width: size.height, height: size.width };
  const r = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  return { width: size.width * cos + size.height * sin, height: size.width * sin + size.height * cos };
}

/** Objects that go into a holder as loose pieces (`holderId`); cards and piles join its cards instead. */
export function joinsHolder(o: TabletopObject): boolean {
  return o.kind !== 'board' && o.kind !== 'bag' && o.kind !== 'card' && o.kind !== 'deck';
}

const piecesCache = new WeakMap<readonly TabletopObject[], Map<string, TabletopObject[]>>();

/** Holder id -> the pieces put into it, cached per (immutable) objects array, so store selectors can call it. */
function piecesByHolder(objects: readonly TabletopObject[]): Map<string, TabletopObject[]> {
  let map = piecesCache.get(objects);
  if (!map) {
    map = new Map();
    for (const o of objects) {
      if (!o.holderId || !o.visible || o.locked || !joinsHolder(o)) continue;
      const list = map.get(o.holderId);
      if (list) list.push(o);
      else map.set(o.holderId, [o]);
    }
    piecesCache.set(objects, map);
  }
  return map;
}

const NO_PIECES: TabletopObject[] = [];

/**
 * The pieces (dice, tokens, counters…) put into holder `deck`: they move with it and, in a spread, line up after its
 * cards. Locked and hidden ones stay where they are.
 */
export function holderPieces(objects: readonly TabletopObject[], deck: DeckObject): TabletopObject[] {
  return (!deck.isPile && piecesByHolder(objects).get(deck.id)) || NO_PIECES;
}

/** Whether a holder piles the pieces put into it on its centre as one stack (a stacked holder that centres pieces). */
export function stacksPieces(deck: DeckObject): boolean {
  return !deck.isPile && !isSpread(deck) && deck.snapToCenter !== false;
}

/** Pieces a piece counts for in a stack: every token of a token stack, one for anything else. */
const pieceWeight = (o: TabletopObject) => (o.kind === 'token' ? (o.count ?? 1) : 1);

/** A stack of pieces, bottom first, and how many pieces that makes: in a holder (`holderId`) or a loose pile (`stackId`). */
export interface PieceStack {
  holderId?: string;
  stackId?: string;
  ids: string[];
  count: number;
}

const pieceStackCache = new WeakMap<readonly TabletopObject[], Map<string, PieceStack>>();

/** How far apart (world units) the centres of pieces of one loose pile may be (centring rounds to whole units). */
const PILE_CENTRE_SLOP = 2;

/**
 * Top piece id -> the stack it tops: every stacked holder (`stacksPieces`) holding 2+ pieces (a token stack counts each
 * token), and every loose pile of 2+ pieces (sharing a `stackId` and lying on the same centre; a piece of a pile moved
 * elsewhere, e.g. by an automation, is no longer part of it). Like a holder's cards, the stack shows one count badge on
 * its top piece, which drags the whole stack. Cached per (immutable) objects array, so store selectors can call it.
 */
export function pieceStacks(objects: readonly TabletopObject[]): Map<string, PieceStack> {
  let map = pieceStackCache.get(objects);
  if (!map) {
    map = new Map();
    const all = objects as TabletopObject[];
    const weigh = (pieces: readonly TabletopObject[]) => pieces.reduce((n, p) => n + pieceWeight(p), 0);
    for (const [holderId, pieces] of piecesByHolder(objects)) {
      const holder = objects.find((o) => o.id === holderId);
      if (holder?.kind !== 'deck' || !stacksPieces(holder)) continue;
      const count = weigh(pieces);
      if (count < 2) continue;
      const ids = sortByStacking(pieces, all).map((p) => p.id);
      map.set(ids[ids.length - 1], { holderId, ids, count });
    }
    const piles = new Map<string, TabletopObject[]>();
    for (const o of objects) {
      if (!o.stackId || o.holderId || !o.visible || o.locked || !joinsHolder(o)) continue;
      piles.set(o.stackId, [...(piles.get(o.stackId) ?? []), o]);
    }
    for (const [stackId, pieces] of piles) {
      // From the top down, each piece joins the group lying on its centre (the top piece's group is the pile).
      const groups: { at: Vec2; members: TabletopObject[] }[] = [];
      for (const p of sortByStacking(pieces, all).reverse()) {
        const c = objectCenter(p);
        const g = groups.find((x) => Math.abs(x.at.x - c.x) <= PILE_CENTRE_SLOP && Math.abs(x.at.y - c.y) <= PILE_CENTRE_SLOP);
        if (g) g.members.push(p);
        else groups.push({ at: c, members: [p] });
      }
      for (const { members } of groups) {
        const count = weigh(members);
        if (count < 2) continue;
        const ids = members.map((p) => p.id).reverse();
        map.set(ids[ids.length - 1], { stackId, ids, count });
      }
    }
    pieceStackCache.set(objects, map);
  }
  return map;
}

let movingStacksCache: { objects: readonly TabletopObject[]; key: string; map: Map<string, PieceStack> } | null = null;

/**
 * `pieceStacks` while the pieces `moving` are being dragged: a stack only some of whose pieces are dragged off splits
 * into what stays (its badge moves to the new top piece) and what is dragged (a badge only if 2+ pieces go). A stack
 * dragged as a whole (e.g. by its badge) keeps its badge.
 */
export function pieceStacksWhileMoving(objects: readonly TabletopObject[], moving: readonly string[]): Map<string, PieceStack> {
  const stacks = pieceStacks(objects);
  if (moving.length === 0) return stacks;
  const set = new Set(moving);
  const split = [...stacks.values()].some((s) => s.ids.some((id) => set.has(id)) && !s.ids.every((id) => set.has(id)));
  if (!split) return stacks;
  const key = [...set].sort().join('\n');
  if (movingStacksCache?.objects !== objects || movingStacksCache.key !== key) {
    const part = (dragged: boolean) => pieceStacks(objects.filter((o) => !joinsHolder(o) || set.has(o.id) === dragged));
    movingStacksCache = { objects, key, map: new Map([...part(false), ...part(true)]) };
  }
  return movingStacksCache.map;
}

/** The loose pile `o` lies in (2+ pieces), if any. */
export function loosePileOf(objects: readonly TabletopObject[], o: TabletopObject): PieceStack | undefined {
  if (!o.stackId || o.holderId) return undefined;
  for (const s of pieceStacks(objects).values()) if (s.stackId === o.stackId && s.ids.includes(o.id)) return s;
  return undefined;
}

/** The pieces of a spread holder in their order along it (first = nearest the start of the row / column). */
function spreadPieces(objects: readonly TabletopObject[], deck: DeckObject): TabletopObject[] {
  const vertical = spreadsVertically(deck);
  const along = (o: TabletopObject) => {
    const p = toLocal(objectCenter(o), deck);
    return vertical ? p.y : p.x;
  };
  return [...holderPieces(objects, deck)].sort((a, b) => along(a) - along(b) || a.zIndex - b.zIndex);
}

/** Size of a piece's box in the holder's frame (a piece turned with the holder is upright there). */
function pieceBox(o: TabletopObject, deck: DeckObject): { width: number; height: number } {
  return rotatedBox(o, normalizeDegrees(o.rotation - deck.rotation));
}

/**
 * Card positions of a holder/pile; for a spread with `gapAt` (an index into `cards`, as for `AddCardToDeck`)
 * the cards make room for one more card there, and `gap` is that empty place. A spread holder also lines up the
 * pieces put into it after its cards (`pieces`; pass them in `objects`).
 */
export function spreadLayout(
  objects: readonly TabletopObject[],
  deck: DeckObject,
  gapAt?: number | null,
): { slots: CardSlot[]; gap?: Omit<CardSlot, 'index'>; pieces: PieceSlot[] } {
  const n = deck.cards.length;
  const spread = isSpread(deck);
  const withGap = spread && gapAt !== undefined && gapAt !== null;
  const members = spread ? spreadPieces(objects, deck) : [];
  if (n === 0 && !withGap && members.length === 0) return { slots: [], pieces: [] };
  const turn = cardRotationOf(deck);
  const slotSize = (s: { width: number; height: number }, degrees = turn) => rotatedBox(s, degrees);
  const all = objects as TabletopObject[];
  const look = (i: number) =>
    slotSize(resolveCardLook(deck.cards[i], deck, ownerDeckOf(all, deck.cards[i].id)), cardTurnOf(deck, deck.cards[i]));
  if (!spread) {
    const l = look(0);
    return {
      slots: [{ index: 0, x: (deck.width - l.width) / 2, y: (deck.height - l.height) / 2, width: l.width, height: l.height }],
      pieces: [],
    };
  }
  // Lay out along the main axis (x for a row, y for a column); the cross axis centres each card and piece.
  const vertical = spreadsVertically(deck);
  const main = (s: { width: number; height: number }) => (vertical ? s.height : s.width);
  const cross = (s: { width: number; height: number }) => (vertical ? s.width : s.height);
  const length = main(deck);
  const looks = deck.cards.map((_, i) => look(i));
  const pieceLooks = members.map((m) => pieceBox(m, deck));
  const own = slotSize(cardSizeOf(deck));
  const mains = [...looks, ...pieceLooks].map(main);
  const slotMain = mains.length ? Math.max(...mains) : main(own);
  const at = withGap ? Math.max(0, Math.min(n, gapAt)) : -1;
  const cardPlaces = n + (withGap ? 1 : 0);
  const places = cardPlaces + members.length;
  const avail = length - HOLDER_PADDING * 2;
  const step = places > 1 ? Math.min(slotMain + 8, Math.max(8, (avail - slotMain) / (places - 1))) : 0;
  const total = slotMain + step * (places - 1);
  const align = deck.spreadAlign ?? 'center';
  const start =
    align === 'start'
      ? HOLDER_PADDING
      : align === 'end'
        ? Math.max(HOLDER_PADDING, length - HOLDER_PADDING - total)
        : Math.max(HOLDER_PADDING, (length - total) / 2);
  const place = (along: number, size: { width: number; height: number }) => {
    const across = (cross(deck) - cross(size)) / 2;
    return vertical ? { x: across, y: along, ...size } : { x: along, y: across, ...size };
  };
  // The bottom card (last index) comes first, the top card (index 0) last (right-most / bottom-most) and drawn last.
  // The gap takes the place the inserted card would get: after every card with index >= `at`.
  const placeOf = (i: number) => (withGap && i < at ? cardPlaces - 1 - i : n - 1 - i);
  const slots = looks
    .map((l, i) => ({
      index: i,
      ...place(start + placeOf(i) * step + (slotMain - main(l)) / 2, { width: l.width, height: l.height }),
    }))
    .reverse();
  const pieces = members.map((m, j) => ({
    id: m.id,
    ...place(start + (cardPlaces + j) * step + (slotMain - main(pieceLooks[j])) / 2, pieceLooks[j]),
  }));
  if (!withGap) return { slots, pieces };
  const gapSize = vertical ? { width: own.width, height: slotMain } : { width: slotMain, height: own.height };
  return { slots, gap: place(start + (n - at) * step, gapSize), pieces };
}

/**
 * The pieces of holder `id` follow it when it moves or turns between `prev` and `next` (pieces the same command
 * already moved, or listed in `moved`, keep their place).
 */
export function carryHolderPieces(prev: TableState, next: TableState, id: string, moved: ReadonlySet<string>): TableState {
  const before = prev.objects.find((o) => o.id === id);
  const after = next.objects.find((o) => o.id === id);
  if (!isHolder(before) || !isHolder(after) || before === after) return next;
  const members = holderPieces(prev.objects, before).filter((m) => !moved.has(m.id));
  if (members.length === 0) return next;
  const c0 = objectCenter(before);
  const c1 = objectCenter(after);
  const turn = after.rotation - before.rotation;
  if (c0.x === c1.x && c0.y === c1.y && turn === 0) return next;
  const old = new Map(members.map((m) => [m.id, m]));
  return {
    ...next,
    objects: next.objects.map((o) => {
      const m = old.get(o.id);
      if (!m || o.position.x !== m.position.x || o.position.y !== m.position.y) return o;
      const c = objectCenter(o);
      const off = rotateVec({ x: c.x - c0.x, y: c.y - c0.y }, turn);
      const position = { x: Math.round(c1.x + off.x - o.width / 2), y: Math.round(c1.y + off.y - o.height / 2) };
      return { ...o, position, rotation: turn ? normalizeDegrees(o.rotation + turn) : o.rotation };
    }),
  };
}

/**
 * Keeps the pieces put into holders in order after a change from `prev` to `next`: a piece moved off its holder (or
 * whose holder is gone) leaves it, and the pieces of a spread holder line up after its cards. Same state when
 * nothing changes.
 */
export function settleHolderPieces(prev: TableState, next: TableState): TableState {
  if (!next.objects.some((o) => o.holderId)) return next;
  const byId = new Map(next.objects.map((o) => [o.id, o]));
  const before = new Map(prev.objects.map((o) => [o.id, o]));
  let objects = next.objects;
  const left = new Set<string>();
  for (const o of objects) {
    if (!o.holderId) continue;
    const holder = byId.get(o.holderId);
    const was = before.get(o.id);
    // A piece the same command put in stays in, even when its centre landed just outside (part of a group drop).
    const movedOff =
      !!was &&
      was.holderId === o.holderId &&
      (was.position.x !== o.position.x || was.position.y !== o.position.y) &&
      !!holder &&
      !pointInObject(objectCenter(o), holder);
    if (!isHolder(holder) || !joinsHolder(o) || movedOff) left.add(o.id);
  }
  if (left.size) {
    objects = objects.map((o) => {
      if (!left.has(o.id)) return o;
      const { holderId: _holder, ...rest } = o;
      return rest as TabletopObject;
    });
  }
  const moves = new Map<string, Vec2>();
  const grouped = piecesByHolder(objects);
  for (const [holderId, members] of grouped) {
    const holder = byId.get(holderId);
    if (!isHolder(holder) || !isSpread(holder)) continue;
    const { pieces } = spreadLayout(objects, holder);
    const c = objectCenter(holder);
    const own = new Map(members.map((m) => [m.id, m]));
    for (const p of pieces) {
      const o = own.get(p.id)!;
      const off = rotateVec({ x: p.x + p.width / 2 - holder.width / 2, y: p.y + p.height / 2 - holder.height / 2 }, holder.rotation);
      const position = { x: Math.round(c.x + off.x - o.width / 2), y: Math.round(c.y + off.y - o.height / 2) };
      if (position.x !== o.position.x || position.y !== o.position.y) moves.set(o.id, position);
    }
  }
  if (moves.size) objects = objects.map((o) => (moves.has(o.id) ? { ...o, position: moves.get(o.id)! } : o));
  return objects === next.objects ? next : { ...next, objects };
}
