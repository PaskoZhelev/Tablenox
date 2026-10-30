import { objectBounds, unionRects } from './geometry';
import { newId } from './ids';
import { sortByZ } from './objects';
import type { BagItem, ButtonStep, CardDef, ObjectId, TableState, TabletopObject, Vec2 } from './types';

export const CLIPBOARD_VERSION = 1;

/** Objects copied with Copy (Ctrl+C), kept outside any game so they can be pasted into another one. */
export interface ClipboardData {
  version: typeof CLIPBOARD_VERSION;
  objects: TabletopObject[];
  /** When they were copied (ISO time); tells one copy from another. */
  copiedAt: string;
}

/** The objects `ids` (in stacking order) as clipboard contents, or null when none of them exists. */
export function copyObjects(objects: TabletopObject[], ids: readonly ObjectId[], copiedAt: string): ClipboardData | null {
  const picked = sortByZ(objects.filter((o) => ids.includes(o.id)));
  if (picked.length === 0) return null;
  return { version: CLIPBOARD_VERSION, objects: structuredClone(picked), copiedAt };
}

/** Centre of the box around the copied objects. */
export function clipboardCenter(data: ClipboardData): Vec2 {
  const box = unionRects(data.objects.map(objectBounds));
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: 0, y: 0 };
}

/**
 * Fresh copies of the clipboard objects for `table`, moved by `offset`, with new ids for the objects, their cards
 * and bag contents. References among the copied objects (a card's holder, a token's stack, an automation's step
 * objects, a piece's bag) follow the copies. Like Duplicate, a copy is never part of a bag or token stack that
 * wasn't copied with it; a card's holder and an automation's other objects are kept only when `table` has them
 * (pasting into the same game). Copies go on top of `table` in their order, boards underneath everything.
 */
export function pasteObjects(data: ClipboardData, table: TableState, offset: Vec2): TabletopObject[] {
  const ids = new Map<string, string>();
  const cardIds = new Map<string, string>();
  const fresh = (map: Map<string, string>, id: string) => {
    let next = map.get(id);
    if (!next) map.set(id, (next = newId()));
    return next;
  };
  for (const o of data.objects) ids.set(o.id, newId());
  // Card definitions owned by a copied holder follow it, so its loose cards still belong to the copy.
  for (const o of data.objects) if (o.kind === 'deck') o.initialCards.forEach((c) => fresh(cardIds, c.id));
  const existing = new Set(table.objects.map((o) => o.id));
  const ref = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : (ids.get(id) ?? (existing.has(id) ? id : undefined));
  const refs = (list: ObjectId[]) => list.map(ref).filter((id): id is string => id !== undefined);
  const card = (c: CardDef): CardDef => ({ ...c, id: cardIds.get(c.id) ?? newId() });

  const copy = <T extends TabletopObject>(o: T, id: string, bagId: string | undefined): T => {
    const out = { ...structuredClone(o), id } as TabletopObject;
    if (bagId) out.bagId = bagId;
    else delete out.bagId;
    switch (out.kind) {
      case 'card': {
        const owner = ref(out.sourceDeckId);
        const def = out.cardDefId && cardIds.get(out.cardDefId);
        if (owner && (def || existing.has(owner))) {
          out.sourceDeckId = owner;
          if (def) out.cardDefId = def;
        } else {
          delete out.sourceDeckId;
          delete out.cardDefId;
        }
        break;
      }
      case 'deck':
        out.initialCards = out.initialCards.map(card);
        out.cards = out.cards.map(card);
        break;
      case 'token': {
        const source = out.sourceId && ids.get(out.sourceId);
        if (source) out.sourceId = source;
        else delete out.sourceId;
        break;
      }
      case 'bag':
        out.items = out.items.map((item) => copy(item, newId(), out.id) as BagItem);
        break;
      case 'button':
        out.steps = out.steps.map((s) => pasteStep(s, ref, refs, cardIds));
        break;
    }
    return out as T;
  };

  const top = Math.max(0, ...table.objects.map((o) => o.zIndex));
  const bottom = Math.min(0, ...table.objects.map((o) => o.zIndex));
  const boards = data.objects.filter((o) => o.kind === 'board').length;
  let z = top;
  let zBoard = bottom - boards;
  return data.objects.map((o) => {
    const out = copy(o, ids.get(o.id)!, o.bagId && ids.get(o.bagId));
    out.position = { x: round(o.position.x + offset.x), y: round(o.position.y + offset.y) };
    out.zIndex = o.kind === 'board' ? zBoard++ : ++z;
    return out;
  });
}

function pasteStep(
  step: ButtonStep,
  ref: (id: string | undefined) => string | undefined,
  refs: (list: ObjectId[]) => ObjectId[],
  cardIds: Map<string, string>,
): ButtonStep {
  const s = { ...structuredClone(step), id: newId(), objectIds: refs(step.objectIds) };
  if (s.type === 'move' || s.type === 'pick') s.targetIds = refs(s.targetIds);
  if (s.type === 'pick' && s.cards) {
    const cards: Record<ObjectId, string[]> = {};
    for (const [holder, list] of Object.entries(s.cards)) {
      const id = ref(holder);
      if (id) cards[id] = list.map((c) => cardIds.get(c) ?? c);
    }
    s.cards = cards;
  }
  return s;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Offset that centres the clipboard objects on `center`. */
export function pasteOffset(data: ClipboardData, center: Vec2): Vec2 {
  const c = clipboardCenter(data);
  return { x: Math.round(center.x - c.x), y: Math.round(center.y - c.y) };
}
