// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useTableShortcuts } from '../features/table/tableCommands';
import { viewportCenterWorld } from '../canvas/actions';
import { readClipboard } from '../persistence/clipboard';
import type { DeckObject, Mode, TabletopObject } from '../domain/types';
import { useTableStore } from '../state/tableStore';
import { fixtureGame, tableOf } from './fixtures';

const s = () => useTableStore.getState();
const objects = () => s().history.present.objects;
const get = <T extends TabletopObject = TabletopObject>(id: string) => objects().find((o) => o.id === id) as T;
const ofKind = <T extends TabletopObject>(kind: T['kind']) => objects().find((o) => o.kind === kind) as T;
const deck = () => objects().find((o): o is DeckObject => o.kind === 'deck' && o.name === 'Deck')!;

function press(key: string, opts: KeyboardEventInit = {}, target: EventTarget = window) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(e);
  return e;
}

let onHelp: ReturnType<typeof vi.fn<() => void>>;

function load(mode: Mode) {
  const g = fixtureGame();
  s().load({ id: g.id, title: g.title, createdAt: g.createdAt }, tableOf(g), g.camera);
  s().setMode(mode);
  s().setViewport({ width: 1000, height: 800 });
}

beforeEach(() => {
  s().unload();
  s().setUi({ inspectorOpen: false, uiHidden: false, cameraLocked: false, palettePinned: false, snapToGrid: false, gridSize: 50 });
  onHelp = vi.fn<() => void>();
  renderHook(() => useTableShortcuts(onHelp));
});
afterEach(cleanup);

describe('keyboard shortcuts', () => {
  it('switch tools with V / H / P / M / E / T; Esc goes back to Select', () => {
    load('play');
    for (const [key, tool] of [
      ['h', 'pan'],
      ['p', 'pen'],
      ['m', 'stamp'],
      ['e', 'eraser'],
      ['t', 'text'],
      ['v', 'select'],
      ['P', 'pen'],
    ] as const)
      expect((press(key), s().tool)).toBe(tool);
    press('Escape');
    expect(s().tool).toBe('select');
  });

  it('flip, shuffle, roll and rotate the selected object', () => {
    load('play');
    const card = ofKind('card');
    s().select(card.id);
    const up = get<TabletopObject & { faceUp: boolean }>(card.id).faceUp;
    press('f');
    expect(get<TabletopObject & { faceUp: boolean }>(card.id).faceUp).toBe(!up);
    press('r');
    expect(get(card.id).rotation).toBe(90);
    press('R', { shiftKey: true });
    expect(get(card.id).rotation).toBe(0);
    s().select(deck().id);
    press('f');
    expect(deck().cards.map((c) => c.name)).toEqual(['C5', 'C4', 'C3', 'C2', 'C1']);
    press('s');
    expect(s().shuffled?.ids).toEqual([deck().id]);
    // Holders are fixed in Play mode: R doesn't turn them.
    press('r');
    expect(deck().rotation).toBe(0);
    const die = ofKind<TabletopObject & { rollCount: number }>('die');
    s().select(die.id);
    press('r');
    expect(get<TabletopObject & { rollCount: number }>(die.id).rollCount).toBe(die.rollCount + 1);
  });

  it('undo / redo with Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y', () => {
    load('play');
    const card = ofKind('card');
    s().select(card.id);
    press('f');
    expect(s().history.past).toHaveLength(1);
    press('z', { ctrlKey: true });
    expect(s().history.past).toHaveLength(0);
    press('Z', { ctrlKey: true, shiftKey: true });
    expect(s().history.past).toHaveLength(1);
    press('z', { metaKey: true });
    press('y', { ctrlKey: true });
    expect(s().history.past).toHaveLength(1);
  });

  it('Edit mode: L locks, arrows nudge (Shift = 10), Ctrl+D duplicates, Delete removes, Ctrl+A selects all', () => {
    load('edit');
    const label = ofKind('label');
    s().select(label.id);
    const at = label.position;
    press('ArrowRight');
    press('ArrowDown', { shiftKey: true });
    expect(get(label.id).position).toEqual({ x: at.x + 1, y: at.y + 10 });
    // Rapid nudges are one undo step.
    expect(s().history.past).toHaveLength(1);
    press('l');
    expect(get(label.id).locked).toBe(true);
    press('ArrowLeft');
    expect(get(label.id).position.x).toBe(at.x + 1);
    press('l');
    const n = objects().length;
    press('d', { ctrlKey: true });
    expect(objects()).toHaveLength(n + 1);
    press('Delete');
    expect(objects()).toHaveLength(n);
    press('a', { ctrlKey: true });
    expect(s().selectedIds).toHaveLength(n);
    // With several selected: arrows move, L locks them all, Backspace deletes them all.
    const two = objects()
      .filter((o) => o.kind === 'die' || o.kind === 'counter')
      .map((o) => o.id);
    s().setSelection(two);
    const before = two.map((id) => get(id).position.y);
    press('ArrowUp');
    expect(two.map((id) => get(id).position.y)).toEqual(before.map((y) => y - 1));
    press('l');
    expect(two.every((id) => get(id).locked)).toBe(true);
    press('l');
    press('Backspace');
    expect(two.map(get).filter(Boolean)).toEqual([]);
  });

  it('Edit mode: G toggles snap to grid; arrows then move by one grid step onto the grid', () => {
    load('edit');
    press('g');
    expect(s().ui.snapToGrid).toBe(true);
    s().setUi({ gridSize: 25 });
    const label = ofKind('label');
    s().dispatch({ type: 'MoveObject', id: label.id, position: { x: 103, y: 47 } });
    s().select(label.id);
    press('ArrowRight');
    expect(get(label.id).position).toEqual({ x: 125, y: 50 });
    press('g');
    expect(s().ui.snapToGrid).toBe(false);
    // Play mode has no grid.
    s().setMode('play');
    press('g');
    expect(s().ui.snapToGrid).toBe(false);
  });

  it('Edit mode: Ctrl+C copies the selection, Ctrl+V pastes it (also into another game) in the middle of the view', async () => {
    load('edit');
    const label = ofKind<TabletopObject & { text: string }>('label');
    s().dispatch({ type: 'UpdateObject', id: label.id, patch: { text: 'Copied note' } });
    s().select(label.id);
    press('c', { ctrlKey: true });
    await vi.waitFor(async () => expect((await readClipboard())?.objects[0].id).toBe(label.id));

    // Another game: the copy arrives with a new id, selected, centred in the view, as one undo step.
    load('edit');
    const n = objects().length;
    press('v', { ctrlKey: true });
    await vi.waitFor(() => expect(objects()).toHaveLength(n + 1));
    const pasted = get<TabletopObject & { text: string }>(s().selectedId!);
    expect(pasted).toMatchObject({ kind: 'label', text: 'Copied note' });
    expect(pasted.id).not.toBe(label.id);
    const view = viewportCenterWorld();
    expect(Math.abs(pasted.position.x + pasted.width / 2 - view.x)).toBeLessThanOrEqual(1);
    expect(s().history.past).toHaveLength(1);
    // Pasting again in the same view puts the next copy a little further on.
    press('v', { ctrlKey: true });
    await vi.waitFor(() => expect(objects()).toHaveLength(n + 2));
    expect(get(s().selectedId!).position.x).toBe(pasted.position.x + 24);

    // Play mode neither copies nor pastes.
    s().setMode('play');
    press('v', { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(objects()).toHaveLength(n + 2);
  });

  it('setup keys do nothing in Play mode', () => {
    load('play');
    const label = ofKind('label');
    s().select(label.id);
    press('l');
    press('Delete');
    press('ArrowRight');
    press('d', { ctrlKey: true });
    press('i');
    expect(get(label.id)).toMatchObject({ locked: false, position: label.position });
    expect(s().history.past).toHaveLength(0);
    expect(s().ui.inspectorOpen).toBe(false);
  });

  it('panels, camera and help: I, A, U, C, ?, + / - / 0, Shift+F, Space', () => {
    load('edit');
    press('i');
    expect(s().ui.inspectorOpen).toBe(true);
    press('a');
    expect(s().paletteOpen).toBe(true);
    press('Escape');
    expect(s().paletteOpen).toBe(false);
    press('u');
    expect(s().ui.uiHidden).toBe(true);
    press('u');
    press('c');
    expect(s().ui.cameraLocked).toBe(true);
    press('c');
    press('?');
    expect(onHelp).toHaveBeenCalledTimes(1);
    const scale = s().camera.scale;
    press('+');
    expect(s().camera.scale).toBeGreaterThan(scale);
    press('-');
    press('-');
    expect(s().camera.scale).toBeLessThan(scale);
    press('0');
    expect(s().camera.scale).toBe(1);
    press('F', { shiftKey: true });
    expect(s().camera.scale).not.toBe(1);
    press(' ');
    expect(s().spaceHeld).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    expect(s().spaceHeld).toBe(false);
  });

  it('Esc closes the menu, then deselects, then closes the automations panel', () => {
    load('edit');
    const label = ofKind('label');
    s().select(label.id);
    s().openAutomations('x');
    s().setContextMenu({ objectId: label.id, x: 0, y: 0 });
    press('Escape');
    expect(s().contextMenu).toBeNull();
    expect(s().selectedId).toBe(label.id);
    press('Escape');
    expect(s().selectedId).toBeNull();
    press('Escape');
    expect(s().automationButtonId).toBeNull();
  });

  it('ignores keys typed into fields and while a dialog is open', () => {
    load('play');
    const input = document.createElement('input');
    document.body.append(input);
    press('p', {}, input);
    expect(s().tool).toBe('select');
    input.remove();
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    document.body.append(modal);
    press('p');
    expect(s().tool).toBe('select');
    modal.remove();
    press('p');
    expect(s().tool).toBe('pen');
  });
});
