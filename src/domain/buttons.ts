import { applyCommand, type Command } from './commands';
import { objectCenter } from './geometry';
import { newId } from './ids';
import { bagAccepts, bagCount, bagItemWeight, displayName, drawnFaceUp, homeDeckMap, isHolder, sortByZ } from './objects';
import { randomInt, secureRandomSource, type RandomSource } from './random';
import {
  bagOf,
  cardRotationOf,
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
  CardDef,
  CardObject,
  CheckboxObject,
  CheckStep,
  CounterStep,
  DeckObject,
  FlipMode,
  FlipStep,
  MoveStep,
  ObjectId,
  ObjectKind,
  PickStep,
  RecallStep,
  RotateStep,
  SortStep,
  StepOrientation,
  StepType,
  TableState,
  TabletopObject,
  TimerStep,
} from './types';
import { timerFinished } from './timer';

export const STEP_TYPES: StepType[] = ['move', 'pick', 'recall', 'rotate', 'flip', 'shuffle', 'sort', 'roll', 'counter', 'check', 'timer'];

export const STEP_LABELS: Record<StepType, string> = {
  move: 'Move objects',
  pick: 'Pick cards',
  recall: 'Recall objects',
  rotate: 'Rotate',
  flip: 'Flip',
  shuffle: 'Shuffle',
  sort: 'Sort',
  roll: 'Roll dice',
  counter: 'Change counter',
  check: 'Check boxes',
  timer: 'Timer',
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
    case 'pick':
      return { ...base, type, targetIds: [], orientation: 'keep', choose: 'edit' };
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
    case 'timer':
      return { ...base, type, mode: 'start' };
    case 'recall':
    case 'shuffle':
    case 'roll':
      return { ...base, type };
  }
}

/** Kinds a step type can act on (a holder also stands for what lies on it). Unlisted types accept any object. */
const STEP_KINDS: Partial<Record<StepType, ObjectKind[]>> = {
  recall: ['card', 'deck', 'token', 'die', 'counter', 'label', 'image', 'bag'],
  pick: ['deck'],
  flip: ['card', 'deck'],
  shuffle: ['deck', 'bag'],
  sort: ['deck'],
  roll: ['die', 'deck'],
  counter: ['counter', 'deck'],
  check: ['checkbox', 'board', 'deck'],
  timer: ['timer'],
};

export function stepAcceptsObject(type: StepType, o: TabletopObject): boolean {
  if ((type === 'roll' || type === 'counter' || type === 'check') && o.kind === 'deck') return !o.isPile;
  return STEP_KINDS[type]?.includes(o.kind) ?? true;
}

export type PickField = 'objects' | 'target';

/** Steps with destinations (`targetIds`). */
const hasTargets = (step: ButtonStep): step is MoveStep | PickStep => step.type === 'move' || step.type === 'pick';

/** Whether `o` can be chosen for a step's object list or destination (a button never targets itself). */
export function canPick(step: ButtonStep, field: PickField, o: TabletopObject, buttonId: ObjectId): boolean {
  if (o.id === buttonId) return false;
  return field === 'target' ? hasTargets(step) : stepAcceptsObject(step.type, o);
}

/** Ids currently chosen in a step field. */
export function pickedIds(step: ButtonStep, field: PickField): ObjectId[] {
  if (field === 'objects') return step.objectIds;
  return hasTargets(step) ? step.targetIds : [];
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
    if (!hasTargets(step)) return step;
    const targetIds = pickInto(step.targetIds, ids, how);
    return targetIds === step.targetIds ? step : { ...step, targetIds };
  }
  const objectIds = pickInto(step.objectIds, ids, how);
  if (objectIds === step.objectIds) return step;
  return step.type === 'pick' ? withPickHolders(step, objectIds) : { ...step, objectIds };
}

/** Whether a Pick step's cards are set up with the step (rather than chosen when the button runs). */
export const picksInEdit = (step: PickStep) => step.choose === 'edit';

/** A Pick step with a new holder list; cards set up for holders no longer listed are dropped. */
export function withPickHolders(step: PickStep, objectIds: ObjectId[]): PickStep {
  if (!step.cards) return { ...step, objectIds };
  const kept = Object.entries(step.cards).filter(([holderId]) => objectIds.includes(holderId));
  return { ...step, objectIds, cards: kept.length ? Object.fromEntries(kept) : undefined };
}

/** A Pick step with the cards set up for one holder (card definition ids; none = nothing set up for it). */
export function withPickCards(step: PickStep, holderId: ObjectId, cardIds: readonly string[]): PickStep {
  const { [holderId]: _old, ...rest } = step.cards ?? {};
  const cards = cardIds.length ? { ...rest, [holderId]: [...new Set(cardIds)] } : rest;
  return { ...step, cards: Object.keys(cards).length ? cards : undefined };
}

/**
 * The cards a Pick step can be set up with for a holder / pile: a holder's definition (every card it owns,
 * wherever it is now), otherwise the cards in it.
 */
export function pickableCards(deck: DeckObject): CardDef[] {
  return !deck.isPile && deck.initialCards.length > 0 ? deck.initialCards : deck.cards;
}

/** The cards set up for `holderId` that it can still give (see `pickableCards`), in holder order. */
export function presetPickCards(step: PickStep, deck: DeckObject): CardDef[] {
  const wanted = new Set(step.cards?.[deck.id] ?? []);
  return pickableCards(deck).filter((c) => wanted.has(c.id));
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

/** Cards the player chose for Pick steps while a button runs: `pickKey(stepId, holderId)` → card ids. */
export type PickChoices = Readonly<Record<string, readonly string[]>>;

export const pickKey = (stepId: string, holderId: ObjectId) => `${stepId}:${holderId}`;

/** A Pick step waiting for the player: the holder / pile as it is at that point of the run. */
export interface PendingPick {
  key: string;
  step: PickStep;
  deck: DeckObject;
}

class PickNeeded {
  readonly pick: PendingPick;
  constructor(pick: PendingPick) {
    this.pick = pick;
  }
}

/** Applies commands to a working copy so that later steps see the effect of earlier ones. */
class Plan {
  commands: Command[] = [];
  state: TableState;
  readonly picks: PickChoices;
  /** Stop at a Pick step without a choice (instead of skipping it). */
  readonly interactive: boolean;

  constructor(state: TableState, picks: PickChoices = {}, interactive = false) {
    this.state = state;
    this.picks = picks;
    this.interactive = interactive;
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

/** Draws the chosen cards of a holder / pile one by one (in holder order); returns the new card ids. */
function drawChosen(plan: Plan, deckId: ObjectId, picked: CardDef[], orientation: StepOrientation): string[] {
  const ids: string[] = [];
  for (const c of picked) {
    const now = plan.find(deckId);
    if (now?.kind !== 'deck') break;
    const index = now.cards.findIndex((x) => x.id === c.id);
    if (index < 0) continue;
    const cardId = newId();
    ids.push(cardId);
    plan.emit({
      type: 'DrawCard',
      deckId,
      cardId,
      position: defaultDrawPosition(now),
      faceUp: orientation === 'keep' ? drawnFaceUp(now, c) : orientation === 'faceUp',
      index,
    });
  }
  return ids;
}

/**
 * Pick step: takes chosen cards from each listed holder / pile: the ones set up with the step, or the ones the
 * player chose while the button runs (`plan.picks`; an interactive run stops here to ask). They go onto the
 * destination (dealt in turn with several), or next to the holder (one pile).
 */
function planPick(plan: Plan, step: PickStep): void {
  const targets = step.targetIds.map((id) => plan.find(id)).filter((t): t is TabletopObject => !!t);
  const preset = picksInEdit(step);
  let turn = 0;
  for (const id of step.objectIds) {
    const deck = plan.find(id);
    if (deck?.kind !== 'deck' || deck.cards.length === 0) continue;
    const key = pickKey(step.id, deck.id);
    const chosen = preset ? (step.cards?.[deck.id] ?? []) : plan.picks[key];
    if (!chosen) {
      if (plan.interactive) throw new PickNeeded({ key, step, deck });
      continue;
    }
    const wanted = new Set(chosen);
    const picked = deck.cards.filter((c) => wanted.has(c.id));
    if (picked.length === 0) continue;
    if (targets.length === 0) {
      if (picked.length === 1) {
        drawChosen(plan, deck.id, picked, step.orientation);
        continue;
      }
      const pileId = newId();
      const ids = picked.map((c) => c.id);
      plan.emit({ type: 'DrawCards', deckId: deck.id, pileId, position: defaultDrawPosition(deck), count: ids.length, cardIds: ids });
      const pile = plan.find(pileId);
      if (pile?.kind === 'deck' && step.orientation !== 'keep') {
        const faceUp = step.orientation === 'faceUp';
        plan.emit({ type: 'UpdateObject', id: pileId, patch: { cards: pile.cards.map((c) => ({ ...c, faceUp })) } });
      }
      continue;
    }
    const ids = drawChosen(plan, deck.id, picked, step.orientation);
    if (targets.length === 1) {
      const target = targets[0];
      // The last card put into a holder / bag ends on top, so add from the one that has to end up lowest.
      const order = target.kind === 'deck' || target.kind === 'bag' ? [...ids].reverse() : ids;
      for (const cardId of order) deliver(plan, target, cardId, alignedRotation(target));
    } else {
      for (const cardId of ids) {
        const target = plan.find(targets[turn++ % targets.length].id);
        if (target) deliver(plan, target, cardId, alignedRotation(target));
      }
    }
  }
}

function planRecall(plan: Plan, step: RecallStep, random: RandomSource): void {
  const reset = new Set<ObjectId>();
  // Holders and bags the step gathers into, in order: the recall options apply to them afterwards.
  const gathered = new Set<ObjectId>();
  const resetOnce = (deckId: ObjectId) => {
    gathered.add(deckId);
    if (reset.has(deckId) || plan.find(deckId)?.kind !== 'deck') return;
    reset.add(deckId);
    plan.emit({ type: 'ResetDeck', deckId, keepCardTurn: true });
  };
  for (const listed of resolveTargets(plan.state, step.objectIds)) {
    const o = plan.find(listed.id);
    if (!o) continue;
    if (o.kind === 'bag') {
      gathered.add(o.id);
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
      else if (home && !home.isPile) {
        gathered.add(home.id);
        plan.emit({ type: 'AddCardToDeck', cardId: o.id, deckId: home.id });
      }
    } else if (o.kind === 'deck') {
      if (!o.isPile) gathered.add(o.id);
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
  for (const id of gathered) {
    let o = plan.find(id);
    if (o?.kind === 'deck' && !o.isPile) {
      if ((step.rotation ?? 'reset') === 'reset' && o.cardTurn !== undefined)
        plan.emit({ type: 'UpdateObject', id, patch: { cardTurn: undefined } });
      const side = step.orientation ?? 'faceDown';
      if (side !== 'keep') {
        const before = o.cards;
        const cards: CardDef[] = before.map(({ faceUp: _old, ...c }) => (side === 'faceUp' ? { ...c, faceUp: true } : c));
        if (cards.some((c, i) => c.faceUp !== before[i].faceUp)) plan.emit({ type: 'UpdateObject', id, patch: { cards } });
      }
      o = plan.find(id);
      if (step.shuffle && o?.kind === 'deck' && o.cards.length > 1) plan.emit(shuffleDeckCommand(o, random));
    } else if (step.shuffle && o?.kind === 'bag' && o.items.length > 1) {
      plan.emit(shuffleBagCommand(o, random));
    }
  }
}

function planRotate(plan: Plan, step: RotateStep): void {
  for (const o of resolveTargets(plan.state, step.objectIds)) {
    if (isHolder(o)) {
      // A holder stands for what is in it: its cards turn (`cardTurn`), the holder itself stays as it is.
      const target = normalizeDegrees(step.mode === 'by' ? cardRotationOf(o) + step.degrees : step.degrees);
      const turn = normalizeDegrees(target - (o.cardRotation ?? 0));
      plan.emit({ type: 'UpdateObject', id: o.id, patch: { cardTurn: turn === 0 ? undefined : turn } });
      continue;
    }
    const rotation = step.mode === 'by' ? o.rotation + step.degrees : step.degrees;
    plan.emit({ type: 'MoveObject', id: o.id, position: o.position, rotation: normalizeDegrees(rotation) });
  }
}

/** Whether a card (or a deck's top card) showing `faceUp` is turned over by a flip in `mode`. */
function flipsOver(mode: FlipMode, faceUp: boolean, random: RandomSource): boolean {
  if (mode === 'toggle') return true;
  if (mode === 'random') return randomInt(2, random) === 1;
  return faceUp !== (mode === 'faceUp');
}

function planFlip(plan: Plan, step: FlipStep, random: RandomSource): void {
  const count = step.count;
  let looseLeft = count ?? Infinity;
  for (const o of resolveTargets(plan.state, step.objectIds)) {
    if (o.kind === 'card') {
      if (looseLeft <= 0) continue;
      looseLeft--;
      if (flipsOver(step.mode, o.faceUp, random)) plan.emit({ type: 'FlipCard', id: o.id });
    } else if (o.kind === 'deck' && o.cards.length > 0) {
      if (count === undefined) {
        // A deck/pile is turned over as a whole when its top side isn't the requested one.
        if (flipsOver(step.mode, topFaceUp(o), random)) plan.emit({ type: 'FlipDeck', id: o.id });
      } else {
        // Only its top cards: each is turned over where it lies, so the order stays.
        for (const c of o.cards.slice(0, count)) {
          if (flipsOver(step.mode, c.faceUp === true, random)) plan.emit({ type: 'FlipDeckCard', deckId: o.id, cardId: c.id });
        }
      }
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

function planTimer(plan: Plan, step: TimerStep, now: number): void {
  for (const o of resolveTargets(plan.state, step.objectIds)) {
    if (o.kind !== 'timer') continue;
    const running = o.startedAt !== undefined;
    const finished = timerFinished(o, now);
    const start = () => plan.emit({ type: 'StartTimer', id: o.id, at: now });
    const reset = () => plan.emit({ type: 'ResetTimer', id: o.id });
    switch (step.mode) {
      case 'start':
        // A countdown that ran out starts over; a running one keeps going.
        if (finished) {
          reset();
          start();
        } else if (!running) start();
        break;
      case 'pause':
        if (running) plan.emit({ type: 'PauseTimer', id: o.id, at: now });
        break;
      case 'toggle':
        if (finished) {
          reset();
          start();
        } else if (running) plan.emit({ type: 'PauseTimer', id: o.id, at: now });
        else start();
        break;
      case 'reset':
        reset();
        break;
      case 'restart':
        reset();
        start();
        break;
    }
  }
}

function planStep(plan: Plan, step: ButtonStep, random: RandomSource, now: number): void {
  switch (step.type) {
    case 'move':
      return planMove(plan, step);
    case 'pick':
      return planPick(plan, step);
    case 'recall':
      return planRecall(plan, step, random);
    case 'rotate':
      return planRotate(plan, step);
    case 'flip':
      return planFlip(plan, step, random);
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
    case 'timer':
      return planTimer(plan, step, now);
  }
}

/**
 * The command that runs a button's steps in order, or null when nothing would change. Randomness, the time
 * (`now`, for timers) and new object ids are decided here, so the returned command replays deterministically.
 * Pick steps chosen at run time use the cards in `picks`; holders without a choice are skipped.
 */
export function planButton(
  state: TableState,
  button: ButtonObject,
  random: RandomSource = secureRandomSource,
  now: number = Date.now(),
  picks: PickChoices = {},
): Command | null {
  const plan = new Plan(state, picks);
  for (const step of button.steps) planStep(plan, step, random, now);
  return finishPlan(plan, state);
}

function finishPlan(plan: Plan, state: TableState): Command | null {
  if (plan.state === state || plan.commands.length === 0) return null;
  return { type: 'Batch', commands: plan.commands };
}

export type ButtonRun = { done: true; command: Command | null } | { done: false; pick: PendingPick };

/**
 * Like `planButton`, but stops at the first Pick step holder without a choice in `picks` and returns it, so the
 * player can choose. Plan again with the choice added (and the same random source seed and `now`) to go on.
 */
export function planButtonRun(state: TableState, button: ButtonObject, random: RandomSource, now: number, picks: PickChoices): ButtonRun {
  const plan = new Plan(state, picks, true);
  try {
    for (const step of button.steps) planStep(plan, step, random, now);
  } catch (e) {
    if (e instanceof PickNeeded) return { done: false, pick: e.pick };
    throw e;
  }
  return { done: true, command: finishPlan(plan, state) };
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
      if (step.targetIds.length > 1) return n === undefined ? `Move ${what} to ${to} in turn` : `Move ${subject} to each of ${to}`;
      return `Move ${subject} to ${to}`;
    }
    case 'recall': {
      const extras = [
        step.orientation === 'faceUp' ? 'face up' : step.orientation === 'keep' ? 'keeping card sides' : '',
        step.shuffle ? 'shuffled' : '',
        step.rotation === 'keep' ? 'keeping card rotation' : '',
      ].filter(Boolean);
      return `Recall ${what}${extras.length ? ` (${extras.join(', ')})` : ''}`;
    }
    case 'rotate': {
      // A holder stands for its cards, so a step on one holder reads "the cards in …".
      const only = step.objectIds.length === 1 ? state.objects.find((x) => x.id === step.objectIds[0]) : undefined;
      const subject = only && isHolder(only) ? `the cards in ${what}` : what;
      return step.mode === 'by' ? `Rotate ${subject} by ${step.degrees}°` : `Rotate ${subject} to ${step.degrees}°`;
    }
    case 'flip': {
      const side = { toggle: '', faceUp: ' face up', faceDown: ' face down', random: ' at random' }[step.mode];
      const n = step.count;
      return `Flip ${n === undefined ? what : `first ${n} card${n === 1 ? '' : 's'} of ${what}`}${side}`;
    }
    case 'shuffle':
      return `Shuffle ${what}`;
    case 'sort':
      return step.by === 'reverse' ? `Reverse the order of ${what}` : `Sort ${what} by ${step.by === 'name' ? 'name' : 'original order'}`;
    case 'pick': {
      const to = step.targetIds.length ? describeObjects(state, step.targetIds) : 'next to the holder';
      const side = { keep: '', faceUp: ' face up', faceDown: ' face down' }[step.orientation];
      const inTurn = step.targetIds.length > 1 ? ' in turn' : '';
      if (!picksInEdit(step)) return `Pick cards from ${what} to ${to}${inTurn}${side}`;
      const n = step.objectIds.reduce((sum, id) => sum + (step.cards?.[id]?.length ?? 0), 0);
      return `Pick ${n} chosen card${n === 1 ? '' : 's'} from ${what} to ${to}${inTurn}${side}`;
    }
    case 'roll':
      return `Roll ${what}`;
    case 'counter':
      return step.mode === 'add' ? `Change ${what} by ${step.amount}` : `Set ${what} to ${step.amount}`;
    case 'check':
      return step.mode === 'toggle' ? `Toggle ${what}` : step.mode === 'check' ? `Check ${what}` : `Uncheck ${what}`;
    case 'timer':
      return `${TIMER_STEP_VERBS[step.mode]} ${what}`;
  }
}

const TIMER_STEP_VERBS: Record<TimerStep['mode'], string> = {
  start: 'Start',
  pause: 'Pause',
  toggle: 'Start or pause',
  reset: 'Reset',
  restart: 'Restart',
};
