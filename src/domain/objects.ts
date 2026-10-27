import { newId } from './ids';
import type {
  BagItem,
  BagObject,
  BoardObject,
  CardDef,
  CardObject,
  DeckObject,
  DieFace,
  DieObject,
  ObjectKind,
  ObjectOfKind,
  TabletopObject,
  TokenObject,
  Vec2,
} from './types';

export const CARD_SIZE = { width: 126, height: 176 };

export const OBJECT_LABELS: Record<ObjectKind, string> = {
  board: 'Board / Sheet',
  image: 'Image',
  card: 'Card',
  deck: 'Holder',
  token: 'Token',
  counter: 'Counter',
  die: 'Die',
  label: 'Text label',
  button: 'Button',
  bag: 'Bag',
  checkbox: 'Checkbox',
};

/** Kind label for display: piles are holders' loose cousins. */
export function kindLabel(o: TabletopObject): string {
  return o.kind === 'deck' && o.isPile ? 'Pile' : OBJECT_LABELS[o.kind];
}

/** A holder (a zone with cards), as opposed to a loose pile. */
export function isHolder(o: TabletopObject | undefined): o is DeckObject {
  return o?.kind === 'deck' && !o.isPile;
}

/** Boards, holders and bags stay put in Play mode unless they are set to be movable there (Edit mode always moves them). */
export function fixedInPlay(o: TabletopObject): boolean {
  return hasPlayMovable(o) && !o.playMovable;
}

/** Objects with a "Movable in Play mode" setting: surfaces and containers that other pieces are put on or into. */
export function hasPlayMovable(o: TabletopObject): o is BoardObject | DeckObject | BagObject {
  return o.kind === 'board' || o.kind === 'bag' || isHolder(o);
}

/** What a bag can hold: loose pieces and piles. */
export function bagAccepts(o: TabletopObject): o is BagItem {
  switch (o.kind) {
    case 'card':
    case 'token':
    case 'die':
    case 'counter':
    case 'label':
    case 'image':
      return true;
    case 'deck':
      return o.isPile;
    default:
      return false;
  }
}

/** How many pieces a bag item stands for when drawing at random (a token stack counts every token). */
export function bagItemWeight(item: BagItem): number {
  return item.kind === 'token' ? tokenCount(item) : 1;
}

/** Number of pieces in a bag (every token of a stack counts). */
export function bagCount(bag: BagObject): number {
  return bag.items.reduce((n, i) => n + bagItemWeight(i), 0);
}

export const DEFAULT_BAG_COLOR = '#8b6b43';

export const DEFAULT_HOLDER_COLOR = '#8a8f98';
export const DEFAULT_HOLDER_FILL_OPACITY = 0.18;

/** Number of tokens in a token stack. */
export function tokenCount(t: TokenObject): number {
  return t.count ?? 1;
}

/** `t` holding `count` tokens (a single token stores no count). */
export function withTokenCount(t: TokenObject, count: number): TokenObject {
  const { count: _old, ...rest } = t;
  return count > 1 ? { ...rest, count } : rest;
}

/** Tokens that look the same (shape, colour, image and size) can be stacked together. */
export function sameTokenLook(a: TokenObject, b: TokenObject): boolean {
  return a.shape === b.shape && a.color === b.color && a.assetId === b.assetId && a.width === b.width && a.height === b.height;
}
/** Space between a new holder's edge and its cards, so the zone shows around them. */
export const HOLDER_MARGIN = 14;

/** Size of the cards a holder owns (piles: the pile's own size). */
export function cardSizeOf(d: DeckObject): { width: number; height: number } {
  return { width: d.cardWidth ?? d.width, height: d.cardHeight ?? d.height };
}

/** The side `card` comes out with when taken from `deck`: the holder's setting, or as it lies there. */
export function drawnFaceUp(deck: Pick<DeckObject, 'drawSide'>, card: Pick<CardDef, 'faceUp'>): boolean {
  return deck.drawSide === 'keep' ? card.faceUp === true : deck.drawSide === 'faceUp';
}

export const PALETTE_COLORS = ['#e05252', '#e0913a', '#e8c547', '#4caf6a', '#3f8fd8', '#7b5bd6', '#d65bb3', '#2b2b2b', '#f5f5f5'];

interface FactoryOptions {
  /** World-space centre for the new object. */
  center: Vec2;
  zIndex: number;
}

function base<K extends ObjectKind>(kind: K, opts: FactoryOptions, width: number, height: number) {
  return {
    id: newId(),
    kind,
    name: OBJECT_LABELS[kind],
    position: { x: Math.round(opts.center.x - width / 2), y: Math.round(opts.center.y - height / 2) },
    width,
    height,
    rotation: 0,
    zIndex: opts.zIndex,
    locked: false,
    visible: true,
  };
}

export function createCardDef(partial: Partial<CardDef> = {}): CardDef {
  return { id: newId(), name: 'Card', faceText: '', faceColor: '#ffffff', ...partial };
}

export function createObject<K extends ObjectKind>(kind: K, opts: FactoryOptions): ObjectOfKind<K> {
  let obj: TabletopObject;
  switch (kind) {
    case 'board':
      obj = { ...base('board', opts, 800, 600), fill: '#f4efe1' };
      break;
    case 'image':
      obj = { ...base('image', opts, 300, 200) };
      break;
    case 'card':
      obj = {
        ...base('card', opts, CARD_SIZE.width, CARD_SIZE.height),
        faceUp: true,
        faceText: 'A',
        faceColor: '#ffffff',
        backColor: '#2f5d8a',
      };
      break;
    case 'deck':
      obj = {
        ...base('deck', opts, CARD_SIZE.width + HOLDER_MARGIN * 2, CARD_SIZE.height + HOLDER_MARGIN * 2),
        cards: [],
        initialCards: [],
        backColor: '#2f5d8a',
        drawSide: 'keep',
        isPile: false,
        layout: 'stack',
        color: DEFAULT_HOLDER_COLOR,
        label: '',
        cardWidth: CARD_SIZE.width,
        cardHeight: CARD_SIZE.height,
      };
      break;
    case 'token':
      obj = { ...base('token', opts, 48, 48), shape: 'circle', color: '#e05252' };
      break;
    case 'counter':
      obj = { ...base('counter', opts, 150, 84), label: 'Score', value: 0, min: null, max: null, step: 1, color: '#ffffff' };
      break;
    case 'die':
      obj = { ...base('die', opts, 64, 64), sides: 6, value: 1, color: '#ffffff', pipColor: '#222222', rollCount: 0 };
      break;
    case 'label':
      obj = {
        ...base('label', opts, 220, 40),
        text: 'Label',
        fontSize: 28,
        color: '#1f2328',
        background: null,
        align: 'left',
      };
      break;
    case 'button':
      obj = { ...base('button', opts, 150, 52), label: 'Button', color: '#3f8fd8', textColor: '#ffffff', steps: [] };
      break;
    case 'bag':
      // Bags have no default name, so none is printed on them.
      obj = { ...base('bag', opts, 120, 130), name: '', items: [], color: DEFAULT_BAG_COLOR };
      break;
    case 'checkbox':
      obj = {
        ...base('checkbox', opts, 40, 40),
        checked: false,
        mark: 'check',
        boxShape: 'square',
        color: '#1f2328',
        boxColor: '#1f2328',
        boxFill: '#ffffff',
      };
      break;
    default: {
      const never: never = kind as never;
      throw new Error(`Unknown kind ${String(never)}`);
    }
  }
  return obj as ObjectOfKind<K>;
}

/** The deck whose definition (initialCards) owns card definition `defId`. */
export function ownerDeckOf(objects: TabletopObject[], defId: string | undefined): DeckObject | undefined {
  if (!defId) return undefined;
  for (const o of objects) if (o.kind === 'deck' && o.initialCards.some((c) => c.id === defId)) return o;
  return undefined;
}

export interface CardLook {
  width: number;
  height: number;
  backAssetId?: string;
  backColor: string;
}

/**
 * Size and back of a card inside `deck`. They come from the card itself or from the deck that owns its
 * definition — never from a foreign deck it was merely put into.
 */
export function resolveCardLook(def: CardDef, deck: DeckObject, owner: DeckObject | undefined): CardLook {
  const size = cardSizeOf(owner ?? deck);
  return {
    width: def.width ?? size.width,
    height: def.height ?? size.height,
    backAssetId: def.backAssetId ?? owner?.backAssetId,
    backColor: def.backColor ?? owner?.backColor ?? deck.backColor,
  };
}

export function cardObjectFromDef(
  def: CardDef,
  deck: DeckObject,
  opts: { id?: string; position: Vec2; faceUp: boolean; zIndex: number; owner?: DeckObject },
): CardObject {
  const look = resolveCardLook(def, deck, opts.owner);
  return {
    id: opts.id ?? newId(),
    kind: 'card',
    name: def.name,
    position: opts.position,
    width: look.width,
    height: look.height,
    rotation: 0,
    zIndex: opts.zIndex,
    locked: false,
    visible: true,
    faceUp: opts.faceUp,
    faceAssetId: def.faceAssetId,
    backAssetId: look.backAssetId,
    faceText: def.faceText,
    faceColor: def.faceColor,
    backColor: look.backColor,
    sourceDeckId: deck.id,
    cardDefId: def.id,
  };
}

/**
 * Converts a table card into a deck entry. `keepFace` stores its orientation (used by piles).
 * The card's size is stored unless it matches `owner`, the deck that will own the definition.
 */
export function cardDefFromObject(card: CardObject, keepFace = false, owner?: DeckObject): CardDef {
  const ownerSize = owner && cardSizeOf(owner);
  const sameSize = !!ownerSize && ownerSize.width === card.width && ownerSize.height === card.height;
  return {
    id: card.cardDefId ?? newId(),
    name: card.name,
    faceAssetId: card.faceAssetId,
    faceText: card.faceText,
    faceColor: card.faceColor,
    backAssetId: card.backAssetId,
    backColor: card.backColor,
    ...(sameSize ? {} : { width: card.width, height: card.height }),
    ...(keepFace ? { faceUp: card.faceUp } : {}),
  };
}

/** Map of card-definition id -> id of the deck whose definition (initialCards) owns it. */
export function homeDeckMap(objects: TabletopObject[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const o of objects) if (o.kind === 'deck') for (const c of o.initialCards) map.set(c.id, o.id);
  return map;
}

export function maxZ(objects: TabletopObject[]): number {
  return objects.reduce((m, o) => Math.max(m, o.zIndex), 0);
}

/** Number of faces of a die: its custom faces, or the standard side count. */
export function dieFaceCount(d: DieObject): number {
  return d.faces && d.faces.length > 0 ? d.faces.length : d.sides;
}

/** Display label for face `value` (1-based). */
export function dieFaceLabel(d: DieObject, value: number): string {
  if (d.faces && d.faces.length > 0) return d.faces[value - 1]?.label || `Face ${value}`;
  return String(value);
}

/** Pip positions of a standard d6 face (fractions of the face size), keyed by value. */
export const DIE_PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.27, 0.27],
    [0.5, 0.5],
    [0.73, 0.73],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.27, 0.25],
    [0.73, 0.25],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.75],
    [0.73, 0.75],
  ],
};

/** Name to show for an object: its name, or its kind ("Bag", "Holder"…) when it has none. */
export function displayName(o: TabletopObject): string {
  return o.name.trim() || kindLabel(o);
}

export function createDieFace(partial: Partial<DieFace> = {}): DieFace {
  return { id: newId(), label: '', ...partial };
}

export function sortByZ(objects: TabletopObject[]): TabletopObject[] {
  return [...objects].sort((a, b) => a.zIndex - b.zIndex);
}

/** All asset IDs referenced by a list of objects. */
export function collectAssetIds(objects: TabletopObject[]): Set<string> {
  const ids = new Set<string>();
  const add = (id?: string) => {
    if (id) ids.add(id);
  };
  for (const o of objects) {
    switch (o.kind) {
      case 'board':
      case 'image':
      case 'token':
        add(o.assetId);
        break;
      case 'card':
        add(o.faceAssetId);
        add(o.backAssetId);
        break;
      case 'deck':
        add(o.backAssetId);
        o.cards.forEach((c) => {
          add(c.faceAssetId);
          add(c.backAssetId);
        });
        o.initialCards.forEach((c) => {
          add(c.faceAssetId);
          add(c.backAssetId);
        });
        break;
      case 'die':
        o.faces?.forEach((f) => add(f.assetId));
        break;
      case 'bag':
        collectAssetIds(o.items).forEach((a) => ids.add(a));
        break;
      default:
        break;
    }
  }
  return ids;
}

/** Returns a copy of objects with asset IDs rewritten through `map` (unknown IDs are dropped). */
export function remapAssetIds(objects: TabletopObject[], map: Map<string, string>): TabletopObject[] {
  const r = (id?: string) => (id ? map.get(id) : undefined);
  const def = (c: CardDef): CardDef => ({ ...c, faceAssetId: r(c.faceAssetId), backAssetId: r(c.backAssetId) });
  return objects.map((o): TabletopObject => {
    switch (o.kind) {
      case 'board':
      case 'image':
      case 'token':
        return { ...o, assetId: r(o.assetId) };
      case 'card':
        return { ...o, faceAssetId: r(o.faceAssetId), backAssetId: r(o.backAssetId) };
      case 'deck':
        return { ...o, backAssetId: r(o.backAssetId), cards: o.cards.map(def), initialCards: o.initialCards.map(def) };
      case 'die':
        return o.faces ? { ...o, faces: o.faces.map((f) => ({ ...f, assetId: r(f.assetId) })) } : o;
      case 'bag':
        return { ...o, items: remapAssetIds(o.items, map) as BagItem[] };
      default:
        return o;
    }
  });
}
