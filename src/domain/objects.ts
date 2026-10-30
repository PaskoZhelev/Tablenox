import { newId } from './ids';
import { objectCenter } from './geometry';
import type {
  BagItem,
  BagObject,
  BoardObject,
  CardDef,
  CardObject,
  DeckObject,
  DieFace,
  DieObject,
  HolderShape,
  Mode,
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
  timer: 'Timer',
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

/** Whether a player can move `o` in Play mode (and so box-select it there): not locked, fixed, or a click-only control. */
export function movableInPlay(o: TabletopObject): boolean {
  return o.visible && !o.locked && !fixedInPlay(o) && o.kind !== 'button' && o.kind !== 'checkbox';
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
export const DEFAULT_HOLDER_FILL_OPACITY = 0;
export const DEFAULT_HOLDER_STROKE_OPACITY = 0.3;

export const HOLDER_SHAPE_LABELS: Record<HolderShape, string> = {
  rectangle: 'Rectangle',
  circle: 'Circle / oval',
  hexagon: 'Hexagon (point at the top)',
  hexagonFlat: 'Hexagon (flat top)',
  octagon: 'Octagon',
  triangle: 'Triangle',
  diamond: 'Diamond',
};

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
export const HOLDER_MARGIN = 6;

/** Size of the cards a holder owns (piles: the pile's own size). */
export function cardSizeOf(d: DeckObject): { width: number; height: number } {
  return { width: d.cardWidth ?? d.width, height: d.cardHeight ?? d.height };
}

/** The side `card` comes out with when taken from `deck`: the holder's setting, or as it lies there. */
export function drawnFaceUp(deck: Pick<DeckObject, 'drawSide'>, card: Pick<CardDef, 'faceUp'>): boolean {
  return deck.drawSide === 'keep' ? card.faceUp === true : deck.drawSide === 'faceUp';
}

/** `card` as it lies once put into `deck`: turned by the holder's "Cards come in" setting, or as it was (same object when unchanged). */
export function cardPutInto(deck: Pick<DeckObject, 'putSide'>, card: CardDef): CardDef {
  const side = deck.putSide ?? 'keep';
  if (side === 'keep' || (card.faceUp === true) === (side === 'faceUp')) return card;
  return { ...card, faceUp: side === 'faceUp' };
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

/** Card definitions that are copies of each other: same name, face, back and size. */
export function sameCardLook(a: CardDef, b: CardDef): boolean {
  return (
    a.name === b.name &&
    a.faceText === b.faceText &&
    a.faceColor === b.faceColor &&
    a.faceAssetId === b.faceAssetId &&
    a.backAssetId === b.backAssetId &&
    a.backColor === b.backColor &&
    a.width === b.width &&
    a.height === b.height
  );
}

/** A card list as rows of copies: each row is a run of identical neighbouring definitions. */
export function cardGroups(defs: readonly CardDef[]): CardDef[][] {
  const groups: CardDef[][] = [];
  for (const d of defs) {
    const last = groups[groups.length - 1];
    if (last && sameCardLook(last[0], d)) last.push(d);
    else groups.push([d]);
  }
  return groups;
}

/** Most copies one row of a card list can have. */
export const MAX_CARD_COPIES = 500;

type CardLists = Pick<DeckObject, 'cards' | 'initialCards'>;

/**
 * Sets how many copies the card-list row holding card `id` has. New copies are separate cards (new ids) placed
 * right after the row (and, in the holder, after its last copy there, or at the bottom); extra copies are removed
 * from the end of the row. Returns null when nothing changes.
 */
export function setCardCopies(deck: DeckObject, id: string, copies: number): CardLists | null {
  const group = cardGroups(deck.initialCards).find((g) => g.some((c) => c.id === id));
  const n = Math.max(1, Math.min(MAX_CARD_COPIES, Math.round(copies)));
  if (!group || !Number.isFinite(n) || n === group.length) return null;
  const ids = new Set(group.map((c) => c.id));
  if (n < group.length) {
    const drop = new Set(group.slice(n).map((c) => c.id));
    return { initialCards: deck.initialCards.filter((c) => !drop.has(c.id)), cards: deck.cards.filter((c) => !drop.has(c.id)) };
  }
  const { faceUp: _side, ...template } = group[0];
  const extra: CardDef[] = Array.from({ length: n - group.length }, () => ({ ...template, id: newId() }));
  const insertAfter = <T extends CardDef>(list: T[], add: T[]): T[] => {
    let at = -1;
    list.forEach((c, i) => {
      if (ids.has(c.id)) at = i;
    });
    return at < 0 ? [...list, ...add] : [...list.slice(0, at + 1), ...add, ...list.slice(at + 1)];
  };
  return { initialCards: insertAfter(deck.initialCards, extra), cards: insertAfter(deck.cards, extra) };
}

/** Gives every row of the card list `copies` copies (see `setCardCopies`). Returns null when nothing changes. */
export function setAllCardCopies(deck: DeckObject, copies: number): CardLists | null {
  let lists: CardLists = { cards: deck.cards, initialCards: deck.initialCards };
  for (const row of cardGroups(deck.initialCards)) {
    // A row keeps its first card, so its id still finds the row after earlier rows changed.
    const next = setCardCopies({ ...deck, ...lists }, row[0].id, copies);
    if (next) lists = next;
  }
  return lists.initialCards === deck.initialCards && lists.cards === deck.cards ? null : lists;
}

/**
 * Moves the card-list row holding card `id` one row up (`-1`, towards the top) or down (`1`). While the holder still has
 * every card in list order (not shuffled, none out), its cards follow the new order. Returns null when it can't move.
 */
export function moveCardGroup(deck: DeckObject, id: string, delta: -1 | 1): CardLists | null {
  const groups = cardGroups(deck.initialCards);
  const from = groups.findIndex((g) => g.some((c) => c.id === id));
  const to = from + delta;
  if (from < 0 || to < 0 || to >= groups.length) return null;
  [groups[from], groups[to]] = [groups[to], groups[from]];
  const initialCards = groups.flat();
  const inListOrder = deck.cards.length === deck.initialCards.length && deck.cards.every((c, i) => c.id === deck.initialCards[i].id);
  if (!inListOrder) return { initialCards, cards: deck.cards };
  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  return { initialCards, cards: initialCards.map((c) => byId.get(c.id) ?? c) };
}

/** `card` with its front also used as its back: the face image and colour (backs never show text). */
export function withFrontAsBack(card: CardDef): CardDef {
  const { backAssetId: _old, ...rest } = card;
  return { ...rest, backColor: card.faceColor, ...(card.faceAssetId ? { backAssetId: card.faceAssetId } : {}) };
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
    case 'timer':
      obj = {
        ...base('timer', opts, 180, 84),
        label: '',
        mode: 'countdown',
        duration: 300,
        color: '#1f2328',
        textColor: '#ffffff',
        elapsedMs: 0,
        sound: true,
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

const ownerDeckCache = new WeakMap<readonly TabletopObject[], Map<string, DeckObject>>();

/**
 * Card-definition id -> the deck that owns it, cached per (immutable) objects array: cheap enough to call from store
 * selectors that run on every state change.
 */
export function ownerDecksById(objects: readonly TabletopObject[]): Map<string, DeckObject> {
  let map = ownerDeckCache.get(objects);
  if (!map) {
    map = new Map();
    for (const o of objects) if (o.kind === 'deck') for (const c of o.initialCards) map.set(c.id, o);
    ownerDeckCache.set(objects, map);
  }
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

/** Boards and images are what holders are laid out on. */
const isHolderBase = (o: TabletopObject) => o.kind === 'board' || o.kind === 'image';

/** True when `p` lies inside the (possibly rotated) box of `o`. */
function inBox(p: Vec2, o: TabletopObject): boolean {
  const c = objectCenter(o);
  const r = (-o.rotation * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= o.width / 2 && Math.abs(ly) <= o.height / 2;
}

const rankCache = new WeakMap<TabletopObject[], { ranks: Map<string, number>; draw: DrawEntry[] }>();

/** One Konva node of the objects layer: an object, or the zone (outline, fill, label) of holder `id`. */
export interface DrawEntry {
  id: string;
  zone: boolean;
}

/** A holder's card order: its `cardsZ` (missing = 0), then its `zIndex`. */
export function cardsZOf(o: TabletopObject): number {
  return o.kind === 'deck' ? (o.cardsZ ?? 0) : 0;
}

const byCardsZ = (a: TabletopObject, b: TabletopObject) => cardsZOf(a) - cardsZOf(b) || a.zIndex - b.zIndex;

export function maxCardsZ(objects: TabletopObject[]): number {
  return objects.reduce((m, o) => (isHolder(o) ? Math.max(m, cardsZOf(o)) : m), 0);
}

function stackingLayout(objects: TabletopObject[]): { ranks: Map<string, number>; draw: DrawEntry[] } {
  const cached = rankCache.get(objects);
  if (cached) return cached;
  const byZ = sortByZ(objects);
  const rest = byZ.filter((o) => !isHolder(o));
  const bases = rest.filter(isHolderBase);
  const holdersOn = new Map<string | null, TabletopObject[]>();
  for (const h of byZ) {
    if (!isHolder(h)) continue;
    const c = objectCenter(h);
    let base: TabletopObject | undefined;
    for (const b of bases) if (b.zIndex <= h.zIndex && inBox(c, b)) base = b;
    const key = base?.id ?? null;
    holdersOn.set(key, [...(holdersOn.get(key) ?? []), h]);
  }
  const order = [...(holdersOn.get(null) ?? [])];
  for (const o of rest) order.push(o, ...(holdersOn.get(o.id) ?? []));
  const ranks = new Map(order.map((o, i) => [o.id, i]));
  // Drawn: the zones of the holders on a board (by zIndex), then all their cards (by card order) above every zone.
  const group = (holders: TabletopObject[] = []): DrawEntry[] => [
    ...holders.map((h) => ({ id: h.id, zone: true })),
    ...[...holders].sort(byCardsZ).map((h) => ({ id: h.id, zone: false })),
  ];
  const draw = group(holdersOn.get(null));
  for (const o of rest) draw.push({ id: o.id, zone: false }, ...group(holdersOn.get(o.id)));
  const layout = { ranks, draw };
  rankCache.set(objects, layout);
  return layout;
}

/**
 * Where each object is drawn, from the bottom (0) up. Everything follows `zIndex`, except holders: a holder lies
 * right above the board (or image) under its centre that is below it, and under every other piece, so cards,
 * tokens and the like are never covered by a holder, while a holder laid out on a board stays on it. A holder on
 * the bare table lies below everything. Among the holders of one board this is the order of their zones (see
 * `drawOrder` for their cards).
 */
export function stackingRanks(objects: TabletopObject[]): Map<string, number> {
  return stackingLayout(objects).ranks;
}

/**
 * The objects layer from the bottom up, as `stackingRanks`, except that the holders of one board draw their zones
 * first (by `zIndex`) and then their cards above all of those zones (by `cardsZOf`), so a card the player put in a
 * holder isn't hidden under the zone or the cards of a holder lying over it.
 */
export function drawOrder(objects: TabletopObject[]): DrawEntry[] {
  return stackingLayout(objects).draw;
}

/** Compares objects of `all` by where they are drawn: negative when `a` lies below `b`. */
export function stackingComparator(all: TabletopObject[]): (a: TabletopObject, b: TabletopObject) => number {
  const ranks = stackingRanks(all);
  return (a, b) => (ranks.get(a.id) ?? a.zIndex) - (ranks.get(b.id) ?? b.zIndex);
}

/** `objects` (some or all of `all`) from the bottom to the top of the table, as drawn. */
export function sortByStacking(objects: TabletopObject[], all: TabletopObject[] = objects): TabletopObject[] {
  return [...objects].sort(stackingComparator(all));
}

/**
 * Whether picking up and moving `o` brings it to the front, on top of whatever it is put on. Holders do too (so a
 * holder moved onto a board lies on it; they are still drawn under the pieces, see `stackingRanks`). Boards keep
 * their level in Edit mode and in automations (moving a map doesn't hide the pieces on it), but a board a player
 * lifts in Play mode comes to the front like any piece.
 */
export function raisedWhenMoved(o: TabletopObject, mode?: Mode): boolean {
  return o.kind !== 'board' || mode === 'play';
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
