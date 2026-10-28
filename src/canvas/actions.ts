import { fitBounds, NO_INSETS, zoomBy, zoomToCenter, ZOOM_STEP, type Insets } from '../domain/camera';
import { objectBounds, objectCenter, sceneBounds } from '../domain/geometry';
import {
  bagCount,
  createObject,
  dieFaceCount,
  dieFaceLabel,
  displayName,
  hasPlayMovable,
  kindLabel,
  maxZ,
  ownerDeckOf,
  resolveCardLook,
  sortByZ,
  tokenCount,
} from '../domain/objects';
import { applyPick, canPick, describeObjects, planButtonRun, STEP_LABELS } from '../domain/buttons';
import { cardTextColor, standardDeck } from '../domain/cards';
import {
  bagDrawCommand,
  bagOf,
  drawCardCommand,
  drawCardsCommand,
  drawManyFromBagCommand,
  drawPickedCardsCommand,
  flipDeckCardCommand,
  homeDeckOf,
  nextRotation,
  resolveDrop,
  rollDieCommand,
  shuffleBagCommand,
  shuffleDeckCommand,
  splitTokensCommand,
  tokensTakenFrom,
} from '../domain/rules';
import { newId } from '../domain/ids';
import { timerToggleCommand } from '../domain/timer';
import type { Command } from '../domain/commands';
import type { DeckObject, DrawSide, HolderLayout, HoverZoom, ObjectKind, SortBy, TabletopObject, TokenShape, Vec2 } from '../domain/types';
import { currentTable, MULTI_BAR, useTableStore } from '../state/tableStore';
import { pickDialog, pickManyDialog, promptDialog, toast, type PickableItem } from '../state/uiStore';
import { screenToWorld } from '../domain/camera';
import { secureRandomSource, seededSource } from '../domain/random';
import { loadAssetImage } from '../objects/useAssetImage';

/** Gameplay/editing actions shared by the canvas, inspector and keyboard shortcuts. */

function find(id: string): TabletopObject | undefined {
  return currentTable().objects.find((o) => o.id === id);
}

export function dropObject(id: string, position: Vec2, free = false): void {
  const { dispatch, mode } = useTableStore.getState();
  dispatch(resolveDrop(currentTable(), id, { x: Math.round(position.x), y: Math.round(position.y) }, mode, { free }));
}

export function toggleLock(id: string): void {
  useTableStore.getState().dispatch({ type: 'ToggleLock', id });
}

/** Boards, holders and bags: allow or stop moving them in Play mode. */
export function togglePlayMovable(id: string): void {
  const o = find(id);
  if (o && hasPlayMovable(o)) useTableStore.getState().dispatch({ type: 'UpdateObject', id, patch: { playMovable: !o.playMovable } });
}

export function setZOrder(id: string, direction: 'front' | 'back'): void {
  useTableStore.getState().dispatch({ type: 'SetZIndex', id, direction });
}

export function setDieValue(id: string, value: number): void {
  const o = find(id);
  if (o?.kind === 'die')
    useTableStore.getState().dispatch({ type: 'UpdateObject', id, patch: { value: Math.min(dieFaceCount(o), Math.max(1, value)) } });
}

/** Shows every face of a die (images, labels or pips) and turns the clicked one up. */
export async function pickDieFace(id: string): Promise<void> {
  const o = find(id);
  if (o?.kind !== 'die') return;
  const custom = !!o.faces && o.faces.length > 0;
  const items = Array.from({ length: dieFaceCount(o) }, (_, i): PickableItem => {
    const value = i + 1;
    const face = o.faces?.[i];
    return {
      id: String(value),
      name: dieFaceLabel(o, value),
      faceText: custom ? face?.label || String(value) : String(value),
      faceColor: o.color,
      textColor: o.pipColor,
      faceAssetId: face?.assetId,
      shape: 'die',
      ...(!custom && o.sides === 6 ? { pips: value } : {}),
    };
  });
  const picked = await pickDialog({
    title: `Choose the face of ${displayName(o)}`,
    message: 'The face you click is turned up.',
    listLabel: 'Faces',
    items,
    currentId: String(o.value),
  });
  if (picked) setDieValue(id, Number(picked));
}

export function setCounterValue(id: string, value: number): void {
  const o = find(id);
  if (o?.kind === 'counter' && Number.isFinite(value))
    useTableStore.getState().dispatch({ type: 'IncrementCounter', id, delta: value - o.value });
}

const NEXT_DRAW_SIDE: Record<DrawSide, DrawSide> = { keep: 'faceUp', faceUp: 'faceDown', faceDown: 'keep' };

/** Cycles how cards come out of a holder: as they lie → face up → face down. */
export function cycleDrawSide(id: string): void {
  const o = find(id);
  if (o?.kind === 'deck') useTableStore.getState().dispatch({ type: 'UpdateObject', id, patch: { drawSide: NEXT_DRAW_SIDE[o.drawSide] } });
}

/** Cycles how cards lie when put into a holder: as they were → face up → face down. */
export function cyclePutSide(id: string): void {
  const o = find(id);
  if (o?.kind === 'deck')
    useTableStore.getState().dispatch({ type: 'UpdateObject', id, patch: { putSide: NEXT_DRAW_SIDE[o.putSide ?? 'keep'] } });
}

export function flipCard(id: string): void {
  if (find(id)?.kind === 'card') useTableStore.getState().dispatch({ type: 'FlipCard', id });
}

/** Checks or unchecks a checkbox (`checked` missing: toggles it). */
export function toggleCheckbox(id: string, checked?: boolean): void {
  const o = find(id);
  if (o?.kind === 'checkbox') useTableStore.getState().dispatch({ type: 'UpdateObject', id, patch: { checked: checked ?? !o.checked } });
}

/** Starts, pauses or (when a countdown ran out) restarts a timer. */
export function toggleTimer(id: string): void {
  const o = find(id);
  if (o?.kind === 'timer') useTableStore.getState().dispatch(timerToggleCommand(o, Date.now()));
}

export function resetTimer(id: string): void {
  if (find(id)?.kind === 'timer') useTableStore.getState().dispatch({ type: 'ResetTimer', id });
}

export function rotateBy(id: string, degrees: number): void {
  const o = find(id);
  if (!o) return;
  useTableStore.getState().dispatch({
    type: 'TransformObject',
    id,
    position: o.position,
    width: o.width,
    height: o.height,
    rotation: o.rotation + degrees,
  });
}

/** Turns `o` to its next allowed angle (clockwise, or anticlockwise with `dir` -1); see `nextRotation`. */
export function rotateStep(id: string, dir: 1 | -1 = 1): void {
  const o = find(id);
  const next = o ? nextRotation(currentTable(), o, dir) : null;
  if (o && next !== null) rotateBy(id, next - o.rotation);
}

export function rollDie(id: string): void {
  const o = find(id);
  if (o?.kind === 'die') useTableStore.getState().dispatch(rollDieCommand(o));
}

/**
 * Runs a button's steps as one undo step. A Pick step asks the player to choose cards first: the plan stops
 * there, the dialog shows the holder as it is at that point, and the run is planned again with the choice
 * (same random seed and time, so earlier shuffles and rolls stay the same). Cancel stops the whole run.
 */
export async function runButton(id: string): Promise<void> {
  const seed = secureRandomSource();
  const now = Date.now();
  const picks: Record<string, string[]> = {};
  for (;;) {
    const o = find(id);
    if (o?.kind !== 'button') return;
    const run = planButtonRun(currentTable(), o, seededSource(seed), now, picks);
    if (run.done) {
      useTableStore.getState().dispatch(run.command);
      return;
    }
    const { deck, key, step } = run.pick;
    const many = step.targetIds.length > 1;
    const chosen = await pickManyDialog({
      title: `${o.label.trim() || 'Button'}: pick card(s) from ${displayName(deck)}`,
      message: `Top card first. Click the cards you want; they go ${step.targetIds.length ? `to ${describeObjects(currentTable(), step.targetIds)}${many ? ' in turn' : ''}` : 'next to the holder'}.`,
      listLabel: 'Cards',
      items: cardPickItems(deck),
      confirmLabel: 'Take',
    });
    if (!chosen) return;
    picks[key] = chosen;
  }
}

/**
 * Pick mode: adds/removes table objects in the step being edited (its object list or a move step's destinations).
 * A single click on an object the step can't use explains why.
 */
export function pickOnTable(ids: string[], how: 'toggle' | 'add'): void {
  const { picking, dispatch, setPicking } = useTableStore.getState();
  if (!picking) return;
  const button = find(picking.buttonId);
  const step = button?.kind === 'button' ? button.steps.find((st) => st.id === picking.stepId) : undefined;
  if (!button || button.kind !== 'button' || !step) return setPicking(null);
  const objects = currentTable().objects;
  const usable = ids.filter((id) => {
    const o = objects.find((x) => x.id === id);
    return !!o && canPick(step, picking.field, o, button.id);
  });
  if (usable.length === 0) {
    const o = ids.length === 1 ? objects.find((x) => x.id === ids[0]) : undefined;
    if (o && o.id !== button.id) toast(`A ${kindLabel(o).toLowerCase()} can't be used in a “${STEP_LABELS[step.type]}” step.`);
    return;
  }
  const next = applyPick(step, picking.field, usable, how);
  if (next !== step) {
    dispatch(
      { type: 'UpdateObject', id: button.id, patch: { steps: button.steps.map((st) => (st.id === step.id ? next : st)) } },
      { coalesceKey: `pick:${step.id}:${picking.field}` },
    );
  }
}

/** Selects an object (e.g. from an automation step's list) and pans to it when it is off screen. */
export function focusObject(id: string): void {
  const o = find(id);
  const s = useTableStore.getState();
  if (!o) return;
  s.select(id);
  s.setSelectionBar(null);
  s.flashObject(id);
  const b = objectBounds(o);
  const { camera, viewport } = s;
  // The right-hand drawer covers part of the table.
  const visibleWidth = Math.max(200, viewport.width - 330);
  const left = b.x * camera.scale + camera.x;
  const top = b.y * camera.scale + camera.y;
  const inView = left >= 0 && top >= 0 && left + b.width * camera.scale <= visibleWidth && top + b.height * camera.scale <= viewport.height;
  if (inView) return;
  const c = objectCenter(o);
  s.setCamera({ ...camera, x: visibleWidth / 2 - c.x * camera.scale, y: viewport.height / 2 - c.y * camera.scale });
}

export function drawFromDeck(id: string, position?: Vec2): string | null {
  const o = find(id);
  if (o?.kind !== 'deck') return null;
  const cmd = drawCardCommand(o, position);
  if (!cmd || cmd.type !== 'DrawCard') return null;
  useTableStore.getState().dispatch(cmd);
  return cmd.cardId;
}

export function shuffleDeck(id: string): void {
  const o = find(id);
  if (o?.kind === 'deck') useTableStore.getState().dispatch(shuffleDeckCommand(o));
}

export function drawCardsFromDeck(id: string, count: number, from: 'top' | 'bottom'): void {
  const o = find(id);
  if (o?.kind !== 'deck') return;
  const cmd = drawCardsCommand(o, count, from);
  if (cmd) useTableStore.getState().dispatch(cmd);
}

/** Asks how many cards to draw, then draws them from the top or bottom of the deck. */
export async function promptDrawCards(id: string, from: 'top' | 'bottom'): Promise<void> {
  const o = find(id);
  if (o?.kind !== 'deck' || o.cards.length === 0) return;
  const v = await promptDialog({
    title: `Draw cards from the ${from}`,
    label: `Number of cards (1-${o.cards.length})`,
    defaultValue: '1',
  });
  const n = v === null ? NaN : Number(v.trim());
  if (Number.isInteger(n) && n > 0) drawCardsFromDeck(id, n, from);
}

export function flipDeck(id: string): void {
  if (find(id)?.kind === 'deck') useTableStore.getState().dispatch({ type: 'FlipDeck', id });
}

/** A holder's / pile's cards as picker items (fronts and backs). */
export function cardPickItems(deck: DeckObject): PickableItem[] {
  const objects = currentTable().objects;
  return deck.cards.map((c) => {
    const look = resolveCardLook(c, deck, ownerDeckOf(objects, c.id));
    return {
      id: c.id,
      name: c.name,
      faceText: c.faceText,
      faceColor: c.faceColor,
      faceAssetId: c.faceAssetId,
      textColor: cardTextColor(c.faceText),
      backColor: look.backColor,
      backAssetId: look.backAssetId,
    };
  });
}

/** Shows every card of a holder/pile (top card first) and draws the chosen ones next to it (several as one pile). */
export async function pickCardsFromDeck(id: string): Promise<void> {
  const o = find(id);
  if (o?.kind !== 'deck' || o.cards.length === 0) return;
  const cardIds = await pickManyDialog({
    title: `Pick card(s) from ${displayName(o)}`,
    message: 'Top card first. Click the cards you want; they are placed next to the holder (several as one pile).',
    listLabel: 'Cards',
    items: cardPickItems(o),
    confirmLabel: 'Take',
  });
  // Look the holder up again: it may have changed while the dialog was open.
  const now = cardIds ? find(id) : undefined;
  const cmd = now?.kind === 'deck' && cardIds ? drawPickedCardsCommand(now, cardIds) : null;
  if (cmd) useTableStore.getState().dispatch(cmd);
}

export function sortDeck(id: string, by: SortBy): void {
  if (find(id)?.kind === 'deck') useTableStore.getState().dispatch({ type: 'SortDeck', id, by });
}

/** Takes `count` tokens off a token stack and puts them next to it. */
export function takeTokens(id: string, count = 1): void {
  const o = find(id);
  const cmd = o?.kind === 'token' ? splitTokensCommand(o, count) : null;
  if (cmd) useTableStore.getState().dispatch(cmd);
}

/** Asks how many tokens to take off a stack, then puts them next to it as a new stack. */
export async function promptTakeTokens(id: string): Promise<void> {
  const o = find(id);
  if (o?.kind !== 'token' || tokenCount(o) < 2) return;
  const v = await promptDialog({
    title: 'Take tokens',
    label: `Number of tokens (1-${tokenCount(o) - 1})`,
    defaultValue: '1',
  });
  const n = v === null ? NaN : Number(v.trim());
  if (Number.isInteger(n) && n > 0) takeTokens(id, n);
}

/** Turns over the top card of a holder/pile, or the card at `index` in a spread, without taking it out. */
export function flipDeckCard(id: string, index = 0): void {
  const o = find(id);
  const cmd = o?.kind === 'deck' ? flipDeckCardCommand(o, index) : null;
  if (cmd) useTableStore.getState().dispatch(cmd);
}

export function setHolderLayout(id: string, layout: HolderLayout): void {
  if (find(id)?.kind === 'deck') useTableStore.getState().dispatch({ type: 'UpdateObject', id, patch: { layout } });
}

export function resetDeck(id: string): void {
  useTableStore.getState().dispatch({ type: 'ResetDeck', deckId: id });
}

export function returnCardToDeck(cardId: string): void {
  const card = find(cardId);
  if (card?.kind !== 'card') return;
  const home = homeDeckOf(currentTable(), card);
  if (home) useTableStore.getState().dispatch({ type: 'AddCardToDeck', cardId, deckId: home.id });
}

/** Sends every card of a pile back to the holder that owns it. */
export function returnPileToHolders(id: string): void {
  if (find(id)?.kind === 'deck') useTableStore.getState().dispatch({ type: 'ReturnPile', id });
}

/**
 * Puts a token back on the stack it was taken off. A stack that tokens were taken off gathers all of them
 * back (the same as the Recall step in automations).
 */
export function recallTokens(id: string): void {
  const table = currentTable();
  const o = find(id);
  if (o?.kind !== 'token') return;
  const taken = tokensTakenFrom(table, o);
  const commands: Command[] = (taken.length ? taken : [o]).map((t) => ({ type: 'RecallToken', id: t.id }));
  useTableStore.getState().dispatch(commands.length === 1 ? commands[0] : { type: 'Batch', commands });
}

/** Puts an object that came from a bag back into it. */
export function returnToBag(id: string): void {
  const o = find(id);
  const bag = o ? bagOf(currentTable(), o) : undefined;
  if (o && bag) useTableStore.getState().dispatch({ type: 'BagPut', bagId: bag.id, objectId: o.id });
}

/** Puts everything that came from a bag back into it. */
export function recallToBag(id: string): void {
  if (find(id)?.kind === 'bag') useTableStore.getState().dispatch({ type: 'RecallToBag', bagId: id });
}

export function shuffleBag(id: string): void {
  const o = find(id);
  if (o?.kind === 'bag') useTableStore.getState().dispatch(shuffleBagCommand(o));
}

/** Draws `count` random pieces out of a bag and puts them next to it. */
export function drawFromBag(id: string, count = 1): void {
  const o = find(id);
  const cmd = o?.kind === 'bag' ? drawManyFromBagCommand(currentTable(), o, count) : null;
  if (cmd) useTableStore.getState().dispatch(cmd);
}

/** Asks how many pieces to draw from a bag. */
export async function promptDrawFromBag(id: string): Promise<void> {
  const o = find(id);
  if (o?.kind !== 'bag' || o.items.length === 0) return;
  const total = bagCount(o);
  const v = await promptDialog({ title: 'Draw from the bag', label: `Number of pieces (1-${total})`, defaultValue: '1' });
  const n = v === null ? NaN : Number(v.trim());
  if (Number.isInteger(n) && n > 0) drawFromBag(id, Math.min(n, total));
}

/** Takes one specific entry out of a bag (Edit-mode inspector list); a token stack gives up one token. */
export function takeFromBag(id: string, itemId: string): void {
  const o = find(id);
  const index = o?.kind === 'bag' ? o.items.findIndex((i) => i.id === itemId) : -1;
  const cmd = o?.kind === 'bag' && index >= 0 ? bagDrawCommand(o, index) : null;
  if (cmd) useTableStore.getState().dispatch(cmd);
}

export function incrementCounter(id: string, direction: 1 | -1): void {
  const o = find(id);
  if (o?.kind === 'counter') useTableStore.getState().dispatch({ type: 'IncrementCounter', id, delta: o.step * direction });
}

export function deleteObject(id: string): void {
  useTableStore.getState().dispatch({ type: 'DeleteObject', id });
}

/** Deletes every given object as one undo step. */
export function deleteObjects(ids: string[]): void {
  const { dispatch, select } = useTableStore.getState();
  if (ids.length === 0) return;
  if (dispatch({ type: 'Batch', commands: ids.map((id) => ({ type: 'DeleteObject', id }) as Command) })) select(null);
}

/** Locks every object, or unlocks them all when they are all locked already. */
export function toggleLockMany(ids: string[]): void {
  const objs = currentTable().objects.filter((o) => ids.includes(o.id));
  const locked = !objs.every((o) => o.locked);
  useTableStore.getState().dispatch({
    type: 'Batch',
    commands: objs.filter((o) => o.locked !== locked).map((o) => ({ type: 'ToggleLock', id: o.id }) as Command),
  });
}

export function nudgeObjects(ids: string[], dx: number, dy: number): void {
  const objs = currentTable().objects.filter((o) => ids.includes(o.id) && !o.locked);
  if (objs.length === 0) return;
  useTableStore.getState().dispatch(
    {
      type: 'Batch',
      commands: objs.map((o) => ({ type: 'MoveObject', id: o.id, position: { x: o.position.x + dx, y: o.position.y + dy } }) as Command),
    },
    { coalesceKey: `nudge:${objs.map((o) => o.id).join()}` },
  );
}

export function selectAll(): void {
  const { mode, setSelection, setSelectionBar } = useTableStore.getState();
  if (mode !== 'edit') return;
  const ids = sortByZ(currentTable().objects).map((o) => o.id);
  setSelection(ids);
  setSelectionBar(ids.length > 1 ? MULTI_BAR : (ids[0] ?? null));
}

export function setHoverZoom(id: string, hoverZoom: HoverZoom | undefined): void {
  useTableStore.getState().dispatch({ type: 'UpdateObject', id, patch: { hoverZoom } });
}

/** Whether the hover preview turns with the object (`undefined` = no own setting). */
export function setHoverRotate(id: string, hoverRotate: boolean | undefined): void {
  useTableStore.getState().dispatch({ type: 'UpdateObject', id, patch: { hoverRotate } });
}

export function duplicateObject(id: string): void {
  duplicateObjects([id]);
}

/** Duplicates objects (keeping their stacking order) as one undo step, then selects the copies. */
export function duplicateObjects(ids: string[]): void {
  const objects = currentTable().objects;
  const originals = sortByZ(objects.filter((o) => ids.includes(o.id)));
  if (originals.length === 0) return;
  let z = maxZ(objects);
  const copies = originals.map((o) => {
    const copy = {
      ...structuredClone(o),
      id: newId(),
      position: { x: o.position.x + 24, y: o.position.y + 24 },
      zIndex: ++z,
      bagId: undefined,
    };
    if (copy.kind === 'token') copy.sourceId = undefined;
    if (copy.kind === 'deck') {
      copy.cards = copy.cards.map((c) => ({ ...c, id: newId() }));
      copy.initialCards = copy.cards.map((c) => ({ ...c }));
    }
    if (copy.kind === 'bag') {
      // Entries keep their identity only in the original bag: the copy gets its own.
      copy.items = copy.items.map((i) => ({ ...i, id: newId(), bagId: copy.id }));
    }
    return copy;
  });
  const { dispatch, setSelection, setSelectionBar } = useTableStore.getState();
  if (dispatch({ type: 'Batch', commands: copies.map((object) => ({ type: 'AddObject', object }) as Command) })) {
    setSelection(copies.map((c) => c.id));
    setSelectionBar(copies.length > 1 ? MULTI_BAR : copies[0].id);
  }
}

/** World point at the centre of the visible viewport. */
export function viewportCenterWorld(): Vec2 {
  const { camera, viewport } = useTableStore.getState();
  return screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
}

/**
 * Adds an object at the centre of the view, or centred on `center` (world point, e.g. where a palette tile was
 * dropped). `withCards` fills a holder with a standard 52-card deck.
 */
export async function addObject(
  kind: ObjectKind,
  opts: { assetId?: string; withCards?: boolean; center?: Vec2; tokenShape?: TokenShape } = {},
): Promise<string> {
  const { dispatch, select } = useTableStore.getState();
  const center = opts.center ?? viewportCenterWorld();
  const obj = createObject(kind, { center, zIndex: maxZ(currentTable().objects) + 1 });
  if (obj.kind === 'deck' && opts.withCards) {
    obj.cards = standardDeck();
    obj.initialCards = [...obj.cards];
    obj.name = 'Deck';
  }
  if (obj.kind === 'token' && opts.tokenShape) {
    obj.shape = opts.tokenShape;
    obj.name = opts.tokenShape[0].toUpperCase() + opts.tokenShape.slice(1);
  }
  if (opts.assetId && (obj.kind === 'board' || obj.kind === 'image' || obj.kind === 'token')) {
    obj.assetId = opts.assetId;
    if (obj.kind !== 'token') {
      try {
        const img = await loadAssetImage(opts.assetId);
        const maxW = 2000;
        const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
        obj.width = Math.round(img.naturalWidth * scale);
        obj.height = Math.round(img.naturalHeight * scale);
        obj.position = { x: Math.round(center.x - obj.width / 2), y: Math.round(center.y - obj.height / 2) };
      } catch {
        // keep default size
      }
    }
  }
  if (kind === 'board') {
    // Boards go underneath everything else.
    obj.zIndex = Math.min(0, ...currentTable().objects.map((o) => o.zIndex)) - 1;
  }
  // Objects without a default name (bags) stay unnamed.
  if (kind === 'board' || obj.name) obj.name = uniqueName(kind === 'board' ? 'Board' : obj.name);
  dispatch({ type: 'AddObject', object: obj });
  select(obj.id);
  return obj.id;
}

function uniqueName(base: string): string {
  const names = new Set(currentTable().objects.map((o) => o.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function zoomIn(): void {
  const { camera, viewport, setCamera } = useTableStore.getState();
  setCamera(zoomBy(camera, { x: viewport.width / 2, y: viewport.height / 2 }, ZOOM_STEP));
}

export function zoomOut(): void {
  const { camera, viewport, setCamera } = useTableStore.getState();
  setCamera(zoomBy(camera, { x: viewport.width / 2, y: viewport.height / 2 }, 1 / ZOOM_STEP));
}

export function zoomReset(): void {
  const { camera, viewport, setCamera } = useTableStore.getState();
  setCamera(zoomToCenter(camera, viewport, 1));
}

/** Screen space covered by the floating top bar and tool column (measured), so fitting keeps the scene clear of them. */
function hudInsets(): Insets {
  const host = document.querySelector('.canvas-container')?.getBoundingClientRect();
  if (!host) return NO_INSETS;
  const top = document.querySelector('.hud-top')?.getBoundingClientRect();
  const tools = document.querySelector('.hud-tools')?.getBoundingClientRect();
  return {
    top: top ? Math.max(0, top.bottom - host.top) : 0,
    left: tools ? Math.max(0, tools.right - host.left) : 0,
    right: 0,
    bottom: 0,
  };
}

export function fitToScene(): void {
  const { viewport, setCamera, history } = useTableStore.getState();
  const bounds = sceneBounds(history.present.objects, history.present.annotations);
  // Less padding on phones, where every pixel counts.
  const padding = Math.min(48, Math.round(Math.min(viewport.width, viewport.height) * 0.06));
  setCamera(fitBounds(bounds, viewport, padding, hudInsets()));
}
