import { applyCommand, type Command } from './commands';
import { newId } from './ids';
import { objectCenter } from './geometry';
import { holderPieces, isSpread, joinsHolder, pointInObject, spreadLayout, spreadsVertically, toLocal, type CardSlot } from './holders';
import {
  alignsRotation,
  bagAccepts,
  bagItemWeight,
  cardTurnOf,
  dieFaceCount,
  drawnFaceUp,
  homeDeckMap,
  isHolder,
  ownerDeckOf,
  raisedWhenMoved,
  sortByStacking,
  stackingComparator,
  resolveCardLook,
  sameTokenLook,
  tokenCount,
} from './objects';
import { randomInt, shuffledIndices, secureRandomSource, type RandomSource } from './random';
import { MAX_TOKEN_STACK } from './types';
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

/**
 * Where the visible cards of a holder/pile sit, in its own frame, in drawing order (bottom first). A stack
 * shows only its top card, centred. A spread lays every card out along the holder's long side: left to right
 * (top card right-most) in a wide holder, top to bottom (top card bottom-most) in a tall one.
 */
export function cardSlots(objects: TabletopObject[], deck: DeckObject): CardSlot[] {
  return spreadLayout(objects, deck).slots;
}

export { cardRotationOf, cardTurnOf } from './objects';
export { holderPieces, isSpread, pointInObject, rotatedBox, spreadLayout, spreadsVertically, toLocal } from './holders';
export type { CardSlot, PieceSlot } from './holders';

function normalizeDegrees(d: number): number {
  const n = ((Math.round(d) % 360) + 360) % 360;
  return Number.isFinite(n) ? n : 0;
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
  const move: Command = {
    type: 'MoveObject',
    id,
    position,
    toFront: !!obj && raisedWhenMoved(obj, mode),
    // A piece put down anywhere but on a holder is out of the holder it was in.
    ...(obj && joinsHolder(obj) && obj.holderId ? { holderId: null } : {}),
  };
  if (!obj || opts.free || obj.kind === 'board' || obj.kind === 'bag' || isHolder(obj)) return move;

  const center = objectCenter({ ...obj, position });
  // What the cards go into comes to the front (a holder: its cards), as the cards would if dropped on the table.
  const toFront = true;

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
        toFront,
      };
    }
    if (target?.kind === 'card') {
      return { type: 'MergeCards', cardId: id, targetCardId: target.id, pileId: newId(), toFront };
    }
    return move;
  }
  if (isPile(obj)) {
    const target = findPileTarget(state, id, center);
    if (target?.kind === 'bag') return { type: 'BagPut', bagId: target.id, objectId: id };
    // A pile dropped on a loose card takes it in at the bottom, lying where the card lay.
    if (target?.kind === 'card') return { type: 'FormPile', ids: [target.id, id], pileId: newId(), toFront };
    if (target)
      return {
        type: 'MergePileIntoDeck',
        pileId: id,
        deckId: target.id,
        asDefinition: mode === 'edit' && !target.isPile,
        ...dropIndex(state, target, center),
        toFront,
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
  const stack = obj.kind === 'token' ? tokenStackInHolder(state, surface, obj) : undefined;
  if (stack) return { type: 'MergeTokens', id, targetId: stack.id };
  return { ...move, ...putOnHolder(surface, obj, position) };
}

/**
 * The identical token stack that `token` joins when put into `holder`: in a stacked holder that centres pieces, tokens
 * pile up as one stack (with its count), not as separate tokens on top of each other. `extra` are tokens put in by the
 * same drop, and `counts` their counts so far (a stack never grows past `MAX_TOKEN_STACK`).
 */
export function tokenStackInHolder(
  state: TableState,
  holder: DeckObject,
  token: TokenObject,
  extra: readonly TokenObject[] = [],
  counts?: ReadonlyMap<string, number>,
): TokenObject | undefined {
  if (holder.isPile || isSpread(holder) || holder.snapToCenter === false) return undefined;
  const candidates = [...sortByStacking(holderPieces(state.objects, holder), state.objects), ...extra];
  const n = (t: TokenObject) => counts?.get(t.id) ?? tokenCount(t);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    if (c.kind === 'token' && c.id !== token.id && sameTokenLook(c, token) && n(c) + tokenCount(token) <= MAX_TOKEN_STACK) return c;
  }
  return undefined;
}

/**
 * Where a piece dropped at `position` lies once put into `holder`: a spread lines it up where it was dropped (see
 * `settleHolderPieces`), a slot centres it; it takes the holder's rotation when the holder asks for that.
 */
function putOnHolder(holder: DeckObject, obj: TabletopObject, position: Vec2): { position: Vec2; holderId: string; rotation?: number } {
  const rotation = alignsRotation(holder) ? { rotation: holder.rotation } : {};
  if (!isSpread(holder) && holder.snapToCenter !== false) {
    const c = objectCenter(holder);
    return { position: { x: Math.round(c.x - obj.width / 2), y: Math.round(c.y - obj.height / 2) }, holderId: holder.id, ...rotation };
  }
  return { position, holderId: holder.id, ...rotation };
}

/** Whether `target` takes in `o` when a selection is dropped on it (anything else in the selection just moves). */
function takesInGroup(target: DeckObject | BagObject, o: TabletopObject): boolean {
  if (target.kind === 'bag') return bagAccepts(o);
  if (o.kind === 'card' || isPile(o)) return true;
  return !target.isPile && joinsHolder(o);
}

/**
 * The holder, pile or bag a dragged selection (`ids`) goes into when released with the dragged object's centre at
 * `center`: the top-most one there that takes in at least one of its objects.
 */
export function findGroupDropTarget(state: TableState, ids: readonly string[], center: Vec2): DeckObject | BagObject | undefined {
  const set = new Set(ids);
  const members = state.objects.filter((o) => set.has(o.id));
  const target = topmostContaining(
    state.objects,
    state.objects.filter((o): o is DeckObject | BagObject => !set.has(o.id) && (o.kind === 'deck' || o.kind === 'bag')),
    center,
  );
  return target && members.some((m) => takesInGroup(target, m)) ? target : undefined;
}

/**
 * Turns "a selection was dragged to these positions" into one command. Dropped on a holder, pile or bag (under the
 * centre of the dragged object `leaderId`), each object goes in as it would on its own: cards and piles join the
 * holder / pile (side by side in a spread, in their order along it), pieces are put into the holder, the bag takes
 * what it accepts. Everything else just moves; the selection comes to the front, keeping its order.
 */
export function resolveGroupDrop(
  state: TableState,
  moves: readonly { id: string; position: Vec2 }[],
  leaderId: string,
  mode: Mode,
  opts: DropOptions = {},
): Command {
  const at = new Map(moves.map((m) => [m.id, m.position]));
  const members = state.objects.filter((o) => at.has(o.id));
  // Pieces in a holder that moves along with them are carried by it.
  const carried = (o: TabletopObject) => !!o.holderId && at.has(o.holderId);
  const leader = members.find((o) => o.id === leaderId);
  const target =
    leader && !opts.free
      ? findGroupDropTarget(
          state,
          members.map((o) => o.id),
          objectCenter({ ...leader, position: at.get(leader.id)! }),
        )
      : undefined;
  const placed = members.map((o) => ({ ...o, position: at.get(o.id)! }));
  const raised = sortByStacking(
    members.filter((o) => raisedWhenMoved(o, mode)),
    state.objects,
  ).map((o) => o.id);
  const commands: Command[] = [];
  const takenIn: TabletopObject[] = [];
  for (const o of placed) {
    if (carried(o)) continue;
    if (target && takesInGroup(target, o)) {
      takenIn.push(o);
      continue;
    }
    commands.push({ type: 'MoveObject', id: o.id, position: o.position, ...(joinsHolder(o) && o.holderId ? { holderId: null } : {}) });
  }
  commands.push({ type: 'RaiseObjects', ids: raised });
  if (target?.kind === 'bag') {
    // The last one put in ends on top: put them in from the bottom of the selection up.
    for (const o of sortByStacking(takenIn, state.objects)) commands.push({ type: 'BagPut', bagId: target.id, objectId: o.id });
  } else if (target) {
    const definition = mode === 'edit' && !target.isPile;
    const index = isSpread(target)
      ? spreadInsertIndex(state.objects, target, objectCenter(placed.find((o) => o.id === leaderId)!))
      : undefined;
    const vertical = spreadsVertically(target);
    const along = (o: TabletopObject) => {
      const p = toLocal(objectCenter(o), target);
      return vertical ? p.y : p.x;
    };
    // A spread takes the cards side by side in the order they lie along it (each one goes in after the previous one);
    // a stack takes them from the bottom of the selection up, so the top-most one ends on top.
    const order = index === undefined ? sortByStacking(takenIn, state.objects) : [...takenIn].sort((a, b) => along(a) - along(b));
    // Identical tokens put into a slot pile up as one stack.
    const joined: TokenObject[] = [];
    const counts = new Map<string, number>();
    for (const o of order) {
      const stack = o.kind === 'token' && !target.isPile ? tokenStackInHolder(state, target, o, joined, counts) : undefined;
      if (o.kind === 'token' && stack) {
        counts.set(stack.id, (counts.get(stack.id) ?? tokenCount(stack)) + tokenCount(o));
        commands.push({ type: 'MergeTokens', id: o.id, targetId: stack.id });
      } else if (o.kind === 'card') {
        commands.push({ type: 'AddCardToDeck', cardId: o.id, deckId: target.id, asDefinition: definition, index, toFront: true });
      } else if (isPile(o)) {
        commands.push({ type: 'MergePileIntoDeck', pileId: o.id, deckId: target.id, asDefinition: definition, index, toFront: true });
      } else {
        commands.push({ type: 'MoveObject', id: o.id, ...putOnHolder(target, o, o.position) });
        if (o.kind === 'token') joined.push(o);
      }
    }
  }
  return { type: 'Batch', commands };
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

/** Top-left corner of the count badge on a holder, pile or bag `width` wide, in its own (unrotated) coordinates. */
export function stackBadgeOrigin(width: number): Vec2 {
  return { x: width - 34, y: -14 };
}

/**
 * Lifts the whole stack out of a holder: a single card is drawn, more become a pile. The pile is centred at `at`,
 * or, with `badgeGrab` (the point of the holder's count badge held by the pointer, in badge coordinates), placed so
 * that the same point of its own badge is at `at`, keeping the badge under the pointer.
 */
export function takeStackCommand(objects: TabletopObject[], holder: DeckObject, at: Vec2, badgeGrab?: Vec2): Command | null {
  const top = holder.cards[0];
  if (!top) return null;
  const look = resolveCardLook(top, holder, ownerDeckOf(objects, top.id));
  const badge = stackBadgeOrigin(look.width);
  const corner =
    badgeGrab && holder.cards.length > 1
      ? { x: at.x - badgeGrab.x - badge.x, y: at.y - badgeGrab.y - badge.y }
      : { x: at.x - look.width / 2, y: at.y - look.height / 2 };
  const position = { x: Math.round(corner.x), y: Math.round(corner.y) };
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

/**
 * Degrees the hover preview of `o` is turned when it follows the object: a holder adds the turn of the card shown
 * (`cardId`, or its top card).
 */
export function hoverRotationOf(o: TabletopObject, cardId?: string | null): number {
  if (o.kind !== 'deck') return normalizeDegrees(o.rotation);
  const card = (cardId ? o.cards.find((c) => c.id === cardId) : undefined) ?? o.cards[0];
  return normalizeDegrees(o.rotation + cardTurnOf(o, card));
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
