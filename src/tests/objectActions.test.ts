import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drawFromDeck } from '../canvas/actions';
import { readClipboard } from '../persistence/clipboard';
import {
  DRAW_SIDE_LABELS,
  getGroupActions,
  getObjectActions,
  hasObjectControls,
  PUT_SIDE_LABELS,
  type ObjectAction,
} from '../canvas/objectActions';
import { createObject } from '../domain/objects';
import type { CardObject, DeckObject, Mode, TabletopObject } from '../domain/types';
import { currentTable, useTableStore } from '../state/tableStore';
import { useUiStore } from '../state/uiStore';
import { fixtureGame, tableOf } from './fixtures';

const objects = () => useTableStore.getState().history.present.objects;
const get = <T extends TabletopObject = TabletopObject>(id: string) => objects().find((o) => o.id === id) as T;
const named = <T extends TabletopObject = TabletopObject>(name: string) => objects().find((o) => o.name === name) as T;
const deckCards = () => named<DeckObject>('Deck').cards;
const deckNames = () => deckCards().map((c) => c.name);

function load(mode: Mode, extra: TabletopObject[] = []) {
  const g = fixtureGame();
  g.objects.push(...extra);
  const s = useTableStore.getState();
  s.load({ id: g.id, title: g.title, createdAt: g.createdAt }, tableOf(g), g.camera);
  s.setMode(mode);
  return g;
}

const actionsOf = (id: string, mode: Mode = useTableStore.getState().mode) => getObjectActions(get(id), mode, currentTable());
const ids = (actions: ObjectAction[]) => actions.map((a) => a.id);
function run(id: string, actionId: string, child?: string): void {
  const a = actionsOf(id).find((x) => x.id === actionId);
  if (!a) throw new Error(`no action ${actionId} on ${get(id)?.kind}`);
  (child ? a.children!.find((c) => c.id === child)! : a).run();
}

/** Waits for the open prompt and answers it. */
async function answerPrompt(value: string | null) {
  for (let i = 0; i < 50 && useUiStore.getState().dialog?.kind !== 'prompt'; i++) await Promise.resolve();
  const d = useUiStore.getState().dialog;
  if (d?.kind !== 'prompt') throw new Error('no prompt');
  d.resolve(value);
}

beforeEach(() => {
  useTableStore.getState().unload();
  useUiStore.setState({ dialog: null });
});

describe('holder actions', () => {
  it('Play mode offers game actions only; Edit mode adds the set-up actions', async () => {
    load('play');
    const deck = named('Deck');
    expect(ids(actionsOf(deck.id))).toEqual(['draw', 'shuffle', 'flipdeck', 'draw-top', 'draw-bottom', 'pick-card', 'sort', 'reset']);
    useTableStore.getState().setMode('edit');
    expect(ids(actionsOf(deck.id))).toEqual([
      'draw',
      'shuffle',
      'flipdeck',
      'draw-top',
      'draw-bottom',
      'pick-card',
      'sort',
      'reset',
      'rotate',
      'drawside',
      'putside',
      'layout',
      'lock',
      'playmove',
      'front',
      'back',
      'duplicate',
      'copy',
      'delete',
    ]);
    run(deck.id, 'copy');
    await vi.waitFor(async () => expect((await readClipboard())?.objects.map((o) => o.id)).toEqual([deck.id]));
    // An empty holder without a deck has no card actions.
    expect(ids(actionsOf(named('Holder').id, 'play'))).toEqual([]);
    expect(hasObjectControls(named('Holder'))).toBe(true);
    expect(hasObjectControls(objects().find((o) => o.kind === 'label')!)).toBe(false);
  });

  it('draws, flips, sorts, shuffles and gathers a deck', async () => {
    load('play');
    const id = named('Deck').id;
    run(id, 'draw');
    expect(deckCards()).toHaveLength(4);
    run(id, 'flipdeck');
    expect(deckNames()).toEqual(['C5', 'C4', 'C3', 'C2']);
    run(id, 'sort', 'sort-name');
    expect(deckNames()).toEqual(['C2', 'C3', 'C4', 'C5']);
    run(id, 'sort', 'sort-reverse');
    expect(deckNames()[0]).toBe('C5');
    run(id, 'sort', 'sort-original');
    expect(deckNames()[0]).toBe('C2');
    run(id, 'shuffle');
    expect(useTableStore.getState().shuffled?.ids).toEqual([id]);
    // Draw 2 from the bottom (prompt) → one pile; Gather & reset brings everything back.
    run(id, 'draw-bottom');
    await answerPrompt('2');
    expect(objects().filter((o) => o.kind === 'deck' && o.isPile)).toHaveLength(1);
    // A wrong number draws nothing.
    run(id, 'draw-top');
    await answerPrompt('nope');
    expect(deckCards()).toHaveLength(2);
    run(id, 'reset');
    expect(deckNames()).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
    expect(objects().some((o) => o.kind === 'deck' && o.isPile)).toBe(false);
  });

  it('cycles how cards come out and go in, spreads, and changes Edit-mode settings', () => {
    load('edit');
    const id = named('Deck').id;
    const deck = () => get<TabletopObject & { drawSide: string; putSide?: string; layout?: string; playMovable?: boolean }>(id);
    expect(actionsOf(id).find((a) => a.id === 'drawside')!.label).toBe(DRAW_SIDE_LABELS.faceUp);
    run(id, 'drawside');
    expect(deck().drawSide).toBe('faceDown');
    run(id, 'drawside');
    expect(deck().drawSide).toBe('keep');
    expect(actionsOf(id).find((a) => a.id === 'putside')!.label).toBe(PUT_SIDE_LABELS.keep);
    run(id, 'putside');
    expect(deck().putSide).toBe('faceUp');
    run(id, 'layout');
    expect(deck().layout).toBe('spread');
    expect(actionsOf(id).find((a) => a.id === 'layout')!.label).toBe('Show cards stacked');
    run(id, 'layout');
    expect(deck().layout).toBe('stack');
    run(id, 'playmove');
    expect(deck().playMovable).toBe(true);
    run(id, 'rotate');
    expect(deck().rotation).toBe(90);
    run(id, 'front');
    expect(deck().zIndex).toBe(Math.max(...objects().map((o) => o.zIndex)));
    run(id, 'back');
    expect(deck().zIndex).toBe(Math.min(...objects().map((o) => o.zIndex)));
    run(id, 'lock');
    expect(deck().locked).toBe(true);
    expect(actionsOf(id).find((a) => a.id === 'lock')!.label).toBe('Unlock (allow moving)');
    // A locked holder doesn't turn.
    expect(ids(actionsOf(id))).not.toContain('rotate');
    const before = objects().length;
    run(id, 'duplicate');
    expect(objects()).toHaveLength(before + 1);
    run(id, 'delete');
    expect(get(id)).toBeUndefined();
  });
});

describe('card, token, die, bag and control actions', () => {
  it('a drawn card flips, turns and returns to its holder', () => {
    load('play');
    const deckId = named('Deck').id;
    const cardId = drawFromDeck(deckId)!;
    expect(ids(actionsOf(cardId))).toEqual(['flip', 'rotate', 'return']);
    const faceUp = get<TabletopObject & { faceUp: boolean }>(cardId).faceUp;
    run(cardId, 'flip');
    expect(get<TabletopObject & { faceUp: boolean }>(cardId).faceUp).toBe(!faceUp);
    run(cardId, 'rotate');
    expect(get(cardId).rotation).toBe(90);
    run(cardId, 'return');
    expect(get(cardId)).toBeUndefined();
    expect(deckCards()).toHaveLength(5);
  });

  it('a token stack gives tokens (one or several) and gathers them back', async () => {
    const stack = { ...createObject('token', { center: { x: 900, y: 900 }, zIndex: 50 }), name: 'Stack', count: 5 };
    load('play', [stack]);
    expect(ids(actionsOf(stack.id))).toEqual(['take-token', 'take-tokens', 'rotate']);
    run(stack.id, 'take-token');
    run(stack.id, 'take-tokens');
    await answerPrompt('2');
    expect(get<TabletopObject & { count?: number }>(stack.id).count).toBe(2);
    const taken = objects().filter((o) => o.kind === 'token' && o.sourceId === stack.id);
    expect(taken.map((t) => (t as { count?: number }).count ?? 1).sort()).toEqual([1, 2]);
    // A taken token returns on its own; the stack gathers the rest.
    expect(ids(actionsOf(taken[0].id))).toContain('recall-token');
    run(taken[0].id, 'recall-token');
    expect(ids(actionsOf(stack.id))).toContain('recall-tokens');
    run(stack.id, 'recall-tokens');
    expect(get<TabletopObject & { count?: number }>(stack.id).count).toBe(5);
    expect(ids(actionsOf(stack.id))).not.toContain('recall-tokens');
  });

  it('a die rolls and returns to the bag it came from; the bag draws, shuffles and recalls', async () => {
    load('play');
    const die = objects().find((o) => o.kind === 'die')!;
    const bag = objects().find((o) => o.kind === 'bag')!;
    const token = objects().find((o) => o.kind === 'token')!;
    expect(ids(actionsOf(bag.id))).toEqual([]);
    const { dispatch } = useTableStore.getState();
    dispatch({ type: 'BagPut', bagId: bag.id, objectId: die.id });
    dispatch({ type: 'BagPut', bagId: bag.id, objectId: token.id });
    expect(ids(actionsOf(bag.id))).toEqual(['draw', 'draw-many', 'shuffle']);
    run(bag.id, 'shuffle');
    run(bag.id, 'draw-many');
    await answerPrompt('2');
    expect(get<TabletopObject & { items: unknown[] }>(bag.id).items).toHaveLength(0);
    expect(ids(actionsOf(die.id))).toEqual(['roll', 'return-bag']);
    const rolls = get<TabletopObject & { rollCount: number }>(die.id).rollCount;
    run(die.id, 'roll');
    expect(get<TabletopObject & { rollCount: number }>(die.id).rollCount).toBe(rolls + 1);
    run(die.id, 'return-bag');
    expect(get(die.id)).toBeUndefined();
    expect(ids(actionsOf(bag.id))).toContain('recall');
    run(bag.id, 'recall');
    expect(get<TabletopObject & { items: unknown[] }>(bag.id).items).toHaveLength(2);
    run(bag.id, 'draw');
    expect(get<TabletopObject & { items: unknown[] }>(bag.id).items).toHaveLength(1);
  });

  it('buttons, checkboxes and timers', () => {
    const button = { ...createObject('button', { center: { x: 0, y: 900 }, zIndex: 60 }), steps: [] };
    const box = createObject('checkbox', { center: { x: 200, y: 900 }, zIndex: 61 });
    const timer = createObject('timer', { center: { x: 400, y: 900 }, zIndex: 62 });
    load('edit', [button, box, timer]);
    expect(ids(actionsOf(button.id)).slice(0, 2)).toEqual(['automations', 'run']);
    run(button.id, 'automations');
    expect(useTableStore.getState().automationButtonId).toBe(button.id);
    useTableStore.getState().setMode('play');
    expect(actionsOf(button.id).map((a) => a.label)).toEqual(['Run']);
    run(box.id, 'check');
    expect(get<TabletopObject & { checked: boolean }>(box.id).checked).toBe(true);
    expect(actionsOf(box.id)[0].label).toBe('Uncheck');
    expect(ids(actionsOf(timer.id))).toEqual(['timer-toggle']);
    run(timer.id, 'timer-toggle');
    expect(get<TabletopObject & { startedAt?: number }>(timer.id).startedAt).toBeDefined();
    expect(ids(actionsOf(timer.id))).toEqual(['timer-toggle', 'timer-reset']);
    run(timer.id, 'timer-reset');
    expect(get<TabletopObject & { startedAt?: number; elapsedMs: number }>(timer.id)).toMatchObject({ elapsedMs: 0 });
  });
});

describe('group actions (Edit mode)', () => {
  it('duplicates, copies, locks / unlocks and deletes a selection', async () => {
    load('edit');
    const picked = objects()
      .filter((o) => o.kind === 'die' || o.kind === 'counter')
      .map((o) => o.id);
    const group = () => getGroupActions(picked, currentTable());
    const act = (id: string) => group().find((a) => a.id === id)!;
    expect(group().map((a) => a.label)).toEqual([
      'Duplicate 2 objects',
      'Copy 2 objects (paste in any game)',
      'Lock all',
      'Delete 2 objects',
      'Align',
      'Roll the die',
    ]);
    const before = objects().length;
    act('duplicate').run();
    expect(objects()).toHaveLength(before + 2);
    act('copy').run();
    await vi.waitFor(async () => expect((await readClipboard())?.objects.map((o) => o.id).sort()).toEqual([...picked].sort()));
    act('lock').run();
    expect(picked.every((id) => get(id).locked)).toBe(true);
    expect(act('lock').label).toBe('Unlock all');
    act('lock').run();
    expect(picked.some((id) => get(id).locked)).toBe(false);
    act('delete').run();
    expect(picked.map(get).filter(Boolean)).toEqual([]);
  });

  it('aligns and distributes a selection (locked objects stay put)', () => {
    const at = (x: number, y: number, name: string): TabletopObject => ({
      ...createObject('token', { center: { x, y }, zIndex: 50 }),
      name,
    });
    const a = at(0, 0, 'A');
    const b = at(300, 80, 'B');
    const c = at(100, 200, 'C');
    load('edit', [a, b, c]);
    const picked = [a.id, b.id, c.id];
    const group = () => getGroupActions(picked, currentTable());
    const child = (id: string, childId: string) =>
      group()
        .find((x) => x.id === id)!
        .children!.find((x) => x.id === childId)!;
    expect(group().map((x) => x.id)).toContain('distribute');

    child('align', 'align-left').run();
    expect(new Set(picked.map((id) => get(id).position.x)).size).toBe(1);
    useTableStore.getState().undo();

    child('distribute', 'distribute-horizontal').run();
    // Sorted by centre: A (x 0), C (x 100), B (x 300); C moves halfway, the outer two stay.
    expect(get(a.id).position.x).toBe(a.position.x);
    expect(get(b.id).position.x).toBe(b.position.x);
    expect(get(c.id).position.x).toBe((a.position.x + b.position.x) / 2);
    useTableStore.getState().undo();

    useTableStore.getState().dispatch({ type: 'ToggleLock', id: b.id });
    child('align', 'align-top').run();
    expect(get(b.id).position.y).toBe(b.position.y);
    expect(get(a.id).position.y).toBe(a.position.y);
    expect(get(c.id).position.y).toBe(a.position.y);
  });
});

describe('group actions (Play mode)', () => {
  it('forms a pile where the anchor lies, flips, returns cards and rolls dice; no set-up actions', () => {
    load('play');
    const deck = named<DeckObject>('Deck');
    const before = deckCards().length;
    const a = drawFromDeck(deck.id, { x: 0, y: 0 })!;
    const b = drawFromDeck(deck.id, { x: 500, y: 0 })!;
    const die = objects().find((o) => o.kind === 'die')!;
    const picked = [a, b, die.id];
    const group = (anchor?: string) => getGroupActions(picked, currentTable(), 'play', anchor);
    expect(ids(group())).toEqual(['form-pile', 'flip', 'return', 'roll']);
    expect(group().every((x) => x.primary)).toBe(true);

    const faceUp = !!get<CardObject>(a).faceUp;
    group()
      .find((x) => x.id === 'flip')!
      .run();
    expect(!!get<CardObject>(a).faceUp).toBe(!faceUp);
    expect(!!get<CardObject>(b).faceUp).toBe(!faceUp);
    useTableStore.getState().undo();

    const past = useTableStore.getState().history.past.length;
    const defs = [get<CardObject>(a).cardDefId, get<CardObject>(b).cardDefId];
    const anchorAt = get(a).position;
    group(a)
      .find((x) => x.id === 'form-pile')!
      .run();
    const pile = objects().find((o): o is DeckObject => o.kind === 'deck' && !!o.isPile)!;
    // The anchor lies at the bottom, the other card (higher up on the table) on top.
    expect(pile.position).toEqual(anchorAt);
    expect(pile.cards.map((c) => c.id)).toEqual([defs[1], defs[0]]);
    expect(objects().some((o) => o.kind === 'card' && picked.includes(o.id))).toBe(false);
    expect(useTableStore.getState().selectedIds).toEqual([pile.id]);
    expect(useTableStore.getState().history.past.length).toBe(past + 1);

    getGroupActions([pile.id, die.id], currentTable(), 'play')
      .find((x) => x.id === 'return')!
      .run();
    expect(deckCards()).toHaveLength(before);
    expect(get(pile.id)).toBeUndefined();
  });

  it('a group with nothing to do in a game has no actions', () => {
    const t1 = createObject('token', { center: { x: 0, y: 0 }, zIndex: 50 });
    const t2 = createObject('token', { center: { x: 300, y: 0 }, zIndex: 51 });
    load('play', [t1, t2]);
    expect(getGroupActions([t1.id, t2.id], currentTable(), 'play')).toEqual([]);
  });
});
