import { applyPermutation } from './random';
import { followResizedSheets, withoutMarksOn } from './annotations';
import {
  bagAccepts,
  cardDefFromObject,
  cardObjectFromDef,
  cardSizeOf,
  dieFaceCount,
  cardPutInto,
  drawnFaceUp,
  homeDeckMap,
  maxZ,
  ownerDeckOf,
  resolveCardLook,
  sameTokenLook,
  tokenCount,
  withTokenCount,
} from './objects';
import {
  MAX_TOKEN_STACK,
  type BagItem,
  type BagObject,
  type BoardObject,
  type ButtonObject,
  type CardDef,
  type CardObject,
  type CheckboxObject,
  type CounterObject,
  type DeckObject,
  type DieObject,
  type ImageObject,
  type InkStroke,
  type LabelObject,
  type SortBy,
  type TableState,
  type TabletopObject,
  type TextAnnotation,
  type TimerObject,
  type TokenObject,
  type Vec2,
} from './types';
import { timerElapsed } from './timer';

type PatchOf<T> = Partial<Omit<T, 'id' | 'kind'>>;
/** A patch of any object's editable fields. Callers must only pass fields valid for the target kind. */
export type ObjectPatch = PatchOf<BoardObject> &
  PatchOf<ImageObject> &
  PatchOf<CardObject> &
  PatchOf<DeckObject> &
  PatchOf<TokenObject> &
  PatchOf<CounterObject> &
  PatchOf<DieObject> &
  PatchOf<LabelObject> &
  PatchOf<ButtonObject> &
  PatchOf<BagObject> &
  PatchOf<CheckboxObject> &
  PatchOf<TimerObject>;

export type ZOrderDirection = 'forward' | 'backward' | 'front' | 'back';

export type Command =
  | { type: 'AddObject'; object: TabletopObject }
  | { type: 'UpdateObject'; id: string; patch: ObjectPatch }
  | { type: 'MoveObject'; id: string; position: Vec2; toFront?: boolean; rotation?: number }
  | { type: 'TransformObject'; id: string; position: Vec2; width: number; height: number; rotation: number }
  | { type: 'DeleteObject'; id: string }
  | { type: 'SetZIndex'; id: string; direction: ZOrderDirection }
  /** Brings objects above all others, keeping their order among themselves (e.g. a selection dropped together). */
  | { type: 'RaiseObjects'; ids: string[] }
  | { type: 'ToggleLock'; id: string }
  | { type: 'FlipCard'; id: string }
  | { type: 'ShuffleDeck'; id: string; order: number[] }
  /** Orders a deck/pile by the original deck order or by card name, or reverses its current order. */
  | { type: 'SortDeck'; id: string; by: SortBy }
  /** Takes a card out of a holder/pile: the top one, the bottom one, or the one at `index` (spread holders). */
  | { type: 'DrawCard'; deckId: string; cardId: string; position: Vec2; faceUp: boolean; fromBottom?: boolean; index?: number }
  /**
   * Takes `count` cards from the top or bottom of a holder/pile as one new pile at `position`, keeping their
   * order; each card comes out with the side the holder's "cards come out" setting gives it. With `cardIds`,
   * takes exactly those cards (picked from the list; `count` is ignored).
   */
  | { type: 'DrawCards'; deckId: string; pileId: string; position: Vec2; count: number; fromBottom?: boolean; cardIds?: string[] }
  /** Lifts every card out of a holder as a new pile at `position`; the holder stays where it is. */
  | { type: 'TakeStack'; deckId: string; pileId: string; position: Vec2 }
  /** Flips the whole deck over: reverses the order and turns every card over. */
  | { type: 'FlipDeck'; id: string }
  /** Turns one card inside a holder/pile over, leaving it where it is. */
  | { type: 'FlipDeckCard'; deckId: string; cardId: string }
  /**
   * Puts a table card into a deck/pile, on top or at `index` (0 = top; spread holders). `asDefinition` also adds
   * it to the deck's Reset definition.
   */
  | { type: 'AddCardToDeck'; cardId: string; deckId: string; asDefinition?: boolean; index?: number }
  /** Drops a card onto another card, creating a pile in the target's place. */
  | { type: 'MergeCards'; cardId: string; targetCardId: string; pileId: string }
  /** Puts every card of a pile into a deck/pile (keeping their order), on top or at `index`; the pile disappears. */
  | { type: 'MergePileIntoDeck'; pileId: string; deckId: string; asDefinition?: boolean; index?: number }
  /**
   * Gathers loose cards and piles into one new pile `pileId` in the place of the first one; the others go on top in
   * the given order (the last one ends up on top). Needs at least two of them.
   */
  | { type: 'FormPile'; ids: string[]; pileId: string }
  /** Takes `count` tokens off a token stack as a new stack `newId` at `position`; the stack keeps at least one. */
  | { type: 'SplitTokens'; id: string; newId: string; count: number; position: Vec2 }
  /** Puts a token (stack) onto an identical one: their counts add up and the dropped one disappears. */
  | { type: 'MergeTokens'; id: string; targetId: string }
  | { type: 'ResetDeck'; deckId: string; keepCardTurn?: boolean }
  /** Sends every card of a pile back to the holder that owns it (cards without one stay); the pile disappears when empty. */
  | { type: 'ReturnPile'; id: string }
  /** Puts a token back onto the stack it was taken off (when that still exists and looks the same). */
  | { type: 'RecallToken'; id: string }
  /** Puts a table object into a bag, on top or at `index`; identical tokens join the same bag entry. */
  | { type: 'BagPut'; bagId: string; objectId: string; index?: number }
  /**
   * Takes the bag entry `itemId` out onto the table at `position`. From a token stack with several tokens one
   * token comes out as the new token `newId`.
   */
  | { type: 'BagDraw'; bagId: string; itemId: string; newId: string; position: Vec2 }
  | { type: 'ShuffleBag'; id: string; order: number[] }
  /** Puts every object that came from (or was put into) the bag back into it. */
  | { type: 'RecallToBag'; bagId: string }
  | { type: 'IncrementCounter'; id: string; delta: number }
  | { type: 'RollDie'; id: string; value: number }
  /** Starts a paused timer at time `at` (epoch ms); a countdown that already ran out starts over. */
  | { type: 'StartTimer'; id: string; at: number }
  /** Pauses a running timer at time `at`, keeping the time counted so far. */
  | { type: 'PauseTimer'; id: string; at: number }
  /** Stops a timer and sets it back to the start. */
  | { type: 'ResetTimer'; id: string }
  | { type: 'AddStroke'; stroke: InkStroke }
  | { type: 'EraseAnnotations'; strokeIds: string[]; textIds: string[] }
  | { type: 'AddTextAnnotation'; annotation: TextAnnotation }
  | { type: 'EditTextAnnotation'; id: string; patch: Partial<Omit<TextAnnotation, 'id'>> }
  | { type: 'ClearAnnotations' }
  | { type: 'ReplaceTable'; table: TableState }
  | { type: 'Batch'; commands: Command[] };

function mapObject(state: TableState, id: string, fn: (o: TabletopObject) => TabletopObject): TableState {
  let changed = false;
  const objects = state.objects.map((o) => {
    if (o.id !== id) return o;
    const next = fn(o);
    if (next !== o) changed = true;
    return next;
  });
  return changed ? { ...state, objects } : state;
}

function findObject(state: TableState, id: string): TabletopObject | undefined {
  return state.objects.find((o) => o.id === id);
}

function clampCounter(c: CounterObject, value: number): number {
  let v = value;
  if (c.min !== null) v = Math.max(c.min, v);
  if (c.max !== null) v = Math.min(c.max, v);
  return Math.round(v * 1e6) / 1e6;
}

function setZIndex(state: TableState, id: string, direction: ZOrderDirection): TableState {
  const sorted = [...state.objects].sort((a, b) => a.zIndex - b.zIndex);
  const idx = sorted.findIndex((o) => o.id === id);
  if (idx < 0) return state;
  const [item] = sorted.splice(idx, 1);
  let target: number;
  switch (direction) {
    case 'front':
      target = sorted.length;
      break;
    case 'back':
      target = 0;
      break;
    case 'forward':
      target = Math.min(sorted.length, idx + 1);
      break;
    case 'backward':
      target = Math.max(0, idx - 1);
      break;
  }
  if (target === idx) return state;
  sorted.splice(target, 0, item);
  const zById = new Map(sorted.map((o, i) => [o.id, i + 1]));
  return {
    ...state,
    objects: state.objects.map((o) => (o.zIndex === zById.get(o.id) ? o : { ...o, zIndex: zById.get(o.id)! })),
  };
}

const stripFace = ({ faceUp: _faceUp, ...rest }: CardDef): CardDef => rest;

/** `incoming` inserted into `cards` at `index` (clamped; missing = on top). */
function insertCards(cards: CardDef[], incoming: CardDef[], index: number | undefined): CardDef[] {
  const at = index === undefined ? 0 : Math.max(0, Math.min(cards.length, Math.round(index)));
  return [...cards.slice(0, at), ...incoming, ...cards.slice(at)];
}

/** A table card as it goes into a pile (it keeps its side). */
function tableCardDef(state: TableState, card: CardObject): CardDef {
  return cardDefFromObject(card, true, ownerDeckOf(state.objects, card.cardDefId));
}

/** A new pile holding `cards`, lying where the table card `card` lies and with its back. */
function pileInPlaceOf(card: CardObject, pileId: string, cards: CardDef[]): DeckObject {
  return {
    id: pileId,
    kind: 'deck',
    name: 'Pile',
    position: { ...card.position },
    width: card.width,
    height: card.height,
    rotation: card.rotation,
    zIndex: card.zIndex,
    locked: false,
    visible: true,
    cards,
    initialCards: [],
    backAssetId: card.backAssetId,
    backColor: card.backColor,
    drawSide: 'keep',
    isPile: true,
  };
}

function addCardToDeck(state: TableState, cardId: string, deckId: string, asDefinition: boolean, index?: number): TableState {
  const card = findObject(state, cardId);
  const deck = findObject(state, deckId);
  if (!card || card.kind !== 'card' || !deck || deck.kind !== 'deck') return state;
  const define = asDefinition && !deck.isPile && !deck.initialCards.some((c) => c.id === card.cardDefId);
  // The deck that owns the definition afterwards; the card keeps its own size unless it matches the owner's.
  const owner = define ? deck : ownerDeckOf(state.objects, card.cardDefId);
  // Holders and piles keep every card's side (what you put in is what you see); definitions never store one.
  const def = cardDefFromObject(card, true, owner);
  const alreadyInDeck = deck.cards.some((c) => c.id === def.id);
  const objects = state.objects
    .filter((o) => o.id !== card.id)
    .map((o): TabletopObject => {
      if (o.id === deck.id) {
        return {
          ...deck,
          cards: alreadyInDeck ? deck.cards : insertCards(deck.cards, [cardPutInto(deck, def)], index),
          initialCards: define ? [stripFace(def), ...deck.initialCards] : deck.initialCards,
        };
      }
      // A card definition belongs to exactly one deck.
      if (define && o.kind === 'deck' && o.initialCards.some((c) => c.id === def.id)) {
        return { ...o, initialCards: o.initialCards.filter((c) => c.id !== def.id) };
      }
      return o;
    });
  return { ...state, objects };
}

function mergePileIntoDeck(state: TableState, pileId: string, deckId: string, asDefinition: boolean, index?: number): TableState {
  const pile = findObject(state, pileId);
  const deck = findObject(state, deckId);
  if (!pile || pile.kind !== 'deck' || !pile.isPile || !deck || deck.kind !== 'deck' || pile.id === deck.id) return state;
  const define = asDefinition && !deck.isPile;
  const inDeck = new Set(deck.cards.map((c) => c.id));
  const incoming = pile.cards
    .filter((c) => !inDeck.has(c.id))
    .map((c) => {
      let def = c;
      const owner = ownerDeckOf(state.objects, c.id);
      if (define && owner?.id !== deck.id) {
        // The deck becomes the owner: freeze the card's current size and back so they don't change.
        const look = resolveCardLook(c, pile, owner);
        const { width: _w, height: _h, ...rest } = c;
        const size = cardSizeOf(deck);
        const sameSize = look.width === size.width && look.height === size.height;
        def = {
          ...rest,
          backAssetId: look.backAssetId,
          backColor: look.backColor,
          ...(sameSize ? {} : { width: look.width, height: look.height }),
        };
      }
      return def;
    });
  const defined = define ? incoming.filter((c) => !deck.initialCards.some((i) => i.id === c.id)) : [];
  const definedIds = new Set(defined.map((c) => c.id));
  const objects = state.objects
    .filter((o) => o.id !== pile.id)
    .map((o): TabletopObject => {
      if (o.id === deck.id) {
        return {
          ...deck,
          cards: insertCards(
            deck.cards,
            incoming.map((c) => cardPutInto(deck, c)),
            index,
          ),
          initialCards: [...defined.map(stripFace), ...deck.initialCards],
        };
      }
      // A card definition belongs to exactly one deck.
      if (definedIds.size && o.kind === 'deck' && o.initialCards.some((c) => definedIds.has(c.id))) {
        return { ...o, initialCards: o.initialCards.filter((c) => !definedIds.has(c.id)) };
      }
      return o;
    });
  return { ...state, objects };
}

/** Cards ordered by `by`; cards without a known original position keep their relative order at the end. */
function sortDeck(state: TableState, id: string, by: SortBy): TableState {
  const deck = findObject(state, id);
  if (!deck || deck.kind !== 'deck' || deck.cards.length < 2) return state;
  let order: CardDef[];
  if (by === 'reverse') {
    order = [...deck.cards].reverse();
  } else if (by === 'name') {
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    order = [...deck.cards].sort((a, b) => collator.compare(a.name, b.name));
  } else {
    // The deck's own definition comes first, then every other deck's, in table order.
    const rank = new Map<string, number>();
    for (const d of [deck, ...state.objects.filter((o): o is DeckObject => o.kind === 'deck' && o.id !== deck.id)]) {
      for (const c of d.initialCards) if (!rank.has(c.id)) rank.set(c.id, rank.size);
    }
    const rankOf = (c: CardDef) => rank.get(c.id) ?? Infinity;
    order = [...deck.cards].sort((a, b) => (rankOf(a) === rankOf(b) ? 0 : rankOf(a) < rankOf(b) ? -1 : 1));
  }
  if (order.every((c, i) => c === deck.cards[i])) return state;
  return mapObject(state, id, () => ({ ...deck, cards: order }));
}

/** Bag entries without the cards in `own` (cards of a holder that is being reset); the same array when nothing changed. */
function withoutCards(items: BagItem[], own: Set<string>): BagItem[] {
  let changed = false;
  const next = items.flatMap((i): BagItem[] => {
    if (i.kind === 'card' && i.cardDefId && own.has(i.cardDefId)) {
      changed = true;
      return [];
    }
    if (i.kind === 'deck' && i.cards.some((c) => own.has(c.id))) {
      changed = true;
      const cards = i.cards.filter((c) => !own.has(c.id));
      return cards.length ? [{ ...i, cards }] : [];
    }
    return [i];
  });
  return changed ? next : items;
}

/** Gathers a deck back to its definition; the cards also turn back to the set-up rotation unless `keepCardTurn`. */
function resetDeck(state: TableState, deckId: string, keepCardTurn = false): TableState {
  const deck = findObject(state, deckId);
  if (!deck || deck.kind !== 'deck' || deck.isPile) return state;
  const own = new Set(deck.initialCards.map((c) => c.id));
  const homes = homeDeckMap(state.objects);
  // Foreign cards currently in this deck go back to their own deck, or onto the table.
  const foreign = deck.cards.filter((c) => !own.has(c.id));
  const toOtherDecks = new Map<string, CardDef[]>();
  const spilled: CardDef[] = [];
  for (const c of foreign) {
    const home = homes.get(c.id);
    if (home && home !== deck.id && state.objects.some((o) => o.id === home)) {
      toOtherDecks.set(home, [...(toOtherDecks.get(home) ?? []), stripFace(c)]);
    } else {
      spilled.push(c);
    }
  }
  let z = maxZ(state.objects);
  const spilledCards: CardObject[] = spilled.map((c, i) =>
    cardObjectFromDef(c, deck, {
      position: { x: deck.position.x + deck.width + 24 + i * 12, y: deck.position.y + i * 12 },
      faceUp: drawnFaceUp(deck, c),
      zIndex: ++z,
    }),
  );
  const objects: TabletopObject[] = [];
  for (const o of state.objects) {
    if (o.kind === 'card' && o.cardDefId && own.has(o.cardDefId)) continue;
    if (o.id === deck.id) {
      const { cardTurn: _turn, ...rest } = deck;
      objects.push({ ...(keepCardTurn ? deck : rest), cards: deck.initialCards.map((c) => cardPutInto(deck, stripFace(c))) });
      continue;
    }
    if (o.kind === 'bag') {
      const items = withoutCards(o.items, own);
      objects.push(items === o.items ? o : { ...o, items });
      continue;
    }
    if (o.kind === 'deck') {
      const extra = (toOtherDecks.get(o.id) ?? []).map((c) => cardPutInto(o, c));
      const remaining = o.cards.filter((c) => !own.has(c.id));
      if (o.isPile && remaining.length === 0 && extra.length === 0) continue;
      if (remaining.length !== o.cards.length || extra.length) {
        objects.push({ ...o, cards: [...extra, ...remaining] });
        continue;
      }
    }
    objects.push(o);
  }
  return { ...state, objects: [...objects, ...spilledCards] };
}

function returnPile(state: TableState, id: string): TableState {
  const pile = findObject(state, id);
  if (!pile || pile.kind !== 'deck' || !pile.isPile) return state;
  const homes = homeDeckMap(state.objects);
  const toHolder = new Map<string, CardDef[]>();
  const staying: CardDef[] = [];
  for (const c of pile.cards) {
    const home = homes.get(c.id);
    const holder = home ? findObject(state, home) : undefined;
    if (holder?.kind === 'deck' && !holder.isPile && holder.id !== pile.id) {
      toHolder.set(holder.id, [...(toHolder.get(holder.id) ?? []), c]);
    } else {
      staying.push(c);
    }
  }
  if (toHolder.size === 0) return state;
  const objects = state.objects.flatMap((o): TabletopObject[] => {
    if (o.id === pile.id) return staying.length ? [{ ...pile, cards: staying }] : [];
    const back = o.kind === 'deck' ? toHolder.get(o.id) : undefined;
    if (o.kind !== 'deck' || !back) return [o];
    const inHolder = new Set(o.cards.map((c) => c.id));
    return [
      {
        ...o,
        cards: insertCards(
          o.cards,
          back.filter((c) => !inHolder.has(c.id)).map((c) => cardPutInto(o, c)),
          undefined,
        ),
      },
    ];
  });
  return { ...state, objects };
}

/** Puts `objectId` into the bag; identical tokens join an existing token entry instead of adding a new one. */
function bagPut(state: TableState, bagId: string, objectId: string, index?: number): TableState {
  const bag = findObject(state, bagId);
  const obj = findObject(state, objectId);
  if (!bag || bag.kind !== 'bag' || !obj || obj.id === bag.id || !bagAccepts(obj)) return state;
  const item: BagItem = { ...obj, bagId: bag.id };
  const same = item.kind === 'token' ? bag.items.findIndex((i) => i.kind === 'token' && sameTokenLook(i, item)) : -1;
  let items: BagItem[];
  const found = same >= 0 ? bag.items[same] : undefined;
  if (item.kind === 'token' && found?.kind === 'token' && tokenCount(found) + tokenCount(item) <= MAX_TOKEN_STACK) {
    items = bag.items.map((i) => (i === found ? withTokenCount(found, tokenCount(found) + tokenCount(item)) : i));
  } else {
    items = insertBagItems(bag.items, item, index);
  }
  return { ...state, objects: state.objects.filter((o) => o.id !== obj.id).map((o) => (o.id === bag.id ? { ...bag, items } : o)) };
}

function insertBagItems(items: BagItem[], item: BagItem, index: number | undefined): BagItem[] {
  const at = index === undefined ? 0 : Math.max(0, Math.min(items.length, Math.round(index)));
  return [...items.slice(0, at), item, ...items.slice(at)];
}

function bagDraw(state: TableState, cmd: Extract<Command, { type: 'BagDraw' }>): TableState {
  const bag = findObject(state, cmd.bagId);
  if (!bag || bag.kind !== 'bag') return state;
  const item = bag.items.find((i) => i.id === cmd.itemId);
  if (!item || findObject(state, cmd.newId)) return state;
  const placed = { position: { ...cmd.position }, zIndex: maxZ(state.objects) + 1, locked: false, visible: true, bagId: bag.id };
  let items: BagItem[];
  let out: BagItem;
  if (item.kind === 'token' && tokenCount(item) > 1) {
    const { sourceId: _source, ...single } = withTokenCount(item, 1);
    out = { ...single, ...placed, id: cmd.newId };
    items = bag.items.map((i) => (i === item ? withTokenCount(item, tokenCount(item) - 1) : i));
  } else {
    if (findObject(state, item.id)) return state;
    out = { ...item, ...placed };
    items = bag.items.filter((i) => i !== item);
  }
  return { ...state, objects: [...state.objects.map((o) => (o.id === bag.id ? { ...bag, items } : o)), out] };
}

/**
 * Pure reducer for all table mutations. Returns the SAME state reference when the command is a no-op,
 * which lets the history skip empty entries.
 */
export function applyCommand(state: TableState, cmd: Command): TableState {
  const next = applyOne(state, cmd);
  // A batch applies its commands one by one (each already handled here); a replaced table is taken as it is.
  if (next === state || cmd.type === 'Batch' || cmd.type === 'ReplaceTable') return next;
  return followResizedSheets(state, next);
}

function applyOne(state: TableState, cmd: Command): TableState {
  switch (cmd.type) {
    case 'AddObject':
      if (findObject(state, cmd.object.id)) return state;
      return { ...state, objects: [...state.objects, cmd.object] };

    case 'UpdateObject':
      return mapObject(state, cmd.id, (o) => {
        const keys = Object.keys(cmd.patch) as (keyof ObjectPatch)[];
        if (keys.every((k) => (o as unknown as Record<string, unknown>)[k] === cmd.patch[k])) return o;
        return { ...o, ...cmd.patch } as TabletopObject;
      });

    case 'MoveObject': {
      const z = cmd.toFront ? maxZ(state.objects) : 0;
      // An object sharing the top level with another one isn't on top yet: it is lifted above it.
      const tied = !!cmd.toFront && state.objects.filter((o) => o.zIndex === z).length > 1;
      return mapObject(state, cmd.id, (o) => {
        const samePos = o.position.x === cmd.position.x && o.position.y === cmd.position.y;
        const isTop = !cmd.toFront || (o.zIndex === z && !tied);
        const rotation = cmd.rotation === undefined ? o.rotation : ((cmd.rotation % 360) + 360) % 360;
        if (samePos && isTop && rotation === o.rotation) return o;
        return { ...o, position: { ...cmd.position }, zIndex: isTop ? o.zIndex : z + 1, rotation };
      });
    }

    case 'TransformObject':
      if (!(cmd.width > 0 && cmd.height > 0)) return state;
      return mapObject(state, cmd.id, (o) => ({
        ...o,
        position: { ...cmd.position },
        width: cmd.width,
        height: cmd.height,
        rotation: ((cmd.rotation % 360) + 360) % 360,
      }));

    case 'DeleteObject':
      if (!findObject(state, cmd.id)) return state;
      // Marks made on a deleted sheet go with it.
      return {
        ...state,
        objects: state.objects.filter((o) => o.id !== cmd.id),
        annotations: withoutMarksOn(state.annotations, new Set([cmd.id])),
      };

    case 'SetZIndex':
      return setZIndex(state, cmd.id, cmd.direction);

    case 'RaiseObjects': {
      // The objects go above all others, keeping their order among themselves.
      const ids = new Set(cmd.ids);
      const members = state.objects.filter((o) => ids.has(o.id)).sort((a, b) => a.zIndex - b.zIndex);
      if (members.length === 0) return state;
      const top = maxZ(state.objects.filter((o) => !ids.has(o.id)));
      if (members.every((m, i) => m.zIndex > top && (i === 0 || m.zIndex > members[i - 1].zIndex))) return state;
      let z = top;
      const zById = new Map(members.map((m) => [m.id, ++z]));
      return { ...state, objects: state.objects.map((o) => (zById.has(o.id) ? { ...o, zIndex: zById.get(o.id)! } : o)) };
    }

    case 'ToggleLock':
      return mapObject(state, cmd.id, (o) => ({ ...o, locked: !o.locked }));

    case 'FlipCard':
      return mapObject(state, cmd.id, (o) => (o.kind === 'card' ? { ...o, faceUp: !o.faceUp } : o));

    case 'ShuffleDeck':
      return mapObject(state, cmd.id, (o) => {
        if (o.kind !== 'deck' || o.cards.length < 2 || cmd.order.length !== o.cards.length) return o;
        return { ...o, cards: applyPermutation(o.cards, cmd.order) };
      });

    case 'SortDeck':
      return sortDeck(state, cmd.id, cmd.by);

    case 'DrawCard': {
      const deck = findObject(state, cmd.deckId);
      if (!deck || deck.kind !== 'deck' || deck.cards.length === 0 || findObject(state, cmd.cardId)) return state;
      const index =
        cmd.index !== undefined && cmd.index >= 0 && cmd.index < deck.cards.length ? cmd.index : cmd.fromBottom ? deck.cards.length - 1 : 0;
      const picked = deck.cards[index];
      const rest = deck.cards.filter((_, i) => i !== index);
      const card = cardObjectFromDef(picked, deck, {
        id: cmd.cardId,
        position: cmd.position,
        faceUp: cmd.faceUp,
        zIndex: maxZ(state.objects) + 1,
        owner: ownerDeckOf(state.objects, picked.id),
      });
      const removePile = deck.isPile && rest.length === 0;
      const objects = state.objects.flatMap((o) => (o.id !== deck.id ? [o] : removePile ? [] : [{ ...deck, cards: rest }]));
      return { ...state, objects: [...objects, card] };
    }

    case 'DrawCards': {
      const deck = findObject(state, cmd.deckId);
      if (!deck || deck.kind !== 'deck' || deck.cards.length === 0 || findObject(state, cmd.pileId)) return state;
      const n = Math.min(deck.cards.length, Math.max(1, Math.floor(cmd.count)));
      const chosen = cmd.cardIds ? new Set(cmd.cardIds) : null;
      const taken = chosen
        ? deck.cards.filter((c) => chosen.has(c.id))
        : cmd.fromBottom
          ? deck.cards.slice(deck.cards.length - n)
          : deck.cards.slice(0, n);
      if (taken.length === 0) return state;
      const rest = chosen
        ? deck.cards.filter((c) => !chosen.has(c.id))
        : cmd.fromBottom
          ? deck.cards.slice(0, deck.cards.length - n)
          : deck.cards.slice(n);
      const cards = taken.map((c): CardDef => {
        const owner = ownerDeckOf(state.objects, c.id);
        const faceUp = drawnFaceUp(deck, c);
        if (owner) return { ...c, faceUp };
        // Without an owning deck a card's look comes from where it lies, so freeze it before it leaves.
        const look = resolveCardLook(c, deck, undefined);
        return { ...c, faceUp, width: look.width, height: look.height, backColor: look.backColor, backAssetId: look.backAssetId };
      });
      const look = resolveCardLook(cards[0], deck, ownerDeckOf(state.objects, cards[0].id));
      const pile: DeckObject = {
        id: cmd.pileId,
        kind: 'deck',
        name: 'Pile',
        position: { ...cmd.position },
        width: look.width,
        height: look.height,
        rotation: 0,
        zIndex: maxZ(state.objects) + 1,
        locked: false,
        visible: true,
        cards,
        initialCards: [],
        backAssetId: deck.backAssetId,
        backColor: deck.backColor,
        drawSide: 'keep',
        isPile: true,
      };
      const removeSource = deck.isPile && rest.length === 0;
      const objects = state.objects.flatMap((o) => (o.id !== deck.id ? [o] : removeSource ? [] : [{ ...deck, cards: rest }]));
      return { ...state, objects: [...objects, pile] };
    }

    case 'TakeStack': {
      const holder = findObject(state, cmd.deckId);
      if (!holder || holder.kind !== 'deck' || holder.isPile || holder.cards.length === 0 || findObject(state, cmd.pileId)) return state;
      const top = holder.cards[0];
      const look = resolveCardLook(top, holder, ownerDeckOf(state.objects, top.id));
      const pile: DeckObject = {
        id: cmd.pileId,
        kind: 'deck',
        name: 'Pile',
        position: { ...cmd.position },
        width: look.width,
        height: look.height,
        rotation: 0,
        zIndex: maxZ(state.objects) + 1,
        locked: false,
        visible: true,
        cards: holder.cards,
        initialCards: [],
        backAssetId: holder.backAssetId,
        backColor: holder.backColor,
        drawSide: 'keep',
        isPile: true,
      };
      const objects = state.objects.map((o) => (o.id === holder.id ? { ...holder, cards: [] } : o));
      return { ...state, objects: [...objects, pile] };
    }

    case 'FlipDeck':
      return mapObject(state, cmd.id, (o) => {
        if (o.kind !== 'deck' || o.cards.length === 0) return o;
        // Cards without a stored side are shown face down, so turning them over shows their faces.
        const cards = [...o.cards].reverse().map((c): CardDef => ({ ...c, faceUp: !(c.faceUp ?? false) }));
        return { ...o, cards };
      });

    case 'FlipDeckCard':
      return mapObject(state, cmd.deckId, (o) => {
        if (o.kind !== 'deck' || !o.cards.some((c) => c.id === cmd.cardId)) return o;
        return { ...o, cards: o.cards.map((c) => (c.id === cmd.cardId ? { ...c, faceUp: !(c.faceUp ?? false) } : c)) };
      });

    case 'AddCardToDeck':
      return addCardToDeck(state, cmd.cardId, cmd.deckId, !!cmd.asDefinition, cmd.index);

    case 'MergeCards': {
      const card = findObject(state, cmd.cardId);
      const target = findObject(state, cmd.targetCardId);
      if (!card || card.kind !== 'card' || !target || target.kind !== 'card' || card.id === target.id) return state;
      if (findObject(state, cmd.pileId)) return state;
      const pile = pileInPlaceOf(target, cmd.pileId, [tableCardDef(state, card), tableCardDef(state, target)]);
      return {
        ...state,
        objects: [...state.objects.filter((o) => o.id !== card.id && o.id !== target.id), pile],
      };
    }

    case 'MergePileIntoDeck':
      return mergePileIntoDeck(state, cmd.pileId, cmd.deckId, !!cmd.asDefinition, cmd.index);

    case 'FormPile': {
      if (findObject(state, cmd.pileId)) return state;
      const members = [...new Set(cmd.ids)]
        .map((id) => findObject(state, id))
        .filter((o): o is CardObject | DeckObject => o?.kind === 'card' || (o?.kind === 'deck' && !!o.isPile));
      if (members.length < 2) return state;
      // Index 0 is the top card: the last member goes on top.
      const cards = [...members].reverse().flatMap((m) => (m.kind === 'card' ? [tableCardDef(state, m)] : m.cards));
      const first = members[0];
      const pile: DeckObject = {
        ...(first.kind === 'deck' ? { ...first, id: cmd.pileId, cards } : pileInPlaceOf(first, cmd.pileId, cards)),
        zIndex: Math.max(...members.map((m) => m.zIndex)),
      };
      const gone = new Set(members.map((m) => m.id));
      return { ...state, objects: [...state.objects.filter((o) => !gone.has(o.id)), pile] };
    }

    case 'SplitTokens': {
      const token = findObject(state, cmd.id);
      if (!token || token.kind !== 'token' || findObject(state, cmd.newId)) return state;
      const total = tokenCount(token);
      const n = Math.min(total - 1, Math.max(1, Math.floor(cmd.count)));
      if (total < 2) return state;
      // The new stack remembers the stack at the root of the family; a source that is gone starts a new one.
      const root = token.sourceId && findObject(state, token.sourceId)?.kind === 'token' ? token.sourceId : token.id;
      const { bagId: _bag, ...plain } = withTokenCount(token, n);
      const taken: TokenObject = {
        ...plain,
        id: cmd.newId,
        position: { ...cmd.position },
        zIndex: maxZ(state.objects) + 1,
        locked: false,
        sourceId: root,
      };
      return { ...state, objects: [...state.objects.map((o) => (o.id === token.id ? withTokenCount(token, total - n) : o)), taken] };
    }

    case 'MergeTokens': {
      const token = findObject(state, cmd.id);
      const target = findObject(state, cmd.targetId);
      if (!token || token.kind !== 'token' || !target || target.kind !== 'token' || token.id === target.id) return state;
      if (!sameTokenLook(token, target)) return state;
      const count = Math.min(MAX_TOKEN_STACK, tokenCount(token) + tokenCount(target));
      return {
        ...state,
        objects: state.objects.filter((o) => o.id !== token.id).map((o) => (o.id === target.id ? withTokenCount(target, count) : o)),
      };
    }

    case 'ResetDeck':
      return resetDeck(state, cmd.deckId, !!cmd.keepCardTurn);

    case 'ReturnPile':
      return returnPile(state, cmd.id);

    case 'RecallToken': {
      const token = findObject(state, cmd.id);
      if (token?.kind !== 'token' || !token.sourceId || token.sourceId === token.id) return state;
      return applyCommand(state, { type: 'MergeTokens', id: token.id, targetId: token.sourceId });
    }

    case 'BagPut':
      return bagPut(state, cmd.bagId, cmd.objectId, cmd.index);

    case 'BagDraw':
      return bagDraw(state, cmd);

    case 'ShuffleBag':
      return mapObject(state, cmd.id, (o) => {
        if (o.kind !== 'bag' || o.items.length < 2 || cmd.order.length !== o.items.length) return o;
        return { ...o, items: applyPermutation(o.items, cmd.order) };
      });

    case 'RecallToBag': {
      const bag = findObject(state, cmd.bagId);
      if (!bag || bag.kind !== 'bag') return state;
      const back = [...state.objects]
        .filter((o) => o.bagId === bag.id && o.id !== bag.id && bagAccepts(o))
        .sort((a, b) => a.zIndex - b.zIndex);
      return back.reduce((s, o) => bagPut(s, bag.id, o.id), state);
    }

    case 'IncrementCounter':
      return mapObject(state, cmd.id, (o) => {
        if (o.kind !== 'counter') return o;
        const value = clampCounter(o, o.value + cmd.delta);
        return value === o.value ? o : { ...o, value };
      });

    case 'RollDie':
      return mapObject(state, cmd.id, (o) => {
        if (o.kind !== 'die') return o;
        const value = Math.min(dieFaceCount(o), Math.max(1, Math.round(cmd.value)));
        return { ...o, value, rollCount: o.rollCount + 1 };
      });

    case 'StartTimer':
      return mapObject(state, cmd.id, (o) => {
        if (o.kind !== 'timer' || o.startedAt !== undefined) return o;
        const elapsedMs = o.mode === 'countdown' && o.elapsedMs >= o.duration * 1000 ? 0 : o.elapsedMs;
        return { ...o, elapsedMs, startedAt: cmd.at };
      });

    case 'PauseTimer':
      return mapObject(state, cmd.id, (o) => {
        if (o.kind !== 'timer' || o.startedAt === undefined) return o;
        const { startedAt: _run, ...rest } = o;
        return { ...rest, elapsedMs: timerElapsed(o, cmd.at) };
      });

    case 'ResetTimer':
      return mapObject(state, cmd.id, (o) => {
        if (o.kind !== 'timer' || (o.startedAt === undefined && o.elapsedMs === 0)) return o;
        const { startedAt: _run, ...rest } = o;
        return { ...rest, elapsedMs: 0 };
      });

    case 'AddStroke':
      if (cmd.stroke.points.length < 2) return state;
      return { ...state, annotations: { ...state.annotations, strokes: [...state.annotations.strokes, cmd.stroke] } };

    case 'EraseAnnotations': {
      const sIds = new Set(cmd.strokeIds);
      const tIds = new Set(cmd.textIds);
      const strokes = state.annotations.strokes.filter((s) => !sIds.has(s.id));
      const text = state.annotations.text.filter((t) => !tIds.has(t.id));
      if (strokes.length === state.annotations.strokes.length && text.length === state.annotations.text.length) return state;
      return { ...state, annotations: { strokes, text } };
    }

    case 'AddTextAnnotation':
      if (!cmd.annotation.text.trim()) return state;
      return { ...state, annotations: { ...state.annotations, text: [...state.annotations.text, cmd.annotation] } };

    case 'EditTextAnnotation': {
      const existing = state.annotations.text.find((t) => t.id === cmd.id);
      if (!existing) return state;
      const next = { ...existing, ...cmd.patch };
      // A patch with `objectId: undefined` moves the text off its sheet onto the table.
      if ('objectId' in cmd.patch && cmd.patch.objectId === undefined) delete next.objectId;
      if (cmd.patch.text !== undefined && !cmd.patch.text.trim()) {
        return { ...state, annotations: { ...state.annotations, text: state.annotations.text.filter((t) => t.id !== cmd.id) } };
      }
      const keys = Object.keys(cmd.patch) as (keyof typeof cmd.patch)[];
      if (keys.every((k) => JSON.stringify(existing[k]) === JSON.stringify(next[k]))) return state;
      return {
        ...state,
        annotations: { ...state.annotations, text: state.annotations.text.map((t) => (t.id === cmd.id ? next : t)) },
      };
    }

    case 'ClearAnnotations':
      if (state.annotations.strokes.length === 0 && state.annotations.text.length === 0) return state;
      return { ...state, annotations: { strokes: [], text: [] } };

    case 'ReplaceTable':
      return cmd.table;

    case 'Batch':
      return cmd.commands.reduce(applyCommand, state);
  }
}
