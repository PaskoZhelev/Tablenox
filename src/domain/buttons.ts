import { applyCommand, type Command } from './commands';
import { objectCenter } from './geometry';
import { newId } from './ids';
import { bagAccepts, bagCount, bagItemWeight, displayName, drawnFaceUp, homeDeckMap, isHolder, sortByZ } from './objects';
import { secureRandomSource, type RandomSource } from './random';
import {
  bagOf,
  defaultBagDrawPosition,
  defaultDrawPosition,
  homeDeckOf,
  pointInObject,
  rollDieCommand,
  shuffleBagCommand,
  shuffleDeckCommand,
  tokenSourceOf,
  tokensTakenFrom,
  topFaceUp,
} from './rules';
import type {
  BagObject,
  ButtonObject,
  ButtonStep,
  CardObject,
  CheckboxObject,
  CheckStep,
  CounterStep,
  DeckObject,
  FlipStep,
  MoveStep,
  ObjectId,
  ObjectKind,
  RotateStep,
  SortStep,
  StepOrientation,
  StepType,
  TableState,
  TabletopObject,
} from './types';

export const STEP_TYPES: StepType[] = ['move', 'recall', 'rotate', 'flip', 'shuffle', 'sort', 'roll', 'counter', 'check'];

export const STEP_LABELS: Record<StepType, string> = {
  move: 'Move objects',
  recall: 'Recall objects',
  rotate: 'Rotate',
  flip: 'Flip',
  shuffle: 'Shuffle',
  sort: 'Sort',
  roll: 'Roll dice',
  counter: 'Change counter',
  check: 'Check boxes',
};

export const MAX_STEPS = 100;

export const BUTTON_LABEL_PADDING = 6;
const MIN_FONT_SIZE = 6;

/** Largest label size for a button: its own setting, or (auto) one that suits the button's height. */
export function buttonMaxFontSize(b: Pick<ButtonObject, 'fontSize' | 'height'>): number {
  return b.fontSize ?? Math.max(10, Math.min(72, b.height * 0.42));
}

/**
 * Largest whole font size up to `max` at which `text`, word-wrapped, fits in `width` x `height`.
 * `measure(s, size)` is the rendered width of `s`; lines are `size` tall.
 */
export function fitFontSize(
  text: string,
  width: number,
  height: number,
  max: number,
  measure: (s: string, size: number) => number,
): number {
  const top = Math.max(MIN_FONT_SIZE, Math.floor(max));
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return top;
  const fits = (size: number) => {
    if (words.some((w) => measure(w, size) > width)) return false;
    let lines = 1;
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (measure(next, size) <= width) line = next;
      else {
        lines++;
        line = w;
      }
    }
    return lines * size <= height;
  };
  if (fits(top)) return top;
  let lo = MIN_FONT_SIZE;
  let hi = top;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function createStep(type: StepType): ButtonStep {
  const base = { id: newId(), objectIds: [] as ObjectId[] };
  switch (type) {
    case 'move':
      return { ...base, type, targetIds: [], deckMode: 'top', orientation: 'keep' };
    case 'rotate':
      return { ...base, type, mode: 'by', degrees: 90 };
    case 'flip':
      return { ...base, type, mode: 'toggle' };
    case 'sort':
      return { ...base, type, by: 'original' };
    case 'counter':
      return { ...base, type, mode: 'add', amount: 1 };
    case 'check':
      return { ...base, type, mode: 'toggle' };
    case 'recall':
    case 'shuffle':
    case 'roll':
      return { ...base, type };
  }
}

/** Kinds a step type can act on (a holder also stands for what lies on it). Unlisted types accept any object. */
const STEP_KINDS: Partial<Record<StepType, ObjectKind[]>> = {
  recall: ['card', 'deck', 'token', 'die', 'counter', 'label', 'image', 'bag'],
  flip: ['card', 'deck'],
  shuffle: ['deck', 'bag'],
  sort: ['deck'],
  roll: ['die', 'deck'],
  counter: ['counter', 'deck'],
  check: ['checkbox', 'board', 'deck'],
};

export function stepAcceptsObject(type: StepType, o: TabletopObject): boolean {
  if ((type === 'roll' || type === 'counter' || type === 'check') && o.kind === 'deck') return !o.isPile;
  return STEP_KINDS[type]?.includes(o.kind) ?? true;
}

export type PickField = 'objects' | 'target';

/** Whether `o` can be chosen for a step's object list or destination (a button never targets itself). */
export function canPick(step: ButtonStep, field: PickField, o: TabletopObject, buttonId: ObjectId): boolean {
  if (o.id === buttonId) return false;
  return field === 'target' ? step.type === 'move' : stepAcceptsObject(step.type, o);
}

/** Ids currently chosen in a step field. */
export function pickedIds(step: ButtonStep, field: PickField): ObjectId[] {
  if (field === 'objects') return step.objectIds;
  return step.type === 'move' ? step.targetIds : [];
}

/** `ids` with a pick applied: `toggle` adds or removes one id, `add` adds every given id (box selection). */
function pickInto(list: ObjectId[], ids: ObjectId[], how: 'toggle' | 'add'): ObjectId[] {
  if (how === 'toggle' && ids.length === 1 && list.includes(ids[0])) return list.filter((id) => id !== ids[0]);
  const added = [...new Set(ids)].filter((id) => !list.includes(id));
  return added.length ? [...list, ...added] : list;
}

/**
 * Applies a table pick to a step's object list or (move steps) its destinations: `toggle` adds or removes one
 * object, `add` adds every given object (box selection).
 */
export function applyPick(step: ButtonStep, field: PickField, ids: ObjectId[], how: 'toggle' | 'add'): ButtonStep {
  if (ids.length === 0) return step;
  if (field === 'target') {
    if (step.type !== 'move') return step;
    const targetIds = pickInto(step.targetIds, ids, how);
    return targetIds === step.targetIds ? step : { ...step, targetIds };
  }
  const objectIds = pickInto(step.objectIds, ids, how);
  return objectIds === step.objectIds ? step : { ...step, objectIds };
}

/** Kinds that never count as lying on a holder (surfaces and controls). */
const NOT_HOLDER_CONTENT = new Set<TabletopObject['kind']>(['board', 'button', 'bag']);

/**
 * The objects a step acts on: the listed objects, where a holder stands for itself (its own cards) followed
 * by the loose pieces lying on it.
 */
export function resolveTargets(state: TableState, ids: readonly ObjectId[]): TabletopObject[] {
  const seen = new Set<ObjectId>();
  const out: TabletopObject[] = [];
  const add = (o: TabletopObject) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    out.push(o);
  };
  const sorted = sortByZ(state.objects);
  for (const id of ids) {
    const o = state.objects.find((x) => x.id === id);
    if (!o) continue;
    add(o);
    if (isHolder(o)) {
      sorted
        .filter((m) => !NOT_HOLDER_CONTENT.has(m.kind) && !isHolder(m) && m.zIndex > o.zIndex && pointInObject(objectCenter(m), o))
        .forEach(add);
    }
  }
  return out;
}

/** Applies commands to a working copy so that later steps see the effect of earlier ones. */
class Plan {
  commands: Command[] = [];
  state: TableState;

  constructor(state: TableState) {
    this.state = state;
  }

  emit(cmd: Command): void {
    this.commands.push(cmd);
    this.state = applyCommand(this.state, cmd);
  }

  find(id: ObjectId | undefined): TabletopObject | undefined {
    return id === undefined ? undefined : this.state.objects.find((o) => o.id === id);
  }
}

const normalizeDegrees = (d: number) => ((d % 360) + 360) % 360;

function setOrientation(plan: Plan, card: CardObject, orientation: StepOrientation): void {
  if (orientation === 'keep' || card.faceUp === (orientation === 'faceUp')) return;
  plan.emit({ type: 'FlipCard', id: card.id });
}

/** Draws `count` cards from a deck/pile (not placing them anywhere); returns the new card ids in draw order. */
function drawCards(plan: Plan, deck: DeckObject, count: number, from: 'top' | 'bottom', orientation: StepOrientation): string[] {
  const cards = from === 'top' ? deck.cards : [...deck.cards].reverse();
  const ids: string[] = [];
  for (const c of cards.slice(0, count)) {
    const cardId = newId();
    ids.push(cardId);
    plan.emit({
      type: 'DrawCard',
      deckId: deck.id,
      cardId,
      position: defaultDrawPosition(deck),
      faceUp: orientation === 'keep' ? drawnFaceUp(deck, c) : orientation === 'faceUp',
      fromBottom: from === 'bottom',
    });
  }
  return ids;
}

/** Moves cards between decks, keeping their relative order. */
function moveCardsToDeck(plan: Plan, source: DeckObject, target: DeckObject, count: number, from: 'top' | 'bottom', o: StepOrientation) {
  const ids = drawCards(plan, source, count, from, o);
  // The last card added ends on top, so add from the one that has to end up lowest.
  const addOrder = from === 'top' ? [...ids].reverse() : ids;
  for (const cardId of addOrder) plan.emit({ type: 'AddCardToDeck', cardId, deckId: target.id });
}

const BACKGROUND_KINDS = new Set<TabletopObject['kind']>(['board', 'deck', 'bag']);

/** Top-most card or pile lying on `target`, other than `exceptId`: where further cards are stacked. */
function stackTop(plan: Plan, target: TabletopObject, exceptId: string): TabletopObject | undefined {
  return plan.state.objects
    .filter(
      (o) =>
        (o.kind === 'card' || (o.kind === 'deck' && o.isPile)) &&
        o.id !== exceptId &&
        o.id !== target.id &&
        o.zIndex > target.zIndex &&
        pointInObject(objectCenter(o), target),
    )
    .sort((a, b) => b.zIndex - a.zIndex)[0];
}

/**
 * Puts an item onto a destination that doesn't hold cards itself (a token, a board...): a card joins the
 * pile or forms a pile with the card already moved there (so the count shows), a pile merges into a pile
 * there, anything else is centred on the destination.
 */
function placeOnto(plan: Plan, target: TabletopObject, id: string, rotation: number | undefined): void {
  const item = plan.find(id);
  if (!item) return;
  const top = stackTop(plan, target, id);
  if (item.kind === 'card' && top?.kind === 'deck') return plan.emit({ type: 'AddCardToDeck', cardId: id, deckId: top.id });
  if (item.kind === 'card' && top?.kind === 'card') {
    return plan.emit({ type: 'MergeCards', cardId: id, targetCardId: top.id, pileId: newId() });
  }
  if (item.kind === 'deck' && item.isPile && top?.kind === 'deck') {
    return plan.emit({ type: 'MergePileIntoDeck', pileId: id, deckId: top.id });
  }
  const c = objectCenter(target);
  const position = { x: Math.round(c.x - item.width / 2), y: Math.round(c.y - item.height / 2) };
  plan.emit({ type: 'MoveObject', id, position, toFront: !BACKGROUND_KINDS.has(item.kind), rotation });
}

/**
 * Takes `count` pieces out of a bag (not placing them anywhere); returns the ids of the objects now on the
 * table, in draw order. A token stack gives up its tokens one by one.
 */
function drawFromBag(plan: Plan, bag: BagObject, count: number, from: 'top' | 'bottom', orientation: StepOrientation): string[] {
  const entries = from === 'top' ? bag.items : [...bag.items].reverse();
  const ids: string[] = [];
  for (const entry of entries) {
    const n = Math.min(count - ids.length, bagItemWeight(entry));
    for (let k = 0; k < n; k++) {
      const fresh = newId();
      plan.emit({ type: 'BagDraw', bagId: bag.id, itemId: entry.id, newId: fresh, position: defaultBagDrawPosition(bag) });
      // The last token of a stack (and any other entry) comes out as itself.
      const id = plan.find(fresh) ? fresh : entry.id;
      const drawn = plan.find(id);
      if (drawn?.kind === 'card') setOrientation(plan, drawn, orientation);
      ids.push(id);
    }
    if (ids.length >= count) break;
  }
  return ids;
}

/** Puts an object that is on the table onto a destination: into a holder/pile/bag, or onto any other object. */
function deliver(plan: Plan, target: TabletopObject, id: string, rotation: number | undefined): void {
  const item = plan.find(id);
  if (!item) return;
  if (target.kind === 'bag') return plan.emit({ type: 'BagPut', bagId: target.id, objectId: id });
  if (target.kind === 'deck' && item.kind === 'card') return plan.emit({ type: 'AddCardToDeck', cardId: id, deckId: target.id });
  if (target.kind === 'deck' && item.kind === 'deck' && item.isPile) {
    return plan.emit({ type: 'MergePileIntoDeck', pileId: id, deckId: target.id });
  }
  placeOnto(plan, target, id, rotation);
}

/**
 * Move step: holders, piles and bags give up cards or pieces (the container itself never moves); cards go
 * into a destination holder/pile, pieces into a destination bag, and everything is stacked on any other
 * destination; other pieces are centred on the destination. With several destinations, cards and pieces
 * from containers are dealt to them in turn, `count` each, and loose pieces go one per destination in turn.
 */
function planMove(plan: Plan, step: MoveStep): void {
  const targets = step.targetIds.map((id) => plan.find(id)).filter((t): t is TabletopObject => !!t);
  if (targets.length === 1) moveToOne(plan, step, targets[0]);
  else if (targets.length > 1)
    dealToMany(
      plan,
      step,
      targets.map((t) => t.id),
    );
}

const alignedRotation = (target: TabletopObject) => (isHolder(target) && target.alignRotation ? target.rotation : undefined);

function moveToOne(plan: Plan, step: MoveStep, target: TabletopObject): void {
  const into = target.kind === 'deck' ? target : undefined;
  const rotation = alignedRotation(target);
  for (const listed of resolveTargets(plan.state, step.objectIds)) {
    // Earlier iterations may have consumed it (an emptied pile, a merged card).
    const src = plan.find(listed.id);
    if (!src || src.id === target.id) continue;
    if (src.kind === 'bag') {
      const count = Math.min(step.count ?? bagCount(src), bagCount(src));
      for (const id of drawFromBag(plan, src, count, step.deckMode, step.orientation)) deliver(plan, target, id, rotation);
    } else if (src.kind === 'deck') {
      const count = Math.min(step.count ?? src.cards.length, src.cards.length);
      if (count === 0) continue;
      if (into) moveCardsToDeck(plan, src, into, count, step.deckMode, step.orientation);
      else {
        const ids = drawCards(plan, src, count, step.deckMode, step.orientation);
        // The last card put into a bag ends on top, so add from the one that has to end up lowest.
        for (const cardId of target.kind === 'bag' ? [...ids].reverse() : ids) deliver(plan, target, cardId, rotation);
      }
    } else if (src.kind === 'card') {
      setOrientation(plan, src, step.orientation);
      deliver(plan, target, src.id, rotation);
    } else if (target.kind !== 'bag' || bagAccepts(src)) {
      deliver(plan, target, src.id, rotation);
    }
  }
}

function dealToMany(plan: Plan, step: MoveStep, targetIds: ObjectId[]): void {
  const isTarget = new Set(targetIds);
  const n = targetIds.length;
  const deliverTo = (i: number, id: string) => {
    const target = plan.find(targetIds[i % n]);
    if (target) deliver(plan, target, id, alignedRotation(target));
  };
  // Loose pieces take turns across all sources, so four listed cards and four destinations give one each.
  let turn = 0;
  for (const listed of resolveTargets(plan.state, step.objectIds)) {
    const src = plan.find(listed.id);
    if (!src || isTarget.has(src.id)) continue;
    if (src.kind === 'bag' || src.kind === 'deck') {
      const available = src.kind === 'bag' ? bagCount(src) : src.cards.length;
      const total = Math.min(step.count === undefined ? available : step.count * n, available);
      if (total === 0) continue;
      const ids =
        src.kind === 'bag'
          ? drawFromBag(plan, src, total, step.deckMode, step.orientation)
          : drawCards(plan, src, total, step.deckMode, step.orientation);
      // Dealt like cards at a table: one to each destination in turn, round after round.
      ids.forEach((id, i) => deliverTo(i, id));
    } else if (src.kind === 'card') {
      setOrientation(plan, src, step.orientation);
      deliverTo(turn++, src.id);
    } else {
      const target = plan.find(targetIds[turn % n]);
      if (target && (target.kind !== 'bag' || bagAccepts(src))) deliverTo(turn++, src.id);
    }
  }
}

function planRecall(plan: Plan, objectIds: ObjectId[]): void {
  const reset = new Set<ObjectId>();
  const resetOnce = (deckId: ObjectId) => {
    if (reset.has(deckId) || plan.find(deckId)?.kind !== 'deck') return;
    reset.add(deckId);
    plan.emit({ type: 'ResetDeck', deckId });
  };
  for (const listed of resolveTargets(plan.state, objectIds)) {
    const o = plan.find(listed.id);
    if (!o) continue;
    if (o.kind === 'bag') {
      plan.emit({ type: 'RecallToBag', bagId: o.id });
    } else if (o.kind === 'token') {
      // A stack gathers the tokens taken off it; a loose token goes back to its bag or stack.
      const taken = tokensTakenFrom(plan.state, o);
      const bag = bagOf(plan.state, o);
      if (taken.length > 0) taken.forEach((t) => plan.emit({ type: 'RecallToken', id: t.id }));
      else if (bag) plan.emit({ type: 'BagPut', bagId: bag.id, objectId: o.id });
      else if (tokenSourceOf(plan.state, o)) plan.emit({ type: 'RecallToken', id: o.id });
    } else if (o.kind === 'card') {
      const bag = bagOf(plan.state, o);
      const home = homeDeckOf(plan.state, o);
      if (bag) plan.emit({ type: 'BagPut', bagId: bag.id, objectId: o.id });
      else if (home && !home.isPile) plan.emit({ type: 'AddCardToDeck', cardId: o.id, deckId: home.id });
    } else if (o.kind === 'deck') {
      if (!o.isPile && o.initialCards.length > 0) resetOnce(o.id);
      // Cards from other holders lying in this one go back to theirs.
      const homes = homeDeckMap(plan.state.objects);
      const now = plan.find(o.id);
      for (const c of now?.kind === 'deck' ? now.cards : []) {
        const home = homes.get(c.id);
        if (home && home !== o.id) resetOnce(home);
      }
    } else {
      const bag = bagOf(plan.state, o);
      if (bag) plan.emit({ type: 'BagPut', bagId: bag.id, objectId: o.id });
    }
  }
}

function planRotate(plan: Plan, step: RotateStep): void {
  for (const o of resolveTargets(plan.state, step.objectIds)) {
    const rotation = step.mode === 'by' ? o.rotation + step.degrees : step.degrees;
    plan.emit({ type: 'MoveObject', id: o.id, position: o.position, rotation: normalizeDegrees(rotation) });
  }
}

function planFlip(plan: Plan, step: FlipStep): void {
  for (const o of resolveTargets(plan.state, step.objectIds)) {
    if (o.kind === 'card') {
      setOrientation(plan, o, step.mode === 'toggle' ? (o.faceUp ? 'faceDown' : 'faceUp') : step.mode);
    } else if (o.kind === 'deck' && o.cards.length > 0) {
      // A deck/pile is turned over as a whole when its top side isn't the requested one.
      if (step.mode === 'toggle' || topFaceUp(o) !== (step.mode === 'faceUp')) plan.emit({ type: 'FlipDeck', id: o.id });
    }
  }
}

function planCounter(plan: Plan, step: CounterStep): void {
  for (const o of resolveTargets(plan.state, step.objectIds)) {
    if (o.kind === 'counter')
      plan.emit({ type: 'IncrementCounter', id: o.id, delta: step.mode === 'add' ? step.amount : step.amount - o.value });
  }
}

function planSort(plan: Plan, step: SortStep): void {
  for (const o of resolveTargets(plan.state, step.objectIds)) {
    if (o.kind === 'deck') plan.emit({ type: 'SortDeck', id: o.id, by: step.by });
  }
}

/** Checkboxes lying on a board (above it, centre inside it). */
function checkboxesOn(state: TableState, board: TabletopObject): CheckboxObject[] {
  return state.objects.filter(
    (o): o is CheckboxObject => o.kind === 'checkbox' && o.zIndex > board.zIndex && pointInObject(objectCenter(o), board),
  );
}

function planCheck(plan: Plan, step: CheckStep): void {
  const seen = new Set<ObjectId>();
  const boxes: CheckboxObject[] = [];
  for (const o of resolveTargets(plan.state, step.objectIds)) {
    const found = o.kind === 'checkbox' ? [o] : o.kind === 'board' ? checkboxesOn(plan.state, o) : [];
    for (const b of found) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      boxes.push(b);
    }
  }
  for (const b of boxes) {
    const checked = step.mode === 'toggle' ? !b.checked : step.mode === 'check';
    if (checked !== b.checked) plan.emit({ type: 'UpdateObject', id: b.id, patch: { checked } });
  }
}

function planStep(plan: Plan, step: ButtonStep, random: RandomSource): void {
  switch (step.type) {
    case 'move':
      return planMove(plan, step);
    case 'recall':
      return planRecall(plan, step.objectIds);
    case 'rotate':
      return planRotate(plan, step);
    case 'flip':
      return planFlip(plan, step);
    case 'shuffle':
      for (const o of resolveTargets(plan.state, step.objectIds)) {
        if (o.kind === 'deck' && o.cards.length > 1) plan.emit(shuffleDeckCommand(o, random));
        else if (o.kind === 'bag' && o.items.length > 1) plan.emit(shuffleBagCommand(o, random));
      }
      return;
    case 'sort':
      return planSort(plan, step);
    case 'roll':
      for (const o of resolveTargets(plan.state, step.objectIds)) if (o.kind === 'die') plan.emit(rollDieCommand(o, random));
      return;
    case 'counter':
      return planCounter(plan, step);
    case 'check':
      return planCheck(plan, step);
  }
}

/**
 * The command that runs a button's steps in order, or null when nothing would change. Randomness and new
 * object ids are decided here, so the returned command replays deterministically.
 */
export function planButton(state: TableState, button: ButtonObject, random: RandomSource = secureRandomSource): Command | null {
  const plan = new Plan(state);
  for (const step of button.steps) planStep(plan, step, random);
  if (plan.state === state || plan.commands.length === 0) return null;
  return { type: 'Batch', commands: plan.commands };
}

function nameOf(state: TableState, id: ObjectId): string {
  const o = state.objects.find((x) => x.id === id);
  return o ? displayName(o) : 'missing object';
}

/** Short list of object names for step summaries. */
export function describeObjects(state: TableState, ids: readonly ObjectId[]): string {
  if (ids.length === 0) return 'nothing selected';
  const names = ids.slice(0, 3).map((id) => nameOf(state, id));
  return ids.length > 3 ? `${names.join(', ')} +${ids.length - 3} more` : names.join(', ');
}

/** One-line summary of a step, e.g. "Move top 2 cards of Deck to Hand". */
export function describeStep(state: TableState, step: ButtonStep): string {
  const what = describeObjects(state, step.objectIds);
  switch (step.type) {
    case 'move': {
      const to = step.targetIds.length ? describeObjects(state, step.targetIds) : 'no destination';
      const n = step.count;
      const subject = n === undefined ? what : `${step.deckMode} ${n} card${n === 1 ? '' : 's'} of ${what}`;
      if (step.targetIds.length > 1) return n === undefined ? `Deal ${what} among ${to}` : `Deal ${subject} to each of ${to}`;
      return `Move ${subject} to ${to}`;
    }
    case 'recall':
      return `Recall ${what}`;
    case 'rotate':
      return step.mode === 'by' ? `Rotate ${what} by ${step.degrees}°` : `Rotate ${what} to ${step.degrees}°`;
    case 'flip':
      return `Flip ${what}${step.mode === 'toggle' ? '' : step.mode === 'faceUp' ? ' face up' : ' face down'}`;
    case 'shuffle':
      return `Shuffle ${what}`;
    case 'sort':
      return `Sort ${what} by ${step.by === 'name' ? 'name' : 'original order'}`;
    case 'roll':
      return `Roll ${what}`;
    case 'counter':
      return step.mode === 'add' ? `Change ${what} by ${step.amount}` : `Set ${what} to ${step.amount}`;
    case 'check':
      return step.mode === 'toggle' ? `Toggle ${what}` : step.mode === 'check' ? `Check ${what}` : `Uncheck ${what}`;
  }
}
