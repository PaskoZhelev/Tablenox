import { applyCommand, type Command } from './commands';
import { newId } from './ids';
import { objectCenter, pointInHolderShape } from './geometry';
import {
  bagAccepts,
  bagItemWeight,
  cardSizeOf,
  dieFaceCount,
  drawnFaceUp,
  homeDeckMap,
  isHolder,
  ownerDeckOf,
  raisedWhenMoved,
  stackingComparator,
  resolveCardLook,
  sameTokenLook,
  tokenCount,
} from './objects';
import { randomInt, shuffledIndices, secureRandomSource, type RandomSource } from './random';
import type { BagObject, CardObject, DeckObject, DieObject, HoverZoom, Mode, TableState, TabletopObject, TokenObject, Vec2 } from './types';

/** Surfaces and containers other pieces lie on or go into (not pieces that can cover a token stack). */
const isSurface = (o: TabletopObject) => o.kind === 'board' || o.kind === 'bag' || isHolder(o);

/** The top-most (as drawn among `all`) of `objects` containing `p`. */
function topmostContaining<T extends TabletopObject>(all: TabletopObject[], objects: T[], p: Vec2): T | undefined {
  const cmp = stackingComparator(all);
  return objects.filter((o) => o.visible && pointInObject(p, o)).sort((a, b) => cmp(b, a))[0];
}

/** The holder, pile, bag or card a dragged card would join if released with its centre at `center`. */
export function findDropTarget(state: TableState, cardId: string, center: Vec2): DeckObject | CardObject | BagObject | undefined {
  return topmostContaining(
    state.objects,
    state.objects.filter(
      (o): o is DeckObject | CardObject | BagObject => o.id !== cardId && (o.kind === 'deck' || o.kind === 'card' || o.kind === 'bag'),
    ),
    center,
  );
}

/**
 * The holder, pile, bag or loose card a dragged pile would join if released with its centre at `center` (on a card,
 * the card goes to the bottom of the pile).
 */
export function findPileTarget(state: TableState, pileId: string, center: Vec2): DeckObject | CardObject | BagObject | undefined {
  return topmostContaining(
    state.objects,
    state.objects.filter(
      (o): o is DeckObject | CardObject | BagObject => o.id !== pileId && (o.kind === 'deck' || o.kind === 'card' || o.kind === 'bag'),
    ),
    center,
  );
}

const isPile = (o: TabletopObject): o is DeckObject => o.kind === 'deck' && o.isPile;

/** An identical token (stack) that a dragged token would join if released with its centre at `center`. */
export function findTokenTarget(state: TableState, id: string, center: Vec2): TokenObject | undefined {
  const token = state.objects.find((o) => o.id === id);
  if (token?.kind !== 'token') return undefined;
  const top = topmostContaining(
    state.objects,
    state.objects.filter((o) => o.id !== id && !isSurface(o)),
    center,
  );
  return top?.kind === 'token' && sameTokenLook(top, token) ? top : undefined;
}

/**
 * The object highlighted while `id` is dragged with its centre at `center`: for cards the holder/pile/card it
 * would join, for piles the holder/pile it would merge into, for tokens an identical token they would stack on,
 * for other pieces the holder underneath. Boards and holders themselves never highlight anything.
 */
export function findHoverTarget(state: TableState, id: string, center: Vec2): TabletopObject | undefined {
  const obj = state.objects.find((o) => o.id === id);
  if (!obj || obj.kind === 'board' || obj.kind === 'bag' || isHolder(obj)) return undefined;
  if (obj.kind === 'card') return findDropTarget(state, id, center);
  if (isPile(obj)) return findPileTarget(state, id, center);
  if (obj.kind === 'token') {
    const stack = findTokenTarget(state, id, center);
    if (stack) return stack;
  }
  return topmostSurface(state.objects, obj, center);
}

/** The holder (or, for pieces a bag accepts, the bag) lying under `center`, other than `obj` itself. */
function topmostSurface(objects: TabletopObject[], obj: TabletopObject, center: Vec2): DeckObject | BagObject | undefined {
  return topmostContaining(
    objects,
    objects.filter((o): o is DeckObject | BagObject => o.id !== obj.id && (isHolder(o) || (o.kind === 'bag' && bagAccepts(obj)))),
    center,
  );
}

const HOLDER_PADDING = 10;

function rotateVec(v: Vec2, degrees: number): Vec2 {
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

/**
 * Where the visible cards of a holder/pile sit, in its own frame, in drawing order (bottom first). A stack
 * shows only its top card, centred. A spread lays every card out along the holder's long side: left to right
 * (top card right-most) in a wide holder, top to bottom (top card bottom-most) in a tall one.
 */
export function cardSlots(objects: TabletopObject[], deck: DeckObject): CardSlot[] {
  return spreadLayout(objects, deck).slots;
}

export function isSpread(deck: DeckObject): boolean {
  return !deck.isPile && deck.layout === 'spread';
}

/** Degrees (clockwise, 0–359) a holder turns the cards it shows (its set-up rotation plus any automation turn); piles never turn them. */
export function cardRotationOf(deck: DeckObject): number {
  return deck.isPile ? 0 : normalizeDegrees((deck.cardRotation ?? 0) + (deck.cardTurn ?? 0));
}

function normalizeDegrees(d: number): number {
  const n = ((Math.round(d) % 360) + 360) % 360;
  return Number.isFinite(n) ? n : 0;
}

/** Size of the box around a `size` card turned by `degrees`. */
export function rotatedBox(size: { width: number; height: number }, degrees: number): { width: number; height: number } {
  if (degrees % 180 === 0) return { width: size.width, height: size.height };
  if (degrees % 90 === 0) return { width: size.height, height: size.width };
  const r = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  return { width: size.width * cos + size.height * sin, height: size.width * sin + size.height * cos };
}

/** A spread runs down a holder that is taller than it is wide. */
export function spreadsVertically(deck: DeckObject): boolean {
  return deck.height > deck.width;
}

/**
 * Card positions of a holder/pile; for a spread with `gapAt` (an index into `cards`, as for `AddCardToDeck`)
 * the cards make room for one more card there, and `gap` is that empty place.
 */
export function spreadLayout(
  objects: TabletopObject[],
  deck: DeckObject,
  gapAt?: number | null,
): { slots: CardSlot[]; gap?: Omit<CardSlot, 'index'> } {
  const n = deck.cards.length;
  const withGap = isSpread(deck) && gapAt !== undefined && gapAt !== null;
  if (n === 0 && !withGap) return { slots: [] };
  const turn = cardRotationOf(deck);
  const slotSize = (s: { width: number; height: number }) => rotatedBox(s, turn);
  const look = (i: number) => slotSize(resolveCardLook(deck.cards[i], deck, ownerDeckOf(objects, deck.cards[i].id)));
  if (!isSpread(deck)) {
    const l = look(0);
    return { slots: [{ index: 0, x: (deck.width - l.width) / 2, y: (deck.height - l.height) / 2, width: l.width, height: l.height }] };
  }
  // Lay out along the main axis (x for a row, y for a column); the cross axis centres each card.
  const vertical = spreadsVertically(deck);
  const main = (s: { width: number; height: number }) => (vertical ? s.height : s.width);
  const cross = (s: { width: number; height: number }) => (vertical ? s.width : s.height);
  const length = main(deck);
  const looks = deck.cards.map((_, i) => look(i));
  const own = slotSize(cardSizeOf(deck));
  const cardMain = looks.length ? Math.max(...looks.map(main)) : main(own);
  const at = withGap ? Math.max(0, Math.min(n, gapAt)) : -1;
  const places = n + (withGap ? 1 : 0);
  const avail = length - HOLDER_PADDING * 2;
  const step = places > 1 ? Math.min(cardMain + 8, Math.max(8, (avail - cardMain) / (places - 1))) : 0;
  const total = cardMain + step * (places - 1);
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
  const placeOf = (i: number) => (withGap && i < at ? places - 1 - i : n - 1 - i);
  const slots = looks
    .map((l, i) => ({
      index: i,
      ...place(start + placeOf(i) * step + (cardMain - main(l)) / 2, { width: l.width, height: l.height }),
    }))
    .reverse();
  if (!withGap) return { slots };
  const gapSize = vertical ? { width: own.width, height: cardMain } : { width: cardMain, height: own.height };
  return { slots, gap: place(start + (n - at) * step, gapSize) };
}

/**
 * Where a card dropped with its centre at world point `p` goes in a spread holder: the index in `cards`
 * (0 = top: right-most, or bottom-most in a column). It lands after every card whose middle is before `p`.
 */
export function spreadInsertIndex(objects: TabletopObject[], deck: DeckObject, p: Vec2): number {
  const local = toLocal(p, deck);
  const vertical = spreadsVertically(deck);
  const before = cardSlots(objects, deck).filter((s) => (vertical ? s.y + s.height / 2 < local.y : s.x + s.width / 2 < local.x)).length;
  return deck.cards.length - before;
}

/** Insert position for an object dropped into `target` with its centre at `center` (spread holders only). */
function dropIndex(state: TableState, target: DeckObject, center: Vec2): { index?: number } {
  return isSpread(target) ? { index: spreadInsertIndex(state.objects, target, center) } : {};
}

/** Index of the card under world point `p` in a holder/pile (the visible top-most one), if any. */
export function cardIndexAt(objects: TabletopObject[], deck: DeckObject, p: Vec2): number | null {
  const local = toLocal(p, deck);
  const slots = cardSlots(objects, deck);
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i];
    if (local.x >= s.x && local.x <= s.x + s.width && local.y >= s.y && local.y <= s.y + s.height) return s.index;
  }
  return null;
}

export interface DropOptions {
  /** Place exactly where dropped: no joining holders/piles/cards and no holder rotation. */
  free?: boolean;
}

/**
 * Turns "object was dropped at `position`" into a domain command: cards join the holder, pile or card they
 * are dropped on; piles merge into the holder or pile they are dropped on; other pieces dropped on a holder
 * take its rotation (when it asks for that). Holders and boards just move.
 */
export function resolveDrop(state: TableState, id: string, position: Vec2, mode: Mode, opts: DropOptions = {}): Command {
  const obj = state.objects.find((o) => o.id === id);
  const move: Command = { type: 'MoveObject', id, position, toFront: !!obj && raisedWhenMoved(obj, mode) };
  if (!obj || opts.free || obj.kind === 'board' || obj.kind === 'bag' || isHolder(obj)) return move;

  const center = objectCenter({ ...obj, position });

  if (obj.kind === 'card') {
    const target = findDropTarget(state, id, center);
    if (target?.kind === 'bag') return { type: 'BagPut', bagId: target.id, objectId: id };
    if (target?.kind === 'deck') {
      return {
        type: 'AddCardToDeck',
        cardId: id,
        deckId: target.id,
        asDefinition: mode === 'edit' && !target.isPile,
        ...dropIndex(state, target, center),
      };
    }
    if (target?.kind === 'card') {
      return { type: 'MergeCards', cardId: id, targetCardId: target.id, pileId: newId() };
    }
    return move;
  }
  if (isPile(obj)) {
    const target = findPileTarget(state, id, center);
    if (target?.kind === 'bag') return { type: 'BagPut', bagId: target.id, objectId: id };
    // A pile dropped on a loose card takes it in at the bottom, lying where the card lay.
    if (target?.kind === 'card') return { type: 'FormPile', ids: [target.id, id], pileId: newId() };
    if (target)
      return {
        type: 'MergePileIntoDeck',
        pileId: id,
        deckId: target.id,
        asDefinition: mode === 'edit' && !target.isPile,
        ...dropIndex(state, target, center),
      };
    return move;
  }
  if (obj.kind === 'token') {
    const stack = findTokenTarget(state, id, center);
    if (stack) return { type: 'MergeTokens', id, targetId: stack.id };
  }

  const surface = topmostSurface(state.objects, obj, center);
  if (surface?.kind === 'bag') return { type: 'BagPut', bagId: surface.id, objectId: id };
  if (!surface) return move;
  const rotation = surface.alignRotation ? { rotation: surface.rotation } : {};
  if (surface.snapToCenter !== false) {
    // A slot: the piece is centred on the holder.
    const c = objectCenter(surface);
    return { ...move, position: { x: Math.round(c.x - obj.width / 2), y: Math.round(c.y - obj.height / 2) }, ...rotation };
  }
  return { ...move, ...rotation };
}

export function defaultDrawPosition(deck: DeckObject): Vec2 {
  return { x: deck.position.x + deck.width + 24, y: deck.position.y };
}

/** True when the top card of a holder/pile is shown face up. */
export function topFaceUp(deck: DeckObject): boolean {
  return deck.cards[0]?.faceUp === true;
}

/** Draws the top card, or the card at `index` (spread holders). */
export function drawCardCommand(deck: DeckObject, position: Vec2 = defaultDrawPosition(deck), index = 0): Command | null {
  const card = deck.cards[index];
  if (!card) return null;
  return {
    type: 'DrawCard',
    deckId: deck.id,
    cardId: newId(),
    position,
    faceUp: drawnFaceUp(deck, card),
    ...(index > 0 ? { index } : {}),
  };
}

/** Lifts the whole stack out of a holder with its centre at `center`: a single card is drawn, more become a pile. */
export function takeStackCommand(objects: TabletopObject[], holder: DeckObject, center: Vec2): Command | null {
  const top = holder.cards[0];
  if (!top) return null;
  const look = resolveCardLook(top, holder, ownerDeckOf(objects, top.id));
  const position = { x: Math.round(center.x - look.width / 2), y: Math.round(center.y - look.height / 2) };
  if (holder.cards.length === 1) return drawCardCommand(holder, position);
  return { type: 'TakeStack', deckId: holder.id, pileId: newId(), position };
}

/**
 * Draws up to `count` cards from the top or bottom next to the deck: one card on its own, several as one pile
 * (in the order they had in the deck).
 */
export function drawCardsCommand(deck: DeckObject, count: number, from: 'top' | 'bottom'): Command | null {
  const n = Math.min(Math.floor(count), deck.cards.length);
  if (!(n > 0)) return null;
  const fromBottom = from === 'bottom';
  const position = defaultDrawPosition(deck);
  if (n === 1) {
    const card = fromBottom ? deck.cards[deck.cards.length - 1] : deck.cards[0];
    return { type: 'DrawCard', deckId: deck.id, cardId: newId(), position, faceUp: drawnFaceUp(deck, card), fromBottom };
  }
  return { type: 'DrawCards', deckId: deck.id, pileId: newId(), position, count: n, fromBottom };
}

/** Turns over the top card of a holder/pile, or the card at `index` (spread holders), leaving it in place. */
export function flipDeckCardCommand(deck: DeckObject, index = 0): Command | null {
  const card = deck.cards[index];
  return card ? { type: 'FlipDeckCard', deckId: deck.id, cardId: card.id } : null;
}

/** Draws the card with id `cardId` (picked from the holder's list) next to the holder. */
export function drawPickedCardCommand(deck: DeckObject, cardId: string): Command | null {
  const index = deck.cards.findIndex((c) => c.id === cardId);
  return index < 0 ? null : drawCardCommand(deck, defaultDrawPosition(deck), index);
}

/** Draws the picked cards next to the holder: one on its own, several as one pile (in the order they had in the holder). */
export function drawPickedCardsCommand(deck: DeckObject, cardIds: readonly string[]): Command | null {
  const ids = deck.cards.filter((c) => cardIds.includes(c.id)).map((c) => c.id);
  if (ids.length <= 1) return ids.length ? drawPickedCardCommand(deck, ids[0]) : null;
  return { type: 'DrawCards', deckId: deck.id, pileId: newId(), position: defaultDrawPosition(deck), count: ids.length, cardIds: ids };
}

/**
 * Takes `count` tokens off a stack: centred at `center`, or next to the stack. Taking every token (or a single
 * token's only one) is not possible: the stack keeps at least one.
 */
export function splitTokensCommand(token: TokenObject, count: number, center?: Vec2): Command | null {
  const n = Math.min(tokenCount(token) - 1, Math.floor(count));
  if (!(n >= 1)) return null;
  const position = center
    ? { x: Math.round(center.x - token.width / 2), y: Math.round(center.y - token.height / 2) }
    : { x: token.position.x + token.width + 16, y: token.position.y };
  return { type: 'SplitTokens', id: token.id, newId: newId(), count: n, position };
}

export function shuffleDeckCommand(deck: DeckObject, source: RandomSource = secureRandomSource): Command {
  return { type: 'ShuffleDeck', id: deck.id, order: shuffledIndices(deck.cards.length, source) };
}

export function shuffleBagCommand(bag: BagObject, source: RandomSource = secureRandomSource): Command {
  return { type: 'ShuffleBag', id: bag.id, order: shuffledIndices(bag.items.length, source) };
}

export function defaultBagDrawPosition(bag: BagObject): Vec2 {
  return { x: bag.position.x + bag.width + 24, y: bag.position.y };
}

/** Takes bag entry number `index` (0 = top) out onto the table: at `center`, or next to the bag. */
export function bagDrawCommand(bag: BagObject, index: number, center?: Vec2): Command | null {
  const item = bag.items[index];
  if (!item) return null;
  const position = center
    ? { x: Math.round(center.x - item.width / 2), y: Math.round(center.y - item.height / 2) }
    : defaultBagDrawPosition(bag);
  return { type: 'BagDraw', bagId: bag.id, itemId: item.id, newId: newId(), position };
}

/** Index of a bag entry picked at random; a token stack counts once per token. */
export function randomBagIndex(bag: BagObject, source: RandomSource = secureRandomSource): number {
  const total = bag.items.reduce((n, i) => n + bagItemWeight(i), 0);
  if (total === 0) return -1;
  let r = randomInt(total, source);
  for (let i = 0; i < bag.items.length; i++) {
    r -= bagItemWeight(bag.items[i]);
    if (r < 0) return i;
  }
  return bag.items.length - 1;
}

/** Draws one piece at random from a bag (a token stack gives up a single token). */
export function drawRandomFromBagCommand(bag: BagObject, center?: Vec2, source: RandomSource = secureRandomSource): Command | null {
  const index = randomBagIndex(bag, source);
  return index < 0 ? null : bagDrawCommand(bag, index, center);
}

/** Draws `count` pieces at random from a bag next to it, fanned out a little; one undo step. */
export function drawManyFromBagCommand(
  state: TableState,
  bag: BagObject,
  count: number,
  source: RandomSource = secureRandomSource,
): Command | null {
  const commands: Command[] = [];
  let current = state;
  const base = defaultBagDrawPosition(bag);
  for (let k = 0; k < count; k++) {
    const now = current.objects.find((o) => o.id === bag.id);
    if (now?.kind !== 'bag') break;
    const index = randomBagIndex(now, source);
    const cmd = index < 0 ? null : bagDrawCommand(now, index);
    if (cmd?.type !== 'BagDraw') break;
    const placed: Command = { ...cmd, position: { x: base.x + k * 20, y: base.y + k * 20 } };
    commands.push(placed);
    current = applyCommand(current, placed);
  }
  if (commands.length === 0) return null;
  return commands.length === 1 ? commands[0] : { type: 'Batch', commands };
}

/** The bag `o` was last in, if it still exists and can take it back. */
export function bagOf(state: TableState, o: TabletopObject): BagObject | undefined {
  const bag = o.bagId ? state.objects.find((x) => x.id === o.bagId) : undefined;
  return bag?.kind === 'bag' && bagAccepts(o) ? bag : undefined;
}

/** The stack a token was taken off, if it still exists and the token looks the same. */
export function tokenSourceOf(state: TableState, token: TokenObject): TokenObject | undefined {
  const src = token.sourceId && token.sourceId !== token.id ? state.objects.find((x) => x.id === token.sourceId) : undefined;
  return src?.kind === 'token' && sameTokenLook(src, token) ? src : undefined;
}

/** Tokens that were taken off the stack `root` and still look the same as it. */
export function tokensTakenFrom(state: TableState, root: TokenObject): TokenObject[] {
  return state.objects.filter(
    (o): o is TokenObject => o.kind === 'token' && o.sourceId === root.id && o.id !== root.id && sameTokenLook(o, root),
  );
}

/** True when a pile holds at least one card that has a holder to go back to. */
export function pileHasHome(state: TableState, pile: DeckObject): boolean {
  const homes = homeDeckMap(state.objects);
  return pile.cards.some((c) => {
    const holder = state.objects.find((o) => o.id === homes.get(c.id));
    return isHolder(holder) && holder.id !== pile.id;
  });
}

/** The holders (without duplicates, top card's first) that own the cards of a pile. */
export function pileHolders(state: TableState, pile: DeckObject): DeckObject[] {
  const homes = homeDeckMap(state.objects);
  const out: DeckObject[] = [];
  for (const c of pile.cards) {
    const holder = state.objects.find((o) => o.id === homes.get(c.id));
    if (isHolder(holder) && !out.includes(holder)) out.push(holder);
  }
  return out;
}

/** Loose cards and piles among `ids` (what *Form a pile* gathers). */
export function pileableObjects(state: TableState, ids: readonly string[]): (CardObject | DeckObject)[] {
  return state.objects.filter(
    (o): o is CardObject | DeckObject => ids.includes(o.id) && (o.kind === 'card' || (o.kind === 'deck' && !!o.isPile)),
  );
}

/**
 * Gathers the loose cards and piles among `ids` into one pile where `anchorId` lies (missing / not a card or pile:
 * the lowest one); the others go on top of it in their stacking order. Null with fewer than two of them.
 */
export function formPileCommand(state: TableState, ids: readonly string[], anchorId?: string | null): Command | null {
  const members = pileableObjects(state, ids).sort((a, b) => a.zIndex - b.zIndex);
  if (members.length < 2) return null;
  const anchor = members.find((o) => o.id === anchorId) ?? members[0];
  return { type: 'FormPile', ids: [anchor.id, ...members.filter((o) => o !== anchor).map((o) => o.id)], pileId: newId() };
}

export function rollDieCommand(die: DieObject, source: RandomSource = secureRandomSource): Command {
  return { type: 'RollDie', id: die.id, value: randomInt(dieFaceCount(die), source) + 1 };
}

/** The deck a table card belongs to (definition owner, falling back to where it was drawn from). */
export function homeDeckOf(state: TableState, card: CardObject): DeckObject | undefined {
  const homeId = (card.cardDefId && homeDeckMap(state.objects).get(card.cardDefId)) || card.sourceDeckId;
  const deck = state.objects.find((o) => o.id === homeId);
  return deck?.kind === 'deck' ? deck : undefined;
}

/** Longest side of the hover preview, in screen pixels. */
export const HOVER_ZOOM_PX: Record<Exclude<HoverZoom, 'off'>, number> = { small: 240, medium: 360, large: 520, xlarge: 720 };

export const HOVER_ZOOM_LABELS: Record<HoverZoom, string> = {
  off: 'Off',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  xlarge: 'Extra large',
};

/** Cards, holders and piles without their own hover-zoom setting use the one of the deck their card belongs to. */
export function inheritsHoverZoom(o: TabletopObject): boolean {
  return o.kind === 'card' || o.kind === 'deck';
}

/** Name of the "no own setting" choice in the hover-zoom pickers. */
export function hoverZoomInheritLabel(o: TabletopObject): string {
  return o.kind === 'card' ? 'Same as deck' : o.kind === 'deck' ? "Same as the cards' deck" : 'Off';
}

export type HoverRotateChoice = '' | 'upright' | 'turn';

/** Choices of the "Zoomed view" picker; `''` is "no own setting" (inherit, or upright for objects that don't inherit). */
export function hoverRotateChoices(o: TabletopObject): { value: HoverRotateChoice; label: string }[] {
  const turn = { value: 'turn' as const, label: 'Turned like on the table' };
  return inheritsHoverZoom(o)
    ? [{ value: '', label: hoverZoomInheritLabel(o) }, { value: 'upright', label: 'Always upright' }, turn]
    : [{ value: '', label: 'Always upright' }, turn];
}

export function hoverRotateChoiceOf(o: TabletopObject): HoverRotateChoice {
  if (o.hoverRotate === undefined) return '';
  return o.hoverRotate ? 'turn' : inheritsHoverZoom(o) ? 'upright' : '';
}

export function hoverRotateFromChoice(choice: HoverRotateChoice): boolean | undefined {
  return choice === '' ? undefined : choice === 'turn';
}

/**
 * Hover-zoom size of an object. Cards without their own setting use their deck's; holders and piles use the deck
 * that owns the card shown (`cardId` in a spread, otherwise the top card).
 */
export function effectiveHoverZoom(state: TableState, o: TabletopObject, cardId?: string | null): HoverZoom {
  if (o.hoverZoom) return o.hoverZoom;
  const deck = hoverSettingsDeck(state, o, cardId);
  return deck?.hoverZoom ?? 'off';
}

/** The deck whose hover settings an object without its own uses: a card's deck, or the deck owning a holder's / pile's shown card. */
function hoverSettingsDeck(state: TableState, o: TabletopObject, cardId?: string | null): DeckObject | undefined {
  if (o.kind === 'card') return homeDeckOf(state, o);
  if (o.kind === 'deck') {
    const card = cardId ? o.cards.find((c) => c.id === cardId) : o.cards[0];
    const owner = card && ownerDeckOf(state.objects, card.id);
    return owner && owner.id !== o.id ? owner : undefined;
  }
  return undefined;
}

/** Whether the hover preview is turned like the object on the table; inherited like `effectiveHoverZoom`. */
export function effectiveHoverRotate(state: TableState, o: TabletopObject, cardId?: string | null): boolean {
  return o.hoverRotate ?? hoverSettingsDeck(state, o, cardId)?.hoverRotate ?? false;
}

/**
 * Touch: what a long-press at world point `p` on `o` shows enlarged instead of opening the menu: a loose card, or the
 * card held in a holder / pile (a pile's top card, the card under the finger in a holder), when its hover zoom is on.
 * Null = no preview (the menu opens).
 */
export function pressPreviewOf(state: TableState, o: TabletopObject, p: Vec2): { id: string; cardId: string | null } | null {
  if (o.kind === 'card') return effectiveHoverZoom(state, o) === 'off' ? null : { id: o.id, cardId: null };
  if (o.kind !== 'deck') return null;
  const index = o.isPile ? 0 : cardIndexAt(state.objects, o, p);
  const card = index === null ? undefined : o.cards[index];
  if (!card || effectiveHoverZoom(state, o, card.id) === 'off') return null;
  return { id: o.id, cardId: card.id };
}

/** Degrees the hover preview of `o` is turned when it follows the object: a holder adds the turn of its cards. */
export function hoverRotationOf(o: TabletopObject): number {
  return normalizeDegrees(o.rotation + (o.kind === 'deck' ? cardRotationOf(o) : 0));
}

/** Angles the rotation picker offers. */
export const ROTATION_CHOICES = [0, 45, 90, 135, 180, 225, 270, 315];
/** Angles an object steps through when it has no setting of its own (and no deck to follow). */
export const DEFAULT_ROTATIONS = [0, 90, 180, 270];

/** Cards and piles without their own rotation angles use their deck's (like the hover settings). */
export function inheritsRotations(o: TabletopObject): boolean {
  return o.kind === 'card' || (o.kind === 'deck' && o.isPile);
}

/** The angles `o` may be rotated to with the Rotate action / `R`, sorted. */
export function effectiveRotations(state: TableState, o: TabletopObject): number[] {
  const own = o.rotations ?? (inheritsRotations(o) ? hoverSettingsDeck(state, o)?.rotations : undefined) ?? DEFAULT_ROTATIONS;
  const list = [...new Set(own.map(normalizeDegrees))].sort((a, b) => a - b);
  return list.length ? list : DEFAULT_ROTATIONS;
}

/** Whether the Rotate action / `R` can turn `o` (it allows more than one angle). */
export function canRotate(state: TableState, o: TabletopObject): boolean {
  return effectiveRotations(state, o).length > 1;
}

/**
 * The next allowed angle after `o`'s rotation, clockwise (`dir` 1) or anticlockwise (-1); null when it can't turn.
 * An object between two allowed angles goes to the nearest one in that direction.
 */
export function nextRotation(state: TableState, o: TabletopObject, dir: 1 | -1 = 1): number | null {
  const angles = effectiveRotations(state, o);
  const now = ((o.rotation % 360) + 360) % 360;
  const eps = 0.01;
  const next =
    dir === 1
      ? (angles.find((a) => a > now + eps) ?? angles[0])
      : ([...angles].reverse().find((a) => a < now - eps) ?? angles[angles.length - 1]);
  return Math.abs(next - now) < eps ? null : next;
}
