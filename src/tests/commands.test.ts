import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../domain/commands';
import { createHistory, HISTORY_LIMIT, pushHistory, redoHistory, undoHistory } from '../domain/history';
import { seededSource } from '../domain/random';
import {
  cardIndexAt,
  cardSlots,
  drawCardCommand,
  drawCardsCommand,
  drawPickedCardCommand,
  effectiveHoverZoom,
  findDropTarget,
  findHoverTarget,
  homeDeckOf,
  resolveDrop,
  rollDieCommand,
  shuffleDeckCommand,
  spreadInsertIndex,
  spreadLayout,
  splitTokensCommand,
  takeStackCommand,
} from '../domain/rules';
import type { CardObject, DeckObject, DieObject, InkStroke, TableState, TokenObject } from '../domain/types';
import {
  CARD_SIZE,
  cardSizeOf,
  collectAssetIds,
  createCardDef,
  createDieFace,
  createObject,
  dieFaceCount,
  dieFaceLabel,
  fixedInPlay,
  HOLDER_MARGIN,
  ownerDeckOf,
  remapAssetIds,
  resolveCardLook,
  tokenCount,
} from '../domain/objects';
import { fixtureGame, tableOf } from './fixtures';

const byKind = <K extends string>(s: TableState, kind: K) => s.objects.find((o) => o.kind === kind)!;
const deckOf = (s: TableState) => byKind(s, 'deck') as DeckObject;
/** The fixture's empty holder (the other non-pile 'deck'). */
const holderOf = (s: TableState) => s.objects.find((o): o is DeckObject => o.kind === 'deck' && o.name === 'Holder')!;
const cardsOnTable = (s: TableState) => s.objects.filter((o): o is CardObject => o.kind === 'card');

function stroke(id: string, points: number[]): InkStroke {
  return { id, points, color: '#000', width: 4, opacity: 1 };
}

describe('commands', () => {
  it('returns the same reference for no-ops', () => {
    const s = tableOf(fixtureGame());
    expect(applyCommand(s, { type: 'DeleteObject', id: 'nope' })).toBe(s);
    const card = byKind(s, 'card');
    expect(applyCommand(s, { type: 'MoveObject', id: card.id, position: card.position })).toBe(s);
  });

  it('moves, flips and brings to front', () => {
    const s0 = tableOf(fixtureGame());
    const card = byKind(s0, 'card') as CardObject;
    const s1 = applyCommand(s0, { type: 'MoveObject', id: card.id, position: { x: 10, y: 20 }, toFront: true });
    const moved = byKind(s1, 'card') as CardObject;
    expect(moved.position).toEqual({ x: 10, y: 20 });
    expect(moved.zIndex).toBe(Math.max(...s0.objects.map((o) => o.zIndex)) + 1);
    const s2 = applyCommand(s1, { type: 'FlipCard', id: card.id });
    expect((byKind(s2, 'card') as CardObject).faceUp).toBe(!card.faceUp);
    // immutability
    expect(card.position).not.toEqual({ x: 10, y: 20 });
  });

  it('clamps counters to min/max', () => {
    let s = tableOf(fixtureGame());
    const c = byKind(s, 'counter');
    s = applyCommand(s, { type: 'IncrementCounter', id: c.id, delta: 25 });
    expect((byKind(s, 'counter') as { value: number }).value).toBe(10);
    s = applyCommand(s, { type: 'IncrementCounter', id: c.id, delta: -100 });
    expect((byKind(s, 'counter') as { value: number }).value).toBe(0);
  });

  it('rolls dice within range and counts rolls', () => {
    let s = tableOf(fixtureGame());
    const die = byKind(s, 'die');
    const src = seededSource(3);
    for (let i = 0; i < 50; i++) {
      s = applyCommand(s, rollDieCommand(byKind(s, 'die') as never, src));
      const v = (byKind(s, 'die') as { value: number }).value;
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
    expect((byKind(s, 'die') as { rollCount: number }).rollCount).toBe(50);
    expect(die.id).toBe(byKind(s, 'die').id);
  });

  it('rolls custom dice within their face count and clamps values', () => {
    let s = tableOf(fixtureGame());
    const die = byKind(s, 'die') as DieObject;
    const faces = [createDieFace({ label: 'Sun' }), createDieFace({ label: 'Moon', assetId: 'img-1' }), createDieFace({ label: 'Star' })];
    s = applyCommand(s, { type: 'UpdateObject', id: die.id, patch: { faces } });
    const custom = byKind(s, 'die') as DieObject;
    expect(dieFaceCount(custom)).toBe(3);
    expect(dieFaceLabel(custom, 2)).toBe('Moon');
    const src = seededSource(11);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      s = applyCommand(s, rollDieCommand(byKind(s, 'die') as DieObject, src));
      seen.add((byKind(s, 'die') as DieObject).value);
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
    s = applyCommand(s, { type: 'RollDie', id: die.id, value: 9 });
    expect((byKind(s, 'die') as DieObject).value).toBe(3);
    expect(collectAssetIds(s.objects).has('img-1')).toBe(true);
    const remapped = remapAssetIds(s.objects, new Map([['img-1', 'img-2']]));
    expect((remapped.find((o) => o.kind === 'die') as DieObject).faces![1].assetId).toBe('img-2');
  });

  it('reorders z-index with forward/backward/front/back', () => {
    const s0 = tableOf(fixtureGame());
    const board = byKind(s0, 'board');
    const s1 = applyCommand(s0, { type: 'SetZIndex', id: board.id, direction: 'front' });
    const zs = s1.objects.map((o) => o.zIndex);
    expect(byKind(s1, 'board').zIndex).toBe(Math.max(...zs));
    expect(new Set(zs).size).toBe(zs.length);
    const s2 = applyCommand(s1, { type: 'SetZIndex', id: board.id, direction: 'backward' });
    expect(byKind(s2, 'board').zIndex).toBe(Math.max(...zs) - 1);
    const s3 = applyCommand(s2, { type: 'SetZIndex', id: board.id, direction: 'back' });
    expect(byKind(s3, 'board').zIndex).toBe(1);
  });

  it('adds and erases strokes; ignores degenerate strokes', () => {
    let s = tableOf(fixtureGame());
    s = applyCommand(s, { type: 'AddStroke', stroke: stroke('a', [0, 0, 10, 10]) });
    s = applyCommand(s, { type: 'AddStroke', stroke: stroke('b', [5, 5]) });
    expect(applyCommand(s, { type: 'AddStroke', stroke: stroke('c', []) })).toBe(s);
    expect(s.annotations.strokes.map((x) => x.id)).toEqual(['a', 'b']);
    s = applyCommand(s, { type: 'EraseAnnotations', strokeIds: ['a'], textIds: [] });
    expect(s.annotations.strokes.map((x) => x.id)).toEqual(['b']);
  });

  it('edits and deletes text annotations', () => {
    let s = tableOf(fixtureGame());
    s = applyCommand(s, {
      type: 'AddTextAnnotation',
      annotation: { id: 't', position: { x: 1, y: 2 }, text: '12', fontSize: 20, color: '#000' },
    });
    s = applyCommand(s, { type: 'EditTextAnnotation', id: 't', patch: { text: '15' } });
    expect(s.annotations.text[0].text).toBe('15');
    expect(applyCommand(s, { type: 'EditTextAnnotation', id: 't', patch: { text: '15' } })).toBe(s);
    s = applyCommand(s, { type: 'EditTextAnnotation', id: 't', patch: { text: '   ' } });
    expect(s.annotations.text).toHaveLength(0);
  });

  it('clears all annotations', () => {
    let s = tableOf(fixtureGame());
    s = applyCommand(s, { type: 'AddStroke', stroke: stroke('a', [0, 0, 1, 1]) });
    s = applyCommand(s, { type: 'ClearAnnotations' });
    expect(s.annotations.strokes).toHaveLength(0);
    expect(applyCommand(s, { type: 'ClearAnnotations' })).toBe(s);
  });
});

describe('deck rules', () => {
  const mainDeck = (s: TableState) => s.objects.find((o): o is DeckObject => o.kind === 'deck' && !o.isPile)!;
  const piles = (s: TableState) => s.objects.filter((o): o is DeckObject => o.kind === 'deck' && o.isPile);

  it('drawing decreases the deck and never duplicates a card (AC8)', () => {
    let s = tableOf(fixtureGame());
    const total = deckOf(s).cards.length;
    s = applyCommand(s, shuffleDeckCommand(deckOf(s), seededSource(5)));
    const order = deckOf(s).cards.map((c) => c.id);
    for (let i = 0; i < total + 2; i++) {
      const cmd = drawCardCommand(deckOf(s));
      if (cmd) s = applyCommand(s, cmd);
    }
    const drawn = cardsOnTable(s).filter((c) => c.sourceDeckId === deckOf(s).id);
    expect(deckOf(s).cards).toHaveLength(0);
    expect(drawn.map((c) => c.cardDefId)).toEqual(order);
    expect(new Set(drawn.map((c) => c.cardDefId)).size).toBe(total);
  });

  it('draws face up or face down according to the deck setting', () => {
    let s = tableOf(fixtureGame());
    s = applyCommand(s, { type: 'UpdateObject', id: deckOf(s).id, patch: { drawSide: 'faceDown' } });
    const cmd = drawCardCommand(deckOf(s))! as Extract<Command, { type: 'DrawCard' }>;
    expect(cmd.faceUp).toBe(false);
    s = applyCommand(s, cmd);
    expect(cardsOnTable(s).find((c) => c.id === cmd.cardId)!.faceUp).toBe(false);
  });

  it('a replayed DrawCard command with the same card id is a no-op', () => {
    const s0 = tableOf(fixtureGame());
    const cmd = drawCardCommand(deckOf(s0))!;
    const s1 = applyCommand(s0, cmd);
    expect(applyCommand(s1, cmd)).toBe(s1);
  });

  it('dropping a drawn card on a deck puts it on top in play mode', () => {
    let s = tableOf(fixtureGame());
    const cmd = drawCardCommand(deckOf(s))! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, cmd);
    const drawnDef = cardsOnTable(s).find((c) => c.id === cmd.cardId)!.cardDefId;
    const drop = resolveDrop(s, cmd.cardId, { ...deckOf(s).position }, 'play');
    expect(drop).toMatchObject({ type: 'AddCardToDeck', asDefinition: false });
    s = applyCommand(s, drop);
    expect(deckOf(s).cards).toHaveLength(5);
    expect(deckOf(s).cards[0].id).toBe(drawnDef);
    // Holders keep the side a card had when it was put in.
    expect(deckOf(s).cards[0]).toMatchObject({ faceUp: true });
  });

  it('Shift (free) drop never merges or snaps', () => {
    const s = tableOf(fixtureGame());
    const card = byKind(s, 'card');
    expect(resolveDrop(s, card.id, { ...deckOf(s).position }, 'play', { free: true }).type).toBe('MoveObject');
    const holder = holderOf(s);
    const drop = resolveDrop(s, card.id, { x: holder.position.x + 3, y: holder.position.y + 3 }, 'play', { free: true });
    expect(drop).toMatchObject({ type: 'MoveObject', position: { x: holder.position.x + 3, y: holder.position.y + 3 } });
  });

  it('findDropTarget reports the deck or card under a dragged card', () => {
    let s = tableOf(fixtureGame());
    const cmd = drawCardCommand(deckOf(s), { x: 0, y: 0 })! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, cmd);
    const card = byKind(s, 'card');
    const deck = deckOf(s);
    expect(findDropTarget(s, card.id, { x: deck.position.x + 10, y: deck.position.y + 10 })?.id).toBe(deck.id);
    expect(findDropTarget(s, card.id, { x: 10, y: 10 })?.id).toBe(cmd.cardId);
    expect(findDropTarget(s, card.id, { x: -5000, y: -5000 })).toBeUndefined();
  });

  it('dropping a card on a card creates a pile that keeps orientation and disappears when empty', () => {
    let s = tableOf(fixtureGame());
    const draw = drawCardCommand(deckOf(s), { x: 0, y: 0 })! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, draw);
    const standalone = s.objects.find((o) => o.kind === 'card' && o.id !== draw.cardId) as CardObject;
    s = applyCommand(s, { type: 'FlipCard', id: standalone.id }); // standalone now face down
    const drop = resolveDrop(s, standalone.id, { x: 5, y: 5 }, 'play');
    expect(drop.type).toBe('MergeCards');
    s = applyCommand(s, drop);
    expect(cardsOnTable(s)).toHaveLength(0);
    const [pile] = piles(s);
    expect(pile.cards).toHaveLength(2);
    expect(pile.cards[0]).toMatchObject({ faceUp: false });
    expect(pile.position).toEqual({ x: 0, y: 0 });

    const d1 = drawCardCommand(pile)! as Extract<Command, { type: 'DrawCard' }>;
    expect(d1.faceUp).toBe(false);
    s = applyCommand(s, d1);
    s = applyCommand(s, drawCardCommand(piles(s)[0])!);
    expect(piles(s)).toHaveLength(0);
    expect(cardsOnTable(s)).toHaveLength(2);
  });

  it('reset gathers the deck’s cards from the table and from piles, without duplicates', () => {
    let s = tableOf(fixtureGame());
    const deckId = mainDeck(s).id;
    const a = drawCardCommand(mainDeck(s), { x: 0, y: 0 })! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, a);
    const b = drawCardCommand(mainDeck(s), { x: 1000, y: 1000 })! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, b);
    const standalone = s.objects.find((o) => o.kind === 'card' && o.id !== a.cardId && o.id !== b.cardId)!;
    // standalone + card a -> pile; card b stays on the table
    s = applyCommand(s, { type: 'MergeCards', cardId: standalone.id, targetCardId: a.cardId, pileId: 'pile-1' });
    s = applyCommand(s, { type: 'ResetDeck', deckId });
    const deck = s.objects.find((o) => o.id === deckId) as DeckObject;
    expect(deck.cards.map((c) => c.id)).toEqual(deck.initialCards.map((c) => c.id));
    expect(cardsOnTable(s).filter((c) => c.cardDefId && deck.initialCards.some((d) => d.id === c.cardDefId))).toHaveLength(0);
    // The pile keeps only the foreign (standalone) card.
    expect(piles(s)[0].cards.map((c) => c.name)).toEqual([standalone.name]);
  });

  it('reset sends foreign cards back to their own deck', () => {
    let s = tableOf(fixtureGame());
    const deckA = mainDeck(s);
    const deckB: DeckObject = { ...deckA, id: 'deck-b', position: { x: 2000, y: 0 }, cards: [], initialCards: [] };
    s = applyCommand(s, { type: 'AddObject', object: deckB });
    const draw = drawCardCommand(deckA)! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, draw);
    s = applyCommand(s, { type: 'AddCardToDeck', cardId: draw.cardId, deckId: 'deck-b' });
    expect((s.objects.find((o) => o.id === 'deck-b') as DeckObject).cards).toHaveLength(1);
    // Resetting B must not lose A's card.
    s = applyCommand(s, { type: 'ResetDeck', deckId: 'deck-b' });
    expect((s.objects.find((o) => o.id === deckA.id) as DeckObject).cards).toHaveLength(5);
  });

  it('dropping a standalone card on a deck in edit mode adds it to the definition', () => {
    let s = tableOf(fixtureGame());
    const card = byKind(s, 'card');
    const drop = resolveDrop(s, card.id, { ...deckOf(s).position }, 'edit');
    expect(drop).toMatchObject({ type: 'AddCardToDeck', asDefinition: true });
    s = applyCommand(s, drop);
    expect(deckOf(s).initialCards).toHaveLength(6);
    expect(s.objects.some((o) => o.id === card.id)).toBe(false);
  });

  it('homeDeckOf finds the owning deck of a drawn card', () => {
    let s = tableOf(fixtureGame());
    const draw = drawCardCommand(deckOf(s))! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, draw);
    const card = cardsOnTable(s).find((c) => c.id === draw.cardId)!;
    expect(homeDeckOf(s, card)?.id).toBe(deckOf(s).id);
    expect(homeDeckOf(s, byKind(s, 'card') as CardObject)).toBeUndefined();
  });

  it('draws several cards from the top or the bottom as one pile, in deck order', () => {
    let s = tableOf(fixtureGame());
    const ids = deckOf(s).cards.map((c) => c.id);
    const piles = () => s.objects.filter((o): o is DeckObject => o.kind === 'deck' && o.isPile);
    const top = drawCardsCommand(deckOf(s), 2, 'top')!;
    expect(top.type).toBe('DrawCards');
    s = applyCommand(s, top);
    expect(applyCommand(s, top)).toBe(s);
    expect(piles()).toHaveLength(1);
    expect(piles()[0].cards.map((c) => c.id)).toEqual(ids.slice(0, 2));
    // The fixture deck draws face up.
    expect(piles()[0].cards.every((c) => c.faceUp === true)).toBe(true);
    expect(deckOf(s).cards.map((c) => c.id)).toEqual(ids.slice(2));
    // A single card is drawn on its own.
    s = applyCommand(s, drawCardsCommand(deckOf(s), 1, 'bottom')!);
    expect(deckOf(s).cards.map((c) => c.id)).toEqual(ids.slice(2, -1));
    expect(cardsOnTable(s).some((c) => c.cardDefId === ids[ids.length - 1])).toBe(true);
    s = applyCommand(s, drawCardsCommand(deckOf(s), 99, 'bottom')!);
    expect(deckOf(s).cards).toHaveLength(0);
    expect(piles()[1].cards.map((c) => c.id)).toEqual(ids.slice(2, -1));
    expect(drawCardsCommand(deckOf(s), 1, 'top')).toBeNull();
  });

  it('token stacks split off tokens and identical tokens dropped on each other stack up', () => {
    let s = tableOf(fixtureGame());
    const token = byKind(s, 'token') as TokenObject;
    const tokenNow = () => s.objects.find((o) => o.id === token.id) as TokenObject;
    expect(splitTokensCommand(token, 1)).toBeNull(); // a single token can't be split
    s = applyCommand(s, { type: 'UpdateObject', id: token.id, patch: { count: 25 } });

    const split = splitTokensCommand(tokenNow(), 3)! as Extract<Command, { type: 'SplitTokens' }>;
    s = applyCommand(s, split);
    expect(applyCommand(s, split)).toBe(s);
    const taken = () => s.objects.find((o) => o.id === split.newId) as TokenObject;
    expect(tokenCount(tokenNow())).toBe(22);
    expect(tokenCount(taken())).toBe(3);
    expect(taken()).toMatchObject({ shape: token.shape, color: token.color, position: split.position });
    // Taking more than the stack has leaves one behind.
    expect(splitTokensCommand(tokenNow(), 99)).toMatchObject({ count: 21 });

    // Dropping the small stack back onto the big one merges them.
    const c = { x: tokenNow().position.x + 2, y: tokenNow().position.y + 2 };
    const drop = resolveDrop(s, split.newId, c, 'play');
    expect(drop).toEqual({ type: 'MergeTokens', id: split.newId, targetId: token.id });
    s = applyCommand(s, drop);
    expect(tokenCount(tokenNow())).toBe(25);
    expect(s.objects.some((o) => o.id === split.newId)).toBe(false);

    // A token that looks different is just moved, and Shift (free) never stacks.
    const other: TokenObject = { ...tokenNow(), id: 'red', color: '#ff0000', count: undefined, zIndex: 99, position: { x: 5000, y: 5000 } };
    s = applyCommand(s, { type: 'AddObject', object: other });
    expect(resolveDrop(s, 'red', c, 'play').type).toBe('MoveObject');
    expect(applyCommand(s, { type: 'MergeTokens', id: 'red', targetId: token.id })).toBe(s);
    const twin: TokenObject = { ...other, id: 'twin', color: token.color };
    s = applyCommand(s, { type: 'AddObject', object: twin });
    expect(resolveDrop(s, 'twin', c, 'play', { free: true }).type).toBe('MoveObject');
    expect(findHoverTarget(s, 'twin', { x: c.x + twin.width / 2, y: c.y + twin.height / 2 })?.id).toBe(token.id);
  });

  it('a card picked from the list is drawn next to the holder', () => {
    let s = tableOf(fixtureGame());
    const deck = deckOf(s);
    const target = deck.cards[3];
    const cmd = drawPickedCardCommand(deck, target.id)! as Extract<Command, { type: 'DrawCard' }>;
    expect(cmd).toMatchObject({ type: 'DrawCard', index: 3, position: { x: deck.position.x + deck.width + 24, y: deck.position.y } });
    s = applyCommand(s, cmd);
    expect(deckOf(s).cards.map((c) => c.id)).not.toContain(target.id);
    expect(cardsOnTable(s).find((c) => c.id === cmd.cardId)?.cardDefId).toBe(target.id);
    expect(drawPickedCardCommand(deckOf(s), target.id)).toBeNull();
  });

  it('flips one card inside a holder in place; drawing all of a pile removes it', () => {
    let s = tableOf(fixtureGame());
    const deck = deckOf(s);
    const [first, second] = deck.cards;
    s = applyCommand(s, { type: 'FlipDeckCard', deckId: deck.id, cardId: second.id });
    expect(deckOf(s).cards[1].faceUp).toBe(!(second.faceUp ?? false));
    expect(deckOf(s).cards[0]).toBe(first);
    expect(deckOf(s).cards.map((c) => c.id)).toEqual(deck.cards.map((c) => c.id));
    expect(applyCommand(s, { type: 'FlipDeckCard', deckId: deck.id, cardId: 'missing' })).toBe(s);

    s = applyCommand(s, { type: 'DrawCards', deckId: deck.id, pileId: 'p1', position: { x: 0, y: 900 }, count: 3 });
    s = applyCommand(s, { type: 'DrawCards', deckId: 'p1', pileId: 'p2', position: { x: 0, y: 1200 }, count: 5 });
    expect(s.objects.some((o) => o.id === 'p1')).toBe(false);
    expect((s.objects.find((o) => o.id === 'p2') as DeckObject).cards).toHaveLength(3);
  });

  it('a card or pile dropped on a spread holder goes where it was dropped; the layout opens a gap there', () => {
    let s = tableOf(fixtureGame());
    const id = deckOf(s).id;
    s = applyCommand(s, { type: 'UpdateObject', id, patch: { layout: 'spread', width: 700 } });
    const spread = () => s.objects.find((o) => o.id === id) as DeckObject;
    const ids = spread().cards.map((c) => c.id);
    const slots = cardSlots(s.objects, spread());
    const at = (x: number) => ({ x: spread().position.x + x, y: spread().position.y + spread().height / 2 });
    // Left of every card = the bottom; right of every card = the top; between the 2nd and 3rd from the left = index 3.
    expect(spreadInsertIndex(s.objects, spread(), at(1))).toBe(5);
    expect(spreadInsertIndex(s.objects, spread(), at(spread().width - 1))).toBe(0);
    const between = (slots[1].x + slots[1].width / 2 + slots[2].x + slots[2].width / 2) / 2;
    expect(spreadInsertIndex(s.objects, spread(), at(between))).toBe(3);

    const gapped = spreadLayout(s.objects, spread(), 3);
    expect(gapped.gap).toBeDefined();
    const left = gapped.slots.filter((sl) => sl.x < gapped.gap!.x).map((sl) => sl.index);
    expect(left).toEqual([4, 3]);
    expect(spreadLayout(s.objects, spread()).gap).toBeUndefined();

    const draw = drawCardCommand(deckOf(s), { x: 0, y: 2000 }, 0)! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, draw);
    const card = cardsOnTable(s).find((c) => c.id === draw.cardId)!;
    // Four cards left; between the 2nd and 3rd from the left of the new layout = index 2.
    const s4 = cardSlots(s.objects, spread());
    const center = at((s4[1].x + s4[1].width / 2 + s4[2].x + s4[2].width / 2) / 2);
    const drop = resolveDrop(s, card.id, { x: center.x - card.width / 2, y: center.y - card.height / 2 }, 'play');
    expect(drop).toMatchObject({ type: 'AddCardToDeck', deckId: id, index: 2 });
    s = applyCommand(s, drop);
    expect(spread().cards.map((c) => c.id)).toEqual([ids[1], ids[2], ids[0], ids[3], ids[4]]);

    // A pile dropped into the middle keeps its order there.
    s = applyCommand(s, { type: 'DrawCards', deckId: id, pileId: 'pile', position: { x: 0, y: 2000 }, count: 2 });
    s = applyCommand(s, { type: 'MergePileIntoDeck', pileId: 'pile', deckId: id, index: 1 });
    expect(spread().cards.map((c) => c.id)).toEqual([ids[0], ids[1], ids[2], ids[3], ids[4]]);
    // Stacked holders keep putting cards on top.
    s = applyCommand(s, { type: 'UpdateObject', id, patch: { layout: 'stack' } });
    const d2 = drawCardCommand(deckOf(s), { x: 0, y: 2000 }, 0)! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, d2);
    const c2 = cardsOnTable(s).find((c) => c.id === d2.cardId)!;
    expect(resolveDrop(s, c2.id, { ...spread().position }, 'play')).not.toHaveProperty('index');
  });

  it('flips the whole deck: reverses the order and turns every card over', () => {
    let s = tableOf(fixtureGame());
    const ids = deckOf(s).cards.map((c) => c.id);
    s = applyCommand(s, { type: 'FlipDeck', id: deckOf(s).id });
    expect(deckOf(s).cards.map((c) => c.id)).toEqual([...ids].reverse());
    expect(deckOf(s).cards.every((c) => c.faceUp === true)).toBe(true);
    s = applyCommand(s, { type: 'FlipDeck', id: deckOf(s).id });
    expect(deckOf(s).cards.map((c) => c.id)).toEqual(ids);
    expect(deckOf(s).cards.every((c) => c.faceUp === false)).toBe(true);
  });

  it('holders keep every card’s side, and "cards come out" decides the side when drawn', () => {
    let s = tableOf(fixtureGame());
    s = applyCommand(s, { type: 'UpdateObject', id: deckOf(s).id, patch: { drawSide: 'keep' } });
    const card = byKind(s, 'card') as CardObject;
    for (const cards of [[], deckOf(s).cards]) {
      const base = applyCommand(s, { type: 'UpdateObject', id: deckOf(s).id, patch: { cards } });
      const up = applyCommand(base, { type: 'AddCardToDeck', cardId: card.id, deckId: deckOf(s).id });
      expect(deckOf(up).cards[0].faceUp).toBe(true);
      expect(deckOf(up).cards).toHaveLength(cards.length + 1);
      const down = applyCommand(applyCommand(base, { type: 'FlipCard', id: card.id }), {
        type: 'AddCardToDeck',
        cardId: card.id,
        deckId: deckOf(s).id,
      });
      expect(deckOf(down).cards[0].faceUp).toBe(false);
    }
    // "As they lie": the face-up card comes out face up; the deck's own (side-less) cards lie face down.
    s = applyCommand(s, { type: 'AddCardToDeck', cardId: card.id, deckId: deckOf(s).id });
    expect(drawCardCommand(deckOf(s))).toMatchObject({ faceUp: true });
    expect(drawCardCommand(deckOf(s), undefined, 1)).toMatchObject({ faceUp: false });
    // A fixed setting always wins, whatever side the card lies on.
    s = applyCommand(s, { type: 'UpdateObject', id: deckOf(s).id, patch: { drawSide: 'faceDown' } });
    expect(drawCardCommand(deckOf(s))).toMatchObject({ faceUp: false });
    s = applyCommand(s, { type: 'UpdateObject', id: deckOf(s).id, patch: { drawSide: 'faceUp' } });
    expect(drawCardCommand(deckOf(s), undefined, 1)).toMatchObject({ faceUp: true });
  });

  it('highlights the holder under any dragged piece, but holders and boards highlight nothing', () => {
    const s = tableOf(fixtureGame());
    const holder = holderOf(s);
    const inside = { x: holder.position.x + 10, y: holder.position.y + 10 };
    for (const kind of ['card', 'die', 'token', 'counter'] as const) {
      expect(findHoverTarget(s, byKind(s, kind).id, inside)?.id).toBe(holder.id);
    }
    expect(findHoverTarget(s, byKind(s, 'die').id, { x: -5000, y: -5000 })).toBeUndefined();
    expect(findHoverTarget(s, holder.id, inside)).toBeUndefined();
    expect(findHoverTarget(s, deckOf(s).id, inside)).toBeUndefined();
    expect(findHoverTarget(s, byKind(s, 'card').id, { x: deckOf(s).position.x + 5, y: deckOf(s).position.y + 5 })?.id).toBe(deckOf(s).id);
  });

  it('new holders (decks too) are gray, unlabelled, stacked, draw cards as they lie, and leave a margin around their cards', () => {
    const h = createObject('deck', { center: { x: 0, y: 0 }, zIndex: 1 });
    expect(h).toMatchObject({
      name: 'Holder',
      label: '',
      color: '#8a8f98',
      layout: 'stack',
      drawSide: 'keep',
      isPile: false,
      cards: [],
      width: CARD_SIZE.width + 2 * HOLDER_MARGIN,
      height: CARD_SIZE.height + 2 * HOLDER_MARGIN,
      cardWidth: CARD_SIZE.width,
      cardHeight: CARD_SIZE.height,
    });
    // Making the zone bigger doesn't make its cards bigger.
    expect(cardSizeOf({ ...h, width: 600, height: 400 })).toEqual(CARD_SIZE);
    // A fresh deck lies face down, so it draws face down until it is flipped or set otherwise.
    const deck = { ...h, cards: [createCardDef()] };
    expect(drawCardCommand(deck)).toMatchObject({ faceUp: false });
  });

  it('a card keeps its size and back when put into, shown in and drawn from another deck', () => {
    let s = tableOf(fixtureGame());
    const deckA = deckOf(s);
    const sizeA = cardSizeOf(deckA);
    // A second deck with larger cards and its own back image.
    const deckB: DeckObject = {
      ...deckA,
      id: 'deck-b',
      name: 'B',
      position: { x: 2000, y: 0 },
      width: 230,
      height: 330,
      cardWidth: 200,
      cardHeight: 300,
      backAssetId: 'back-b',
      backColor: '#aa0000',
      cards: [],
      initialCards: [],
    };
    s = applyCommand(s, { type: 'AddObject', object: deckB });
    const draw = drawCardCommand(deckOf(s))! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, draw);
    const drawn = cardsOnTable(s).find((c) => c.id === draw.cardId)!;
    expect(drawn).toMatchObject({ ...sizeA, backColor: deckA.backColor });
    expect(drawn.backAssetId).toBeUndefined();

    s = applyCommand(s, resolveDrop(s, drawn.id, { x: deckB.position.x + 10, y: deckB.position.y + 10 }, 'play'));
    const inB = (s.objects.find((o) => o.id === 'deck-b') as DeckObject).cards[0];
    expect(inB.id).toBe(drawn.cardDefId);
    expect(resolveCardLook(inB, deckB, ownerDeckOf(s.objects, inB.id))).toMatchObject({
      ...sizeA,
      backAssetId: undefined,
      backColor: deckA.backColor,
    });

    const again = drawCardCommand(s.objects.find((o) => o.id === 'deck-b') as DeckObject)! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, again);
    const redrawn = cardsOnTable(s).find((c) => c.id === again.cardId)!;
    expect(redrawn).toMatchObject({ ...sizeA, backColor: deckA.backColor });
    expect(redrawn.backAssetId).toBeUndefined();

    // Back home, the card follows its own deck's size again (no stored override).
    s = applyCommand(s, { type: 'AddCardToDeck', cardId: redrawn.id, deckId: deckA.id });
    expect(deckOf(s).cards[0]).not.toHaveProperty('width');
  });

  it('cards dropped on a holder go into it; other pieces take its rotation when it asks for that', () => {
    let s = tableOf(fixtureGame());
    const holder = holderOf(s);
    s = applyCommand(s, { type: 'UpdateObject', id: holder.id, patch: { rotation: 90, alignRotation: true } });
    const card = byKind(s, 'card') as CardObject;
    const hc = { x: holder.position.x + holder.width / 2, y: holder.position.y + holder.height / 2 };
    const drop = resolveDrop(s, card.id, { x: hc.x - card.width / 2, y: hc.y - card.height / 2 }, 'play');
    expect(drop).toMatchObject({ type: 'AddCardToDeck', deckId: holder.id });

    const token = byKind(s, 'token');
    expect(resolveDrop(s, token.id, { x: hc.x - token.width / 2, y: hc.y - token.height / 2 }, 'play')).toMatchObject({
      type: 'MoveObject',
      rotation: 90,
    });
    s = applyCommand(s, { type: 'UpdateObject', id: holder.id, patch: { alignRotation: false } });
    expect(resolveDrop(s, token.id, { x: hc.x - token.width / 2, y: hc.y - token.height / 2 }, 'play')).not.toHaveProperty('rotation');
    // A holder dropped on another holder just moves.
    expect(resolveDrop(s, deckOf(s).id, { ...holder.position }, 'edit')).toMatchObject({ type: 'MoveObject', toFront: false });
  });

  it('a spread holder lays its cards out (top card right-most) and lets any card be drawn', () => {
    let s = tableOf(fixtureGame());
    const id = deckOf(s).id;
    s = applyCommand(s, { type: 'UpdateObject', id, patch: { layout: 'spread', width: 600 } });
    const spread = () => s.objects.find((o) => o.id === id) as DeckObject;
    const slots = cardSlots(s.objects, spread());
    expect(slots.map((sl) => sl.index)).toEqual([4, 3, 2, 1, 0]);
    expect(new Set(slots.map((sl) => sl.y)).size).toBe(1);
    expect(slots[4].x).toBeGreaterThan(slots[0].x);
    // Pointing at the second card from the left picks index 3.
    const sl = slots[1];
    const p = { x: spread().position.x + sl.x + 5, y: spread().position.y + sl.y + sl.height / 2 };
    expect(cardIndexAt(s.objects, spread(), p)).toBe(3);
    expect(cardIndexAt(s.objects, spread(), { x: spread().position.x + 1, y: spread().position.y + 1 })).toBeNull();
    const target = spread().cards[3];
    const draw = drawCardCommand(spread(), { x: 0, y: 2000 }, 3)!;
    s = applyCommand(s, draw);
    expect(cardsOnTable(s).some((c) => c.cardDefId === target.id)).toBe(true);
    expect(spread().cards.map((c) => c.id)).not.toContain(target.id);
    // A stack only offers its top card.
    s = applyCommand(s, { type: 'UpdateObject', id, patch: { layout: 'stack' } });
    expect(cardSlots(s.objects, spread()).map((x) => x.index)).toEqual([0]);
  });

  it('a spread runs down a tall holder (top card bottom-most) and takes drops where they land', () => {
    let s = tableOf(fixtureGame());
    const id = deckOf(s).id;
    s = applyCommand(s, { type: 'UpdateObject', id, patch: { layout: 'spread', width: 160, height: 800 } });
    const spread = () => s.objects.find((o) => o.id === id) as DeckObject;
    const slots = cardSlots(s.objects, spread());
    expect(slots.map((sl) => sl.index)).toEqual([4, 3, 2, 1, 0]);
    expect(new Set(slots.map((sl) => sl.x)).size).toBe(1);
    expect(slots[4].y).toBeGreaterThan(slots[0].y);
    const at = (y: number) => ({ x: spread().position.x + spread().width / 2, y: spread().position.y + y });
    expect(spreadInsertIndex(s.objects, spread(), at(1))).toBe(5);
    expect(spreadInsertIndex(s.objects, spread(), at(spread().height - 1))).toBe(0);
    const gapped = spreadLayout(s.objects, spread(), 5);
    expect(gapped.gap!.y).toBeLessThan(gapped.slots[0].y);
  });

  it('a holder can show its cards sideways; they still come out upright', () => {
    let s = tableOf(fixtureGame());
    const id = deckOf(s).id;
    const size = cardSizeOf(deckOf(s));
    s = applyCommand(s, { type: 'UpdateObject', id, patch: { layout: 'spread', width: 900, height: 200, cardsSideways: true } });
    const holder = () => s.objects.find((o) => o.id === id) as DeckObject;
    const slots = cardSlots(s.objects, holder());
    expect(slots.every((sl) => sl.width === size.height && sl.height === size.width)).toBe(true);
    expect(new Set(slots.map((sl) => sl.y)).size).toBe(1);
    const draw = drawCardCommand(holder())! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, draw);
    const card = cardsOnTable(s).find((c) => c.id === draw.cardId)!;
    expect([card.width, card.height, card.rotation]).toEqual([size.width, size.height, 0]);
    // Piles never lie sideways.
    expect(cardSlots(s.objects, { ...holder(), isPile: true, layout: 'stack' })[0].width).toBe(size.width);
  });

  it('hover zoom is per object; cards inherit their deck setting unless they have their own', () => {
    let s = tableOf(fixtureGame());
    const draw = drawCardCommand(deckOf(s))! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, draw);
    const card = () => cardsOnTable(s).find((c) => c.id === draw.cardId)!;
    expect(effectiveHoverZoom(s, card())).toBe('off');
    expect(effectiveHoverZoom(s, byKind(s, 'token'))).toBe('off');
    s = applyCommand(s, { type: 'UpdateObject', id: deckOf(s).id, patch: { hoverZoom: 'large' } });
    expect(effectiveHoverZoom(s, deckOf(s))).toBe('large');
    expect(effectiveHoverZoom(s, card())).toBe('large');
    s = applyCommand(s, { type: 'UpdateObject', id: draw.cardId, patch: { hoverZoom: 'off' } });
    expect(effectiveHoverZoom(s, card())).toBe('off');
    s = applyCommand(s, { type: 'UpdateObject', id: byKind(s, 'board').id, patch: { hoverZoom: 'small' } });
    expect(effectiveHoverZoom(s, byKind(s, 'board'))).toBe('small');
  });

  it('a holder without its own hover zoom uses the setting of the deck its shown card belongs to', () => {
    let s = tableOf(fixtureGame());
    s = applyCommand(s, { type: 'UpdateObject', id: deckOf(s).id, patch: { hoverZoom: 'medium' } });
    const draw = drawCardCommand(deckOf(s))! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, draw);
    s = applyCommand(s, { type: 'AddCardToDeck', cardId: draw.cardId, deckId: holderOf(s).id });
    const cardId = holderOf(s).cards[0].id;
    expect(effectiveHoverZoom(s, holderOf(s))).toBe('medium');
    expect(effectiveHoverZoom(s, holderOf(s), cardId)).toBe('medium');
    expect(effectiveHoverZoom(s, holderOf(s), 'missing')).toBe('off');
    s = applyCommand(s, { type: 'UpdateObject', id: holderOf(s).id, patch: { hoverZoom: 'off' } });
    expect(effectiveHoverZoom(s, holderOf(s), cardId)).toBe('off');
  });

  it('a pile dropped on a deck goes on top of it in order, keeping each card’s look; the pile disappears', () => {
    let s = tableOf(fixtureGame());
    // Draw two cards and stack them into a pile on the table.
    const d1 = drawCardCommand(deckOf(s), { x: 0, y: 1000 })! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, d1);
    const d2 = drawCardCommand(deckOf(s), { x: 0, y: 1000 })! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, d2);
    s = applyCommand(s, { type: 'MergeCards', cardId: d2.cardId, targetCardId: d1.cardId, pileId: 'pile' });
    const pile = s.objects.find((o) => o.id === 'pile') as DeckObject;
    const pileOrder = pile.cards.map((c) => c.id);
    expect(pileOrder).toHaveLength(2);

    // Hovering the deck highlights it; dropping merges.
    const deck = deckOf(s);
    const over = { x: deck.position.x + 5, y: deck.position.y + 5 };
    expect(findHoverTarget(s, 'pile', { x: over.x + pile.width / 2, y: over.y + pile.height / 2 })?.id).toBe(deck.id);
    const drop = resolveDrop(s, 'pile', over, 'play');
    expect(drop).toMatchObject({ type: 'MergePileIntoDeck', pileId: 'pile', deckId: deck.id, asDefinition: false });
    const before = deckOf(s).cards.map((c) => c.id);
    s = applyCommand(s, drop);
    expect(s.objects.some((o) => o.id === 'pile')).toBe(false);
    expect(deckOf(s).cards.map((c) => c.id)).toEqual([...pileOrder, ...before]);
    // The cards keep the side they had in the pile.
    expect(
      deckOf(s)
        .cards.slice(0, 2)
        .every((c) => c.faceUp === true),
    ).toBe(true);
    // Free (Shift) drops never merge.
    expect(resolveDrop(s, deck.id, over, 'play', { free: true }).type).toBe('MoveObject');
  });

  it('a pile dropped on another pile keeps every card’s side; in Edit mode on a deck it joins the definition', () => {
    let s = tableOf(fixtureGame());
    const make = (id: string, y: number) => {
      const a = drawCardCommand(deckOf(s), { x: 0, y })! as Extract<Command, { type: 'DrawCard' }>;
      s = applyCommand(s, a);
      const b = drawCardCommand(deckOf(s), { x: 0, y })! as Extract<Command, { type: 'DrawCard' }>;
      s = applyCommand(s, b);
      s = applyCommand(s, { type: 'FlipCard', id: b.cardId });
      s = applyCommand(s, { type: 'MergeCards', cardId: b.cardId, targetCardId: a.cardId, pileId: id });
    };
    make('p1', 1000);
    make('p2', 2000);
    const p2 = () => s.objects.find((o) => o.id === 'p2') as DeckObject;
    const sides = (s.objects.find((o) => o.id === 'p1') as DeckObject).cards.map((c) => c.faceUp);
    s = applyCommand(s, resolveDrop(s, 'p1', { ...p2().position }, 'play'));
    expect(p2().cards).toHaveLength(4);
    expect(
      p2()
        .cards.slice(0, 2)
        .map((c) => c.faceUp),
    ).toEqual(sides);

    // A pile of a foreign deck dropped on a different deck in Edit mode moves the definitions over.
    const other: DeckObject = { ...deckOf(s), id: 'other', name: 'Other', position: { x: 5000, y: 0 }, cards: [], initialCards: [] };
    s = applyCommand(s, { type: 'AddObject', object: other });
    const ids = p2().cards.map((c) => c.id);
    const drop = resolveDrop(s, 'p2', { x: 5000, y: 0 }, 'edit');
    expect(drop).toMatchObject({ type: 'MergePileIntoDeck', deckId: 'other', asDefinition: true });
    s = applyCommand(s, drop);
    const merged = s.objects.find((o) => o.id === 'other') as DeckObject;
    expect(merged.initialCards.map((c) => c.id)).toEqual(ids);
    expect(deckOf(s).initialCards.some((c) => ids.includes(c.id))).toBe(false);
  });

  it('a pile dropped on a holder goes into it', () => {
    let s = tableOf(fixtureGame());
    const holder = holderOf(s);
    const a = drawCardCommand(deckOf(s), { x: 0, y: 1000 })! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, a);
    const b = drawCardCommand(deckOf(s), { x: 0, y: 1000 })! as Extract<Command, { type: 'DrawCard' }>;
    s = applyCommand(s, b);
    s = applyCommand(s, { type: 'MergeCards', cardId: b.cardId, targetCardId: a.cardId, pileId: 'pile' });
    const drop = resolveDrop(s, 'pile', { x: holder.position.x + 2, y: holder.position.y + 2 }, 'play');
    expect(drop).toMatchObject({ type: 'MergePileIntoDeck', deckId: holder.id });
    s = applyCommand(s, drop);
    expect(holderOf(s).cards).toHaveLength(2);
    expect(s.objects.some((o) => o.id === 'pile')).toBe(false);
  });

  it('taking the whole stack lifts every card out as a pile; the holder stays where it is', () => {
    let s = tableOf(fixtureGame());
    const deck = deckOf(s);
    const ids = deck.cards.map((c) => c.id);
    const cmd = takeStackCommand(s.objects, deck, { x: 0, y: 2000 })!;
    expect(cmd).toMatchObject({ type: 'TakeStack', deckId: deck.id });
    s = applyCommand(s, cmd);
    expect(deckOf(s).cards).toHaveLength(0);
    expect(deckOf(s).position).toEqual(deck.position);
    const [pile] = s.objects.filter((o): o is DeckObject => o.kind === 'deck' && o.isPile);
    expect(pile.cards.map((c) => c.id)).toEqual(ids);
    expect(pile).toMatchObject({ ...cardSizeOf(deck), zIndex: Math.max(...s.objects.filter((o) => o !== pile).map((o) => o.zIndex)) + 1 });
    expect(pile.position.x + pile.width / 2).toBeCloseTo(0, 0);
    expect(pile.position.y + pile.height / 2).toBeCloseTo(2000, 0);
    // Replaying is a no-op; dropping the pile back on its holder puts the cards back in order.
    expect(applyCommand(s, cmd)).toBe(s);
    s = applyCommand(s, resolveDrop(s, pile.id, { ...deck.position }, 'play'));
    expect(deckOf(s).cards.map((c) => c.id)).toEqual(ids);
    // A single card is simply drawn; an empty holder gives nothing.
    const one = { ...deck, cards: deck.cards.slice(0, 1) };
    expect(takeStackCommand(s.objects, one, { x: 0, y: 0 })).toMatchObject({ type: 'DrawCard' });
    expect(takeStackCommand(s.objects, { ...deck, cards: [] }, { x: 0, y: 0 })).toBeNull();
  });

  it('boards and holders only move in Edit mode unless set to be movable in Play mode; boards start unlocked', () => {
    const s = tableOf(fixtureGame());
    const board = byKind(s, 'board');
    expect(createObject('board', { center: { x: 0, y: 0 }, zIndex: 1 }).locked).toBe(false);
    expect(fixedInPlay(board)).toBe(true);
    expect(fixedInPlay({ ...board, playMovable: true } as typeof board)).toBe(false);
    expect(fixedInPlay(holderOf(s))).toBe(true);
    expect(fixedInPlay({ ...holderOf(s), playMovable: true })).toBe(false);
    expect(fixedInPlay(byKind(s, 'token'))).toBe(false);
    expect(fixedInPlay({ ...deckOf(s), isPile: true })).toBe(false);
  });
});

describe('history', () => {
  it('undoes and redoes move, flip, stroke and counter', () => {
    const s0 = tableOf(fixtureGame());
    const card = byKind(s0, 'card');
    const counter = byKind(s0, 'counter');
    const cmds: Command[] = [
      { type: 'MoveObject', id: card.id, position: { x: 1, y: 1 } },
      { type: 'FlipCard', id: card.id },
      { type: 'AddStroke', stroke: stroke('s', [0, 0, 5, 5]) },
      { type: 'IncrementCounter', id: counter.id, delta: 1 },
    ];
    let h = createHistory(s0);
    const states = [s0];
    for (const c of cmds) {
      h = pushHistory(h, applyCommand(h.present, c));
      states.push(h.present);
    }
    for (let i = cmds.length - 1; i >= 0; i--) {
      h = undoHistory(h);
      expect(h.present).toBe(states[i]);
    }
    expect(undoHistory(h)).toBe(h);
    for (let i = 1; i <= cmds.length; i++) {
      h = redoHistory(h);
      expect(h.present).toBe(states[i]);
    }
    expect(redoHistory(h)).toBe(h);
  });

  it('caps history length and ignores no-ops', () => {
    const s0 = tableOf(fixtureGame());
    const counter = byKind(s0, 'counter');
    let h = createHistory(s0);
    expect(pushHistory(h, h.present)).toBe(h);
    for (let i = 0; i < HISTORY_LIMIT + 30; i++) {
      h = pushHistory(h, applyCommand(h.present, { type: 'UpdateObject', id: counter.id, patch: { name: `n${i}` } }));
    }
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });

  it('new commands clear the redo stack', () => {
    const s0 = tableOf(fixtureGame());
    const card = byKind(s0, 'card');
    let h = pushHistory(createHistory(s0), applyCommand(s0, { type: 'FlipCard', id: card.id }));
    h = undoHistory(h);
    expect(h.future).toHaveLength(1);
    h = pushHistory(h, applyCommand(h.present, { type: 'MoveObject', id: card.id, position: { x: 3, y: 3 } }));
    expect(h.future).toHaveLength(0);
  });
});
