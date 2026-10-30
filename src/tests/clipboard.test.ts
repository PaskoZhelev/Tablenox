import { describe, expect, it } from 'vitest';
import { clipboardCenter, copyObjects, pasteObjects, pasteOffset } from '../domain/clipboard';
import { createObject, ownerDeckOf } from '../domain/objects';
import { parseGame } from '../domain/schema';
import type { BagObject, ButtonObject, CardObject, DeckObject, TableState, TabletopObject, TokenObject } from '../domain/types';
import { fixtureGame, tableOf } from './fixtures';

const NOW = '2026-01-01T00:00:00.000Z';
const ofKind = <T extends TabletopObject>(objects: TabletopObject[], kind: T['kind']) => objects.find((o) => o.kind === kind) as T;

/** A game whose holder owns a card lying loose on the table, with a token taken off a stack, a bag and a button. */
function source() {
  const g = fixtureGame();
  const deck = g.objects.find((o): o is DeckObject => o.kind === 'deck' && o.name === 'Deck')!;
  const def = deck.cards[0];
  deck.cards = deck.cards.slice(1);
  const card: CardObject = {
    ...(ofKind<CardObject>(g.objects, 'card') as CardObject),
    cardDefId: def.id,
    sourceDeckId: deck.id,
    faceText: def.faceText,
  };
  const stack = ofKind<TokenObject>(g.objects, 'token');
  const taken: TokenObject = { ...stack, id: 'taken', sourceId: stack.id, position: { x: 900, y: 900 }, zIndex: 40 };
  const bag = ofKind<BagObject>(g.objects, 'bag');
  const bagged: TokenObject = { ...stack, id: 'in-bag', bagId: bag.id };
  bag.items = [bagged];
  const button: ButtonObject = {
    ...createObject('button', { center: { x: 0, y: 600 }, zIndex: 50 }),
    steps: [
      { id: 's1', type: 'move', objectIds: [deck.id, 'elsewhere'], targetIds: [bag.id], deckMode: 'top', orientation: 'keep' },
      { id: 's2', type: 'pick', objectIds: [deck.id], targetIds: [], orientation: 'keep', choose: 'edit', cards: { [deck.id]: [def.id] } },
    ],
  };
  g.objects = g.objects.map((o) => (o.id === card.id ? card : o));
  g.objects.push(taken, button);
  return { g, table: tableOf(g), deck, def, card, stack, taken, bag, button };
}

describe('copy and paste', () => {
  it('copies the chosen objects in stacking order, detached from the game', () => {
    const { table, deck, card } = source();
    expect(copyObjects(table.objects, ['nothing'], NOW)).toBeNull();
    const data = copyObjects(table.objects, [card.id, deck.id], NOW)!;
    expect(data).toMatchObject({ version: 1, copiedAt: NOW });
    expect(data.objects.map((o) => o.id)).toEqual([deck.id, card.id]);
    (data.objects[0] as DeckObject).cards = [];
    expect(deck.cards.length).toBeGreaterThan(0);
  });

  it('pastes copies with new ids, centred where asked, on top (boards underneath)', () => {
    const { table, deck, card } = source();
    const board = table.objects.find((o) => o.kind === 'board')!;
    const data = copyObjects(table.objects, [board.id, deck.id, card.id], NOW)!;
    const offset = pasteOffset(data, { x: 5000, y: 5000 });
    const pasted = pasteObjects(data, table, offset);
    expect(pasted).toHaveLength(3);
    expect(pasted.map((o) => o.id).some((id) => table.objects.some((o) => o.id === id))).toBe(false);
    const center = clipboardCenter({ ...data, objects: pasted });
    expect(Math.abs(center.x - 5000)).toBeLessThanOrEqual(1);
    expect(Math.abs(center.y - 5000)).toBeLessThanOrEqual(1);
    const [b, d, c] = pasted;
    expect(b.position).toEqual({ x: board.position.x + offset.x, y: board.position.y + offset.y });
    const zs = table.objects.map((o) => o.zIndex);
    expect(b.zIndex).toBeLessThan(Math.min(...zs));
    expect(d.zIndex).toBeGreaterThan(Math.max(...zs));
    expect(c.zIndex).toBe(d.zIndex + 1);
  });

  it('a holder copied with its loose card keeps owning it, with fresh card ids', () => {
    const { table, deck, def, card } = source();
    const other = tableOf(fixtureGame());
    const [d, c] = pasteObjects(copyObjects(table.objects, [deck.id, card.id], NOW)!, other, { x: 0, y: 0 }) as [DeckObject, CardObject];
    expect(d.initialCards).toHaveLength(deck.initialCards.length);
    expect(d.initialCards.map((x) => x.id)).not.toContain(def.id);
    expect(d.cards.map((x) => x.id)).toEqual(d.initialCards.slice(1).map((x) => x.id));
    expect(c.sourceDeckId).toBe(d.id);
    expect(c.cardDefId).toBe(d.initialCards[0].id);
    expect(ownerDeckOf([...other.objects, d, c], c.cardDefId!)?.id).toBe(d.id);
  });

  it('a card copied without its holder belongs to it only in the same game', () => {
    const { table, deck, def, card } = source();
    const data = copyObjects(table.objects, [card.id], NOW)!;
    const [same] = pasteObjects(data, table, { x: 10, y: 10 }) as CardObject[];
    expect(same).toMatchObject({ sourceDeckId: deck.id, cardDefId: def.id });
    const [elsewhere] = pasteObjects(data, tableOf(fixtureGame()), { x: 10, y: 10 }) as CardObject[];
    expect(elsewhere.sourceDeckId).toBeUndefined();
    expect(elsewhere.cardDefId).toBeUndefined();
    expect(elsewhere.faceText).toBe(def.faceText);
  });

  it('tokens and bag contents follow copied stacks and bags only', () => {
    const { table, stack, taken, bag } = source();
    const [s, t] = pasteObjects(copyObjects(table.objects, [stack.id, taken.id], NOW)!, table, { x: 0, y: 0 }) as TokenObject[];
    expect(t.sourceId).toBe(s.id);
    const [alone] = pasteObjects(copyObjects(table.objects, [taken.id], NOW)!, table, { x: 0, y: 0 }) as TokenObject[];
    expect(alone.sourceId).toBeUndefined();
    const [b] = pasteObjects(copyObjects(table.objects, [bag.id], NOW)!, table, { x: 0, y: 0 }) as BagObject[];
    expect(b.items).toHaveLength(1);
    expect(b.items[0].id).not.toBe('in-bag');
    expect(b.items[0].bagId).toBe(b.id);
  });

  it("an automation's steps follow copied objects, keep others only in the same game", () => {
    const { table, deck, def, bag, button } = source();
    const withDeck = pasteObjects(copyObjects(table.objects, [deck.id, button.id], NOW)!, tableOf(fixtureGame()), { x: 0, y: 0 });
    const [d, btn] = withDeck as [DeckObject, ButtonObject];
    expect(btn.steps[0]).toMatchObject({ objectIds: [d.id], targetIds: [] });
    expect(btn.steps[1]).toMatchObject({ objectIds: [d.id], cards: { [d.id]: [d.initialCards[0].id] } });
    expect(btn.steps.map((s) => s.id)).not.toContain('s1');
    const [same] = pasteObjects(copyObjects(table.objects, [button.id], NOW)!, table, { x: 0, y: 0 }) as ButtonObject[];
    expect(same.steps[0]).toMatchObject({ objectIds: [deck.id], targetIds: [bag.id] });
    expect(same.steps[1]).toMatchObject({ cards: { [deck.id]: [def.id] } });
  });

  it('pasted objects make a valid game', () => {
    const { table } = source();
    const state: TableState = tableOf(fixtureGame());
    const pasted = pasteObjects(
      copyObjects(
        table.objects,
        table.objects.map((o) => o.id),
        NOW,
      )!,
      state,
      { x: 3, y: 4 },
    );
    const game = { ...fixtureGame(), objects: [...state.objects, ...pasted] };
    expect(parseGame(game).objects).toHaveLength(state.objects.length + table.objects.length);
    const deck = pasted.find((o): o is DeckObject => o.kind === 'deck' && o.name === 'Deck')!;
    expect(new Set(deck.initialCards.map((c) => c.id)).size).toBe(deck.initialCards.length);
  });
});
