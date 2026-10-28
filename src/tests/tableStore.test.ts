import { beforeEach, describe, expect, it } from 'vitest';
import { duplicateObjects } from '../canvas/actions';
import { shuffledBy, useTableStore } from '../state/tableStore';
import { fixtureGame, tableOf } from './fixtures';

function load() {
  const t = fixtureGame();
  useTableStore.getState().load({ id: t.id, title: t.title, createdAt: t.createdAt }, tableOf(t), t.camera);
  return t;
}

describe('table store', () => {
  beforeEach(() => useTableStore.getState().unload());

  it('records undoable commands and bumps the revision', () => {
    const t = load();
    const card = t.objects.find((o) => o.kind === 'card')!;
    const s = useTableStore.getState();
    expect(s.dispatch({ type: 'FlipCard', id: card.id })).toBe(true);
    expect(useTableStore.getState().revision).toBe(1);
    expect(useTableStore.getState().history.past).toHaveLength(1);
    expect(s.dispatch({ type: 'DeleteObject', id: 'missing' })).toBe(false);
    expect(useTableStore.getState().revision).toBe(1);
    useTableStore.getState().undo();
    expect(useTableStore.getState().history.future).toHaveLength(1);
  });

  it('notes which holders a shuffle went through (also inside a batch), for the shuffle animation', () => {
    const t = load();
    const deck = t.objects.find((o) => o.kind === 'deck' && o.name === 'Deck')!;
    const s = useTableStore.getState();
    expect(s.shuffled).toBeNull();
    s.dispatch({ type: 'Batch', commands: [{ type: 'ShuffleDeck', id: deck.id, order: [4, 3, 2, 1, 0] }] });
    expect(useTableStore.getState().shuffled).toEqual({ ids: [deck.id], seq: 1 });
    s.dispatch({ type: 'ShuffleDeck', id: deck.id, order: [1, 0, 2, 3, 4] });
    expect(useTableStore.getState().shuffled?.seq).toBe(2);
    expect(shuffledBy({ type: 'FlipDeck', id: deck.id })).toEqual([]);
  });

  it('coalesces rapid edits with the same key into one undo step', () => {
    const t = load();
    const label = t.objects.find((o) => o.kind === 'label')!;
    const { dispatch } = useTableStore.getState();
    dispatch({ type: 'UpdateObject', id: label.id, patch: { color: '#111111' } }, { coalesceKey: 'c' });
    dispatch({ type: 'UpdateObject', id: label.id, patch: { color: '#222222' } }, { coalesceKey: 'c' });
    dispatch({ type: 'UpdateObject', id: label.id, patch: { color: '#333333' } }, { coalesceKey: 'c' });
    expect(useTableStore.getState().history.past).toHaveLength(1);
    useTableStore.getState().undo();
    expect((useTableStore.getState().history.present.objects.find((o) => o.id === label.id) as { color: string }).color).toBe('#1f2328');
  });

  it('clears selection when the selected object disappears', () => {
    const t = load();
    const card = t.objects.find((o) => o.kind === 'card')!;
    const s = useTableStore.getState();
    s.select(card.id);
    s.dispatch({ type: 'DeleteObject', id: card.id });
    expect(useTableStore.getState().selectedId).toBeNull();
  });

  it('camera changes are not part of undo history', () => {
    load();
    useTableStore.getState().setCamera({ x: 10, y: 10, scale: 2 });
    expect(useTableStore.getState().history.past).toHaveLength(0);
    expect(useTableStore.getState().cameraRevision).toBe(1);
  });

  it('multi-selection: toggle, prune on delete, cleared when entering Play mode', () => {
    const t = load();
    const [a, b, c] = t.objects.filter((o) => o.kind !== 'board');
    const s = useTableStore.getState();
    s.setMode('edit');
    s.select(a.id);
    s.toggleSelected(b.id);
    s.toggleSelected(c.id);
    expect(useTableStore.getState()).toMatchObject({ selectedIds: [a.id, b.id, c.id], selectedId: c.id });
    s.toggleSelected(c.id);
    expect(useTableStore.getState()).toMatchObject({ selectedIds: [a.id, b.id], selectedId: b.id });
    s.dispatch({ type: 'DeleteObject', id: b.id });
    expect(useTableStore.getState()).toMatchObject({ selectedIds: [a.id], selectedId: a.id });
    s.setSelection([a.id, c.id]);
    s.setMode('play');
    expect(useTableStore.getState()).toMatchObject({ selectedIds: [], selectedId: null });
  });

  it('duplicates every selected object in one undo step and selects the copies', () => {
    const t = load();
    const ids = t.objects
      .filter((o) => o.kind === 'token' || o.kind === 'die' || (o.kind === 'deck' && o.name === 'Deck'))
      .map((o) => o.id);
    useTableStore.getState().setMode('edit');
    useTableStore.getState().setSelection(ids);
    duplicateObjects(ids);
    const s = useTableStore.getState();
    expect(s.history.present.objects).toHaveLength(t.objects.length + 3);
    expect(s.history.past).toHaveLength(1);
    expect(s.selectedIds).toHaveLength(3);
    expect(s.selectedIds.some((id) => ids.includes(id))).toBe(false);
    const deckCopy = s.history.present.objects.find((o) => o.kind === 'deck' && s.selectedIds.includes(o.id));
    expect(deckCopy?.kind === 'deck' && deckCopy.cards.length).toBe(5);
    s.undo();
    expect(useTableStore.getState().history.present.objects).toHaveLength(t.objects.length);
  });
});
