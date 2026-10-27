import { describe, expect, it } from 'vitest';
import { applyCommand } from '../domain/commands';
import { createStep, planButton } from '../domain/buttons';
import { bagCount, collectAssetIds, createObject } from '../domain/objects';
import { seededSource } from '../domain/random';
import {
  bagDrawCommand,
  drawManyFromBagCommand,
  drawRandomFromBagCommand,
  homeDeckOf,
  pileHasHome,
  pileHolders,
  resolveDrop,
  splitTokensCommand,
} from '../domain/rules';
import { parseGame } from '../domain/schema';
import type {
  BagObject,
  ButtonObject,
  ButtonStep,
  CardObject,
  DeckObject,
  DieObject,
  TableState,
  TabletopObject,
  TokenObject,
} from '../domain/types';
import { fixtureGame, tableOf } from './fixtures';

const get = <T extends TabletopObject>(s: TableState, id: string) => s.objects.find((o) => o.id === id) as T | undefined;
const byKind = <T extends TabletopObject>(s: TableState, kind: T['kind']) => s.objects.find((o) => o.kind === kind) as T;

function setup(...steps: ButtonStep[]) {
  const game = fixtureGame();
  const button = { ...createObject('button', { center: { x: 0, y: 500 }, zIndex: 99 }), steps };
  game.objects.push(button);
  const state = tableOf(game);
  const deck = byKind<DeckObject>(state, 'deck');
  const holder = state.objects.find((o): o is DeckObject => o.kind === 'deck' && o.name === 'Holder')!;
  return {
    state,
    button,
    deck,
    holder,
    bag: byKind<BagObject>(state, 'bag'),
    die: byKind<DieObject>(state, 'die'),
    token: byKind<TokenObject>(state, 'token'),
    card: byKind<CardObject>(state, 'card'),
  };
}

const step = <T extends ButtonStep>(type: T['type'], ids: string[], patch: Partial<T> = {}) =>
  ({ ...createStep(type), objectIds: ids, ...patch }) as T;

function run(state: TableState, button: ButtonObject, seed = 1): TableState {
  const cmd = planButton(state, button, seededSource(seed));
  return cmd ? applyCommand(state, cmd) : state;
}

/** A pile of the deck's first `n` cards, lying on the table. */
function pileOf(state: TableState, deck: DeckObject, n: number): { state: TableState; pile: DeckObject } {
  const pile: DeckObject = {
    ...createObject('deck', { center: { x: 900, y: 900 }, zIndex: 90 }),
    name: 'Pile',
    isPile: true,
    cards: deck.cards.slice(0, n),
  };
  const cards = deck.cards.slice(n);
  return {
    pile,
    state: { ...state, objects: [...state.objects.map((o) => (o.id === deck.id ? { ...deck, cards } : o)), pile] },
  };
}

describe('returning piles and cards to their holder', () => {
  it('sends the cards of a pile back to the holder that owns them and removes the empty pile', () => {
    const { state, deck } = setup();
    const { state: s1, pile } = pileOf(state, deck, 2);
    expect(pileHasHome(s1, pile)).toBe(true);
    expect(pileHolders(s1, pile).map((h) => h.id)).toEqual([deck.id]);
    const s2 = applyCommand(s1, { type: 'ReturnPile', id: pile.id });
    expect(get(s2, pile.id)).toBeUndefined();
    expect(
      get<DeckObject>(s2, deck.id)!
        .cards.map((c) => c.id)
        .sort(),
    ).toEqual(deck.cards.map((c) => c.id).sort());
    // Nothing left to do the second time.
    expect(applyCommand(s2, { type: 'ReturnPile', id: pile.id })).toBe(s2);
  });

  it('keeps cards that have no holder in the pile', () => {
    const { state, deck } = setup();
    const { state: s1, pile } = pileOf(state, deck, 2);
    const stray = { id: 'stray', name: 'Stray', faceText: '', faceColor: '#fff' };
    const s2 = { ...s1, objects: s1.objects.map((o) => (o.id === pile.id ? { ...pile, cards: [...pile.cards, stray] } : o)) };
    const s3 = applyCommand(s2, { type: 'ReturnPile', id: pile.id });
    expect(get<DeckObject>(s3, pile.id)!.cards.map((c) => c.id)).toEqual(['stray']);
  });

  it('finds the holder of a card that was drawn', () => {
    const { state, deck } = setup();
    const s1 = applyCommand(state, {
      type: 'DrawCard',
      deckId: deck.id,
      cardId: 'drawn',
      position: { x: 0, y: 0 },
      faceUp: true,
    });
    expect(homeDeckOf(s1, get<CardObject>(s1, 'drawn')!)?.id).toBe(deck.id);
  });
});

describe('token recall', () => {
  function stackOf(count: number) {
    const { state, token } = setup();
    const stack = { ...token, count };
    return { state: { ...state, objects: state.objects.map((o) => (o.id === token.id ? stack : o)) }, stack };
  }

  it('remembers the stack a token was taken off and merges back into it', () => {
    const { state, stack } = stackOf(5);
    const take = splitTokensCommand(stack, 2)!;
    if (take.type !== 'SplitTokens') throw new Error('expected a split');
    const s1 = applyCommand(state, take);
    const taken = get<TokenObject>(s1, take.newId)!;
    expect(taken.sourceId).toBe(stack.id);
    const s2 = applyCommand(s1, { type: 'RecallToken', id: taken.id });
    expect(get(s2, taken.id)).toBeUndefined();
    expect(get<TokenObject>(s2, stack.id)!.count).toBe(5);
  });

  it('keeps the root stack when a taken stack is split again', () => {
    const { state, stack } = stackOf(6);
    const first = splitTokensCommand(stack, 3)!;
    if (first.type !== 'SplitTokens') throw new Error('expected a split');
    const s1 = applyCommand(state, first);
    const second = splitTokensCommand(get<TokenObject>(s1, first.newId)!, 1)!;
    if (second.type !== 'SplitTokens') throw new Error('expected a split');
    const s2 = applyCommand(s1, second);
    expect(get<TokenObject>(s2, second.newId)!.sourceId).toBe(stack.id);
  });

  it('ignores tokens without a source or that no longer look the same', () => {
    const { state, stack } = stackOf(4);
    const take = splitTokensCommand(stack, 1)!;
    if (take.type !== 'SplitTokens') throw new Error('expected a split');
    const s1 = applyCommand(state, take);
    expect(applyCommand(s1, { type: 'RecallToken', id: stack.id })).toBe(s1);
    const recoloured = { ...s1, objects: s1.objects.map((o) => (o.id === stack.id ? { ...stack, color: '#000000' } : o)) };
    expect(applyCommand(recoloured, { type: 'RecallToken', id: take.newId })).toBe(recoloured);
  });

  it('recalls every token of a stack with an automation step, and tokens on their own', () => {
    const { state, stack } = stackOf(5);
    let s = state;
    const ids: string[] = [];
    for (const n of [1, 2]) {
      const cur = get<TokenObject>(s, stack.id)!;
      const cmd = splitTokensCommand(cur, n)!;
      if (cmd.type !== 'SplitTokens') throw new Error('expected a split');
      ids.push(cmd.newId);
      s = applyCommand(s, cmd);
    }
    const button = { ...createObject('button', { center: { x: 0, y: 0 }, zIndex: 99 }), steps: [step('recall', [stack.id])] };
    const back = run(s, button);
    expect(get<TokenObject>(back, stack.id)!.count).toBe(5);
    expect(ids.every((id) => !get(back, id))).toBe(true);
    const single = run(s, { ...button, steps: [step('recall', [ids[0]])] });
    expect(get<TokenObject>(single, stack.id)!.count).toBe(3);
  });
});

describe('bags', () => {
  it('takes in cards, piles, tokens and dice, and keeps their identity', () => {
    const { state, bag, card, die, deck } = setup();
    const { state: withPile, pile } = pileOf(state, deck, 2);
    let s = withPile;
    for (const id of [card.id, die.id, pile.id]) s = applyCommand(s, { type: 'BagPut', bagId: bag.id, objectId: id });
    const b = get<BagObject>(s, bag.id)!;
    expect(b.items.map((i) => i.id)).toEqual([pile.id, die.id, card.id]);
    expect(b.items.every((i) => i.bagId === bag.id)).toBe(true);
    expect([card.id, die.id, pile.id].every((id) => !s.objects.some((o) => o.id === id))).toBe(true);
    expect(bagCount(b)).toBe(3);
  });

  it('refuses boards, buttons, holders and bags', () => {
    const { state, bag, holder, button } = setup();
    const board = state.objects.find((o) => o.kind === 'board')!;
    for (const id of [board.id, holder.id, button.id, bag.id]) {
      expect(applyCommand(state, { type: 'BagPut', bagId: bag.id, objectId: id })).toBe(state);
    }
  });

  it('stacks identical tokens in the bag and gives them out one at a time', () => {
    const { state, bag, token } = setup();
    const twin = { ...token, id: 'twin', count: 3 };
    let s = { ...state, objects: [...state.objects, twin] };
    s = applyCommand(s, { type: 'BagPut', bagId: bag.id, objectId: token.id });
    s = applyCommand(s, { type: 'BagPut', bagId: bag.id, objectId: twin.id });
    expect(get<BagObject>(s, bag.id)!.items).toHaveLength(1);
    expect(bagCount(get<BagObject>(s, bag.id)!)).toBe(4);
    const draw = bagDrawCommand(get<BagObject>(s, bag.id)!, 0)!;
    if (draw.type !== 'BagDraw') throw new Error('expected a draw');
    s = applyCommand(s, draw);
    const out = get<TokenObject>(s, draw.newId)!;
    expect(out.count).toBeUndefined();
    expect(out.bagId).toBe(bag.id);
    expect(bagCount(get<BagObject>(s, bag.id)!)).toBe(3);
  });

  it('draws an entry out as the very same object, on top and face as stored', () => {
    const { state, bag, card } = setup();
    const s1 = applyCommand(state, { type: 'BagPut', bagId: bag.id, objectId: card.id });
    const draw = bagDrawCommand(get<BagObject>(s1, bag.id)!, 0, { x: 500, y: 500 })!;
    const s2 = applyCommand(s1, draw);
    const back = get<CardObject>(s2, card.id)!;
    expect(back.faceUp).toBe(card.faceUp);
    expect(back.position).toEqual({ x: 500 - card.width / 2, y: 500 - card.height / 2 });
    expect(back.bagId).toBe(bag.id);
    expect(get<BagObject>(s2, bag.id)!.items).toHaveLength(0);
    // Replaying the same command is a no-op (the id is taken).
    expect(applyCommand(s2, draw)).toBe(s2);
  });

  it('draws at random, weighting token stacks, and several pieces in one undo step', () => {
    const { state, bag, card, die } = setup();
    let s = state;
    for (const id of [card.id, die.id]) s = applyCommand(s, { type: 'BagPut', bagId: bag.id, objectId: id });
    const b = get<BagObject>(s, bag.id)!;
    const one = drawRandomFromBagCommand(b, undefined, seededSource(3))!;
    expect(one.type).toBe('BagDraw');
    const many = drawManyFromBagCommand(s, b, 5, seededSource(3))!;
    const after = applyCommand(s, many);
    expect(get<BagObject>(after, bag.id)!.items).toHaveLength(0);
    expect(after.objects.some((o) => o.id === card.id) && after.objects.some((o) => o.id === die.id)).toBe(true);
    expect(drawManyFromBagCommand(after, get<BagObject>(after, bag.id)!, 2)).toBeNull();
  });

  it('shuffles with the given order only', () => {
    const { state, bag, card, die } = setup();
    let s = state;
    for (const id of [card.id, die.id]) s = applyCommand(s, { type: 'BagPut', bagId: bag.id, objectId: id });
    const order = get<BagObject>(s, bag.id)!.items.map((i) => i.id);
    const swapped = applyCommand(s, { type: 'ShuffleBag', id: bag.id, order: [1, 0] });
    expect(get<BagObject>(swapped, bag.id)!.items.map((i) => i.id)).toEqual([...order].reverse());
    expect(applyCommand(s, { type: 'ShuffleBag', id: bag.id, order: [0] })).toBe(s);
  });

  it('recalls everything that came out of the bag', () => {
    const { state, bag, card, die } = setup();
    let s = state;
    for (const id of [card.id, die.id]) s = applyCommand(s, { type: 'BagPut', bagId: bag.id, objectId: id });
    s = applyCommand(s, drawManyFromBagCommand(s, get<BagObject>(s, bag.id)!, 2)!);
    expect(get<BagObject>(s, bag.id)!.items).toHaveLength(0);
    const back = applyCommand(s, { type: 'RecallToBag', bagId: bag.id });
    expect(get<BagObject>(back, bag.id)!.items).toHaveLength(2);
    expect(back.objects.some((o) => o.id === card.id)).toBe(false);
    expect(applyCommand(back, { type: 'RecallToBag', bagId: bag.id })).toBe(back);
  });

  it('is dropped into by cards, piles and other pieces', () => {
    const { state, bag, card, die, token, deck } = setup();
    const at = { x: bag.position.x + 10, y: bag.position.y + 10 };
    for (const o of [card, die, token]) {
      expect(resolveDrop(state, o.id, at, 'play')).toEqual({ type: 'BagPut', bagId: bag.id, objectId: o.id });
    }
    const { state: withPile, pile } = pileOf(state, deck, 2);
    expect(resolveDrop(withPile, pile.id, at, 'play')).toEqual({ type: 'BagPut', bagId: bag.id, objectId: pile.id });
    // Free placement (Shift) and the bag itself just move.
    expect(resolveDrop(state, card.id, at, 'play', { free: true }).type).toBe('MoveObject');
    expect(resolveDrop(state, bag.id, at, 'play').type).toBe('MoveObject');
  });

  it('removes a holder’s cards from bags when it is reset', () => {
    const { state, bag, deck } = setup();
    const drawn = applyCommand(state, { type: 'DrawCard', deckId: deck.id, cardId: 'x', position: { x: 0, y: 0 }, faceUp: true });
    const inBag = applyCommand(drawn, { type: 'BagPut', bagId: bag.id, objectId: 'x' });
    expect(get<BagObject>(inBag, bag.id)!.items).toHaveLength(1);
    const reset = applyCommand(inBag, { type: 'ResetDeck', deckId: deck.id });
    expect(get<BagObject>(reset, bag.id)!.items).toHaveLength(0);
    expect(get<DeckObject>(reset, deck.id)!.cards).toHaveLength(deck.initialCards.length);
  });

  it('survives saving and loading, and reports its images', () => {
    const game = fixtureGame('asset-1');
    const bag = game.objects.find((o): o is BagObject => o.kind === 'bag')!;
    const board = game.objects.find((o) => o.kind === 'board')!;
    const image = { ...createObject('image', { center: { x: 0, y: 0 }, zIndex: 5 }), assetId: 'asset-2' };
    bag.items = [{ ...image, bagId: bag.id }];
    void board;
    const parsed = parseGame(JSON.parse(JSON.stringify(game)));
    const loaded = parsed.objects.find((o): o is BagObject => o.kind === 'bag')!;
    expect(loaded.items).toHaveLength(1);
    expect(collectAssetIds([loaded])).toEqual(new Set(['asset-2']));
  });
});

describe('automation with bags', () => {
  it('moves cards, tokens and dice into a bag, and draws from it onto a holder or the table', () => {
    const { state, button, bag, card, die, holder, deck } = setup();
    const into = run(state, {
      ...button,
      steps: [step('move', [card.id, die.id], { targetIds: [bag.id] }), step('move', [deck.id], { targetIds: [bag.id], count: 2 })],
    });
    const b = get<BagObject>(into, bag.id)!;
    expect(b.items.map((i) => i.kind).sort()).toEqual(['card', 'card', 'card', 'die']);
    expect(get(into, card.id)).toBeUndefined();

    const topThree = b.items.slice(0, 3);
    const onto = run(into, {
      ...button,
      steps: [step('move', [bag.id], { targetIds: [holder.id], count: 3 })],
    });
    // Cards go into the holder; anything else is centred on it on the table.
    expect(get<DeckObject>(onto, holder.id)!.cards.map((c) => c.id)).toHaveLength(topThree.filter((i) => i.kind === 'card').length);
    expect(topThree.filter((i) => i.kind === 'die').every((i) => !!get(onto, i.id))).toBe(true);
    expect(bagCount(get<BagObject>(onto, bag.id)!)).toBe(1);
  });

  it('shuffles a bag and draws from its top or bottom', () => {
    const { state, button, bag, card, die, token } = setup();
    const filled = run(state, { ...button, steps: [step('move', [card.id, die.id, token.id], { targetIds: [bag.id] })] });
    const order = get<BagObject>(filled, bag.id)!.items.map((i) => i.id);
    const shuffled = run(filled, { ...button, steps: [step('shuffle', [bag.id])] }, 5);
    expect(
      get<BagObject>(shuffled, bag.id)!
        .items.map((i) => i.id)
        .sort(),
    ).toEqual([...order].sort());
    const table = { x: 0, y: 0 };
    const target = createObject('label', { center: table, zIndex: 200 });
    const withTarget = { ...shuffled, objects: [...shuffled.objects, target] };
    const top = get<BagObject>(withTarget, bag.id)!.items[0].id;
    const bottom = get<BagObject>(withTarget, bag.id)!.items.at(-1)!.id;
    const drawnTop = run(withTarget, { ...button, steps: [step('move', [bag.id], { targetIds: [target.id], count: 1 })] });
    expect(get(drawnTop, top)).toBeDefined();
    expect(get<BagObject>(drawnTop, bag.id)!.items.some((i) => i.id === top)).toBe(false);
    const drawnBottom = run(withTarget, {
      ...button,
      steps: [step('move', [bag.id], { targetIds: [target.id], count: 1, deckMode: 'bottom' })],
    });
    expect(get(drawnBottom, bottom)).toBeDefined();
  });

  it('recalls pieces to their bag, one by one or through the bag itself', () => {
    const { state, button, bag, card, die } = setup();
    const filled = run(state, { ...button, steps: [step('move', [card.id, die.id], { targetIds: [bag.id] })] });
    const out = run(filled, { ...button, steps: [step('move', [bag.id], { targetIds: [filled.objects[0].id] })] });
    expect(get<BagObject>(out, bag.id)!.items).toHaveLength(0);
    const one = run(out, { ...button, steps: [step('recall', [die.id])] });
    expect(get<BagObject>(one, bag.id)!.items.map((i) => i.id)).toEqual([die.id]);
    const all = run(out, { ...button, steps: [step('recall', [bag.id])] });
    expect(get<BagObject>(all, bag.id)!.items).toHaveLength(2);
  });

  it('recalls a card to its bag before its holder', () => {
    const { state, button, bag, deck } = setup();
    const drawn = applyCommand(state, { type: 'DrawCard', deckId: deck.id, cardId: 'x', position: { x: 0, y: 0 }, faceUp: true });
    const s1 = applyCommand(drawn, { type: 'BagPut', bagId: bag.id, objectId: 'x' });
    const s2 = applyCommand(s1, bagDrawCommand(get<BagObject>(s1, bag.id)!, 0)!);
    const toBag = run(s2, { ...button, steps: [step('recall', ['x'])] });
    expect(get<BagObject>(toBag, bag.id)!.items.map((i) => i.id)).toEqual(['x']);
  });

  it('accepts bags in the shuffle and recall steps only where sensible', async () => {
    const { canPick } = await import('../domain/buttons');
    const { state, button, bag } = setup();
    expect(canPick(step('shuffle', []), 'objects', bag, button.id)).toBe(true);
    expect(canPick(step('recall', []), 'objects', bag, button.id)).toBe(true);
    expect(canPick(step('flip', []), 'objects', bag, button.id)).toBe(false);
    expect(canPick(step('roll', []), 'objects', bag, button.id)).toBe(false);
    expect(state.objects).toContain(bag);
  });
});
