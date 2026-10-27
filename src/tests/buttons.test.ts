import { describe, expect, it } from 'vitest';
import { applyCommand } from '../domain/commands';
import {
  applyPick,
  buttonMaxFontSize,
  canPick,
  createStep,
  describeStep,
  fitFontSize,
  pickedIds,
  planButton,
  resolveTargets,
} from '../domain/buttons';
import { createObject } from '../domain/objects';
import { seededSource } from '../domain/random';
import { parseGame, SchemaError } from '../domain/schema';
import type {
  ButtonObject,
  ButtonStep,
  CardObject,
  CounterObject,
  DeckObject,
  DieObject,
  MoveStep,
  TableState,
  TabletopObject,
} from '../domain/types';
import { fixtureGame, tableOf } from './fixtures';

const byKind = <T extends TabletopObject>(s: TableState, kind: T['kind']) => s.objects.find((o) => o.kind === kind) as T;
const get = <T extends TabletopObject>(s: TableState, id: string) => s.objects.find((o) => o.id === id) as T;
const cardsOnTable = (s: TableState) => s.objects.filter((o): o is CardObject => o.kind === 'card');
const piles = (s: TableState) => s.objects.filter((o): o is DeckObject => o.kind === 'deck' && o.isPile);
const names = (s: TableState, id: string) => get<DeckObject>(s, id).cards.map((c) => c.name);

function setup(...steps: ButtonStep[]) {
  const game = fixtureGame();
  const button = { ...createObject('button', { center: { x: 0, y: 500 }, zIndex: 99 }), steps };
  game.objects.push(button);
  const state = tableOf(game);
  const deck = byKind<DeckObject>(state, 'deck');
  const holder = state.objects.find((o): o is DeckObject => o.kind === 'deck' && o.name === 'Holder')!;
  const die = byKind<DieObject>(state, 'die');
  const counter = byKind<CounterObject>(state, 'counter');
  const card = byKind<CardObject>(state, 'card');
  return { state, button, deck, holder, die, counter, card };
}

function run(state: TableState, button: ButtonObject, seed = 1): TableState {
  const cmd = planButton(state, button, seededSource(seed));
  return cmd ? applyCommand(state, cmd) : state;
}

const step = <T extends ButtonStep>(type: T['type'], ids: string[], patch: Partial<T> = {}) =>
  ({ ...createStep(type), objectIds: ids, ...patch }) as T;

/** Puts `o` on top of `holder` (inside it, stacked above it). */
const onHolder = <T extends TabletopObject>(o: T, holder: DeckObject, dx = 10): T => ({
  ...o,
  position: { x: holder.position.x + dx, y: holder.position.y + 10 },
  zIndex: 50,
});

describe('automation buttons', () => {
  it('does nothing without steps or with missing objects', () => {
    const { state, button } = setup();
    expect(planButton(state, button)).toBeNull();
    const missing = { ...button, steps: [step('roll', ['gone']), step('move', ['gone'], { targetIds: ['nowhere'] })] };
    expect(planButton(state, missing)).toBeNull();
  });

  it('rotates by and to an angle', () => {
    const { state, button, card } = setup();
    const by = {
      ...button,
      steps: [step('rotate', [card.id], { mode: 'by', degrees: 90 }), step('rotate', [card.id], { mode: 'by', degrees: 90 })],
    };
    expect(get(run(state, by), card.id).rotation).toBe(180);
    const to = { ...button, steps: [step('rotate', [card.id], { mode: 'to', degrees: -90 })] };
    expect(get(run(state, to), card.id).rotation).toBe(270);
  });

  it('flips cards (toggle / face up / face down) and the cards of a holder', () => {
    const { state, button, card, deck } = setup();
    expect(card.faceUp).toBe(true);
    const toggled = run(state, { ...button, steps: [step('flip', [card.id], { mode: 'toggle' })] });
    expect(get<CardObject>(toggled, card.id).faceUp).toBe(false);
    const up = run(state, { ...button, steps: [step('flip', [card.id], { mode: 'faceUp' })] });
    expect(up).toBe(state);
    const down = run(state, { ...button, steps: [step('flip', [card.id], { mode: 'faceDown' })] });
    expect(get<CardObject>(down, card.id).faceUp).toBe(false);
    const flipped = run(state, { ...button, steps: [step('flip', [deck.id])] });
    expect(get<DeckObject>(flipped, deck.id).cards.map((c) => c.id)).toEqual(deck.cards.map((c) => c.id).reverse());
  });

  it('flips a holder’s cards as a whole plus the loose cards lying on it', () => {
    const { state, button, deck, holder, card } = setup();
    const filled = { ...holder, cards: deck.cards.map((c) => ({ ...c, faceUp: false })) };
    const s0 = {
      ...state,
      objects: state.objects.map((o) =>
        o.id === holder.id ? filled : o.id === card.id ? { ...onHolder(card, holder), faceUp: false } : o,
      ),
    };
    const up = run(s0, { ...button, steps: [step('flip', [holder.id], { mode: 'faceUp' })] });
    expect(get<CardObject>(up, card.id).faceUp).toBe(true);
    expect(get<DeckObject>(up, holder.id).cards.every((c) => c.faceUp)).toBe(true);
    // The deck elsewhere is untouched; asking for the side already shown changes nothing.
    expect(get(up, deck.id)).toBe(get(s0, deck.id));
    expect(run(up, { ...button, steps: [step('flip', [holder.id], { mode: 'faceUp' })] })).toBe(up);
    const toggled = run(up, { ...button, steps: [step('flip', [holder.id])] });
    expect(get<CardObject>(toggled, card.id).faceUp).toBe(false);
    expect(get<DeckObject>(toggled, holder.id).cards.every((c) => c.faceUp === false)).toBe(true);
  });

  it('shuffles then sorts a holder back into its original order', () => {
    const { state, button, deck } = setup();
    const ids = (s: TableState) => get<DeckObject>(s, deck.id).cards.map((c) => c.id);
    const shuffled = run(state, { ...button, steps: [step('shuffle', [deck.id])] });
    expect(ids(shuffled)).not.toEqual(ids(state));
    expect([...ids(shuffled)].sort()).toEqual([...ids(state)].sort());
    const sorted = run(shuffled, { ...button, steps: [step('sort', [deck.id], { by: 'original' })] });
    expect(ids(sorted)).toEqual(ids(state));
    const byName = run(state, { ...button, steps: [step('shuffle', [deck.id]), step('sort', [deck.id], { by: 'name' })] });
    expect(names(byName, deck.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
  });

  it('rolls dice (also the dice lying on a listed holder) using the supplied random source', () => {
    const { state, button, die, holder } = setup();
    const rolled = run(state, { ...button, steps: [step('roll', [die.id])] }, 7);
    expect(get<DieObject>(rolled, die.id).rollCount).toBe(die.rollCount + 1);
    const again = run(state, { ...button, steps: [step('roll', [die.id])] }, 7);
    expect(get<DieObject>(again, die.id).value).toBe(get<DieObject>(rolled, die.id).value);
    const s0 = { ...state, objects: state.objects.map((o) => (o.id === die.id ? onHolder(die, holder) : o)) };
    expect(get<DieObject>(run(s0, { ...button, steps: [step('roll', [holder.id])] }), die.id).rollCount).toBe(1);
  });

  it('changes counters: add and set, within their limits', () => {
    const { state, button, counter } = setup();
    const add = run(state, { ...button, steps: [step('counter', [counter.id], { mode: 'add', amount: 4 })] });
    expect(get<CounterObject>(add, counter.id).value).toBe(4);
    const capped = run(state, { ...button, steps: [step('counter', [counter.id], { mode: 'add', amount: 99 })] });
    expect(get<CounterObject>(capped, counter.id).value).toBe(10);
    const set = run(add, { ...button, steps: [step('counter', [counter.id], { mode: 'set', amount: 2 })] });
    expect(get<CounterObject>(set, counter.id).value).toBe(2);
  });

  it('moves cards from one holder into another, face down; the holders themselves stay put', () => {
    const { state, button, deck, holder } = setup();
    const move = step<MoveStep>('move', [deck.id], { targetIds: [holder.id], deckMode: 'top', count: 2, orientation: 'faceDown' });
    const next = run(state, { ...button, steps: [move] });
    expect(names(next, deck.id)).toEqual(['C3', 'C4', 'C5']);
    expect(names(next, holder.id)).toEqual(['C1', 'C2']);
    expect(get<DeckObject>(next, holder.id).cards.every((c) => c.faceUp === false)).toBe(true);
    expect(get(next, deck.id).position).toEqual(deck.position);
    expect(get(next, holder.id).position).toEqual(holder.position);
    expect(cardsOnTable(next).filter((c) => c.sourceDeckId === deck.id)).toHaveLength(0);
    expect(piles(next)).toHaveLength(0);
    // A later move puts its card on top.
    const more = run(next, { ...button, steps: [{ ...move, count: 1 }] });
    expect(names(more, holder.id)).toEqual(['C3', 'C1', 'C2']);
  });

  it('a holder without a card count gives up all its cards; top / bottom choose which ones', () => {
    const { state, button, deck, holder } = setup();
    const all = run(state, { ...button, steps: [step('move', [deck.id], { targetIds: [holder.id] })] });
    expect(names(all, holder.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
    expect(get<DeckObject>(all, deck.id).cards).toHaveLength(0);
    expect(get(all, deck.id).position).toEqual(deck.position);
    const bottom = run(state, { ...button, steps: [step('move', [deck.id], { targetIds: [holder.id], deckMode: 'bottom', count: 2 })] });
    expect(names(bottom, holder.id)).toEqual(['C4', 'C5']);
  });

  it('moves a table card into a holder and centres a token on a holder', () => {
    const { state, button, holder, card } = setup();
    const token = byKind(state, 'token');
    const next = run(state, {
      ...button,
      steps: [step('move', [card.id], { targetIds: [holder.id] }), step('move', [token.id], { targetIds: [holder.id] })],
    });
    expect(get(next, card.id)).toBeUndefined();
    expect(get<DeckObject>(next, holder.id).cards).toHaveLength(1);
    expect(get(next, token.id).position.x + token.width / 2).toBeCloseTo(holder.position.x + holder.width / 2, 0);
  });

  it('stacks cards moved onto a non-holder object into one pile (so the count shows)', () => {
    const { state, button, deck } = setup();
    const token = byKind(state, 'token');
    const next = run(state, { ...button, steps: [step('move', [deck.id], { targetIds: [token.id], count: 2 })] });
    expect(piles(next)).toHaveLength(1);
    // Dealt one after the other: the second card ends on top.
    expect(piles(next)[0].cards.map((c) => c.name)).toEqual(['C2', 'C1']);
    const pile = piles(next)[0];
    expect(pile.position.x + pile.width / 2).toBeCloseTo(token.position.x + token.width / 2, 0);
    // A single card stays a card.
    const one = run(state, { ...button, steps: [step('move', [deck.id], { targetIds: [token.id], count: 1 })] });
    expect(piles(one)).toHaveLength(0);
    expect(
      cardsOnTable(one)
        .filter((c) => c.sourceDeckId === deck.id)
        .map((c) => c.name),
    ).toEqual(['C1']);
  });

  it('deals to several destinations in turn: N cards each, or every card when no count is set', () => {
    const { state, button, deck, holder, card } = setup();
    const extra = [1, 2, 3].map((i) => ({
      ...createObject('deck', { center: { x: 2000 + i * 300, y: 0 }, zIndex: 60 + i }),
      name: `H${i}`,
    }));
    const s = { ...state, objects: [...state.objects, ...extra] };
    const targets = [holder.id, ...extra.map((h) => h.id)];
    const one = run(s, { ...button, steps: [step('move', [deck.id], { targetIds: targets, count: 1 })] });
    expect(targets.map((id) => names(one, id))).toEqual([['C1'], ['C2'], ['C3'], ['C4']]);
    expect(names(one, deck.id)).toEqual(['C5']);
    // Without a count the whole deck is dealt round after round; the last card dealt to a holder is on top.
    const all = run(s, { ...button, steps: [step('move', [deck.id], { targetIds: [holder.id, extra[0].id] })] });
    expect(names(all, holder.id)).toEqual(['C5', 'C3', 'C1']);
    expect(names(all, extra[0].id)).toEqual(['C4', 'C2']);
    // Asking for more than there is deals what is left.
    const short = run(s, { ...button, steps: [step('move', [deck.id], { targetIds: targets, count: 2 })] });
    expect(targets.map((id) => get<DeckObject>(short, id).cards.length)).toEqual([2, 1, 1, 1]);
    // Loose cards go one per destination; a destination is never its own source.
    const loose = run(s, { ...button, steps: [step('move', [card.id, holder.id], { targetIds: [extra[1].id, holder.id] })] });
    expect(get<DeckObject>(loose, extra[1].id).cards).toHaveLength(1);
    expect(get(loose, card.id)).toBeUndefined();
  });

  it('recall sends a holder’s foreign cards home, and a deck gathers all of its cards', () => {
    const { state, button, deck, holder } = setup();
    const moved = run(state, { ...button, steps: [step('move', [deck.id], { targetIds: [holder.id], count: 3 })] });
    expect(get<DeckObject>(moved, deck.id).cards).toHaveLength(2);
    const recalled = run(moved, { ...button, steps: [step('recall', [holder.id])] });
    expect(get<DeckObject>(recalled, deck.id).cards).toHaveLength(5);
    expect(get<DeckObject>(recalled, holder.id).cards).toHaveLength(0);
    const gathered = run(moved, { ...button, steps: [step('recall', [deck.id])] });
    expect(get<DeckObject>(gathered, deck.id).cards).toHaveLength(5);
    expect(get<DeckObject>(gathered, holder.id).cards).toHaveLength(0);
  });

  it('lets later steps act on what earlier steps produced', () => {
    const { state, button, deck, holder } = setup();
    const next = run(state, {
      ...button,
      steps: [
        step('move', [deck.id], { targetIds: [holder.id], count: 2, orientation: 'faceDown' }),
        step('flip', [holder.id], { mode: 'faceUp' }),
      ],
    });
    expect(get<DeckObject>(next, holder.id).cards).toHaveLength(2);
    expect(get<DeckObject>(next, holder.id).cards.every((c) => c.faceUp)).toBe(true);
  });

  it('plans one deterministic batch command (random values and new ids are decided while planning)', () => {
    const { state, button, deck, holder, die } = setup();
    const steps = [step('shuffle', [deck.id]), step('move', [deck.id], { targetIds: [holder.id], count: 2 }), step('roll', [die.id])];
    const cmd = planButton(state, { ...button, steps })!;
    expect(cmd.type).toBe('Batch');
    expect(applyCommand(state, cmd)).toEqual(applyCommand(state, cmd));
  });

  it('resolves a holder to itself plus the pieces lying on it, once each', () => {
    const { state, holder, card } = setup();
    const s = { ...state, objects: state.objects.map((o) => (o.id === card.id ? onHolder(card, holder) : o)) };
    expect(resolveTargets(s, [holder.id, card.id]).map((o) => o.id)).toEqual([holder.id, card.id]);
    expect(resolveTargets(s, ['missing'])).toEqual([]);
  });

  it('describes steps', () => {
    const { state, deck, holder } = setup();
    expect(describeStep(state, step('move', [deck.id], { targetIds: [holder.id], deckMode: 'top', count: 2 }))).toBe(
      `Move top 2 cards of ${deck.name} to ${holder.name}`,
    );
    expect(describeStep(state, step('move', [deck.id], { targetIds: [holder.id] }))).toBe(`Move ${deck.name} to ${holder.name}`);
    expect(describeStep(state, step('move', [deck.id], { targetIds: [holder.id, deck.id], count: 1 }))).toBe(
      `Deal top 1 card of ${deck.name} to each of ${holder.name}, ${deck.name}`,
    );
    expect(describeStep(state, step('move', [deck.id], { targetIds: [holder.id, deck.id] }))).toBe(
      `Deal ${deck.name} among ${holder.name}, ${deck.name}`,
    );
    expect(describeStep(state, step('roll', []))).toBe('Roll nothing selected');
  });
});

describe('button label size', () => {
  // A fake font: every character is 0.6 em wide.
  const measure = (s: string, size: number) => s.length * size * 0.6;

  it('uses the largest size that fits, wrapping words, and never exceeds the maximum', () => {
    expect(fitFontSize('Go', 100, 40, 24, measure)).toBe(24);
    const size = fitFontSize('Deal three cards', 100, 40, 40, measure);
    expect(size).toBeLessThan(40);
    // At the chosen size the longest word fits on a line and the wrapped lines fit the height.
    expect(measure('three', size)).toBeLessThanOrEqual(100);
    expect(fitFontSize('Deal three cards', 100, 40, size + 1, measure)).toBe(size);
  });

  it('shrinks a manual size when the button is too small, and follows the height in auto mode', () => {
    expect(fitFontSize('Shuffle', 50, 30, 60, measure)).toBeLessThan(60);
    expect(buttonMaxFontSize({ fontSize: 30, height: 10 })).toBe(30);
    expect(buttonMaxFontSize({ height: 52 })).toBeCloseTo(21.84, 1);
    expect(buttonMaxFontSize({ height: 400 })).toBe(72);
  });
});

describe('picking step objects on the table', () => {
  it('toggles objects and destinations, adding box selections without duplicates', () => {
    const roll = step('roll', ['a']);
    expect(applyPick(roll, 'objects', ['b'], 'toggle').objectIds).toEqual(['a', 'b']);
    expect(applyPick(roll, 'objects', ['a'], 'toggle').objectIds).toEqual([]);
    expect(applyPick(roll, 'objects', ['a', 'b', 'b', 'c'], 'add').objectIds).toEqual(['a', 'b', 'c']);
    expect(applyPick(roll, 'objects', ['a'], 'add')).toBe(roll);
    const move = step<MoveStep>('move', [], { targetIds: ['x'] });
    expect(applyPick(move, 'target', ['y'], 'toggle')).toMatchObject({ targetIds: ['x', 'y'], objectIds: [] });
    expect(applyPick(move, 'target', ['x'], 'toggle')).toMatchObject({ targetIds: [] });
    expect(applyPick(move, 'target', ['x', 'z'], 'add')).toMatchObject({ targetIds: ['x', 'z'] });
    expect(applyPick(move, 'target', ['x'], 'add')).toBe(move);
    expect(pickedIds(move, 'target')).toEqual(['x']);
  });

  it('only accepts objects the step can use, never the button itself', () => {
    const { state, button, die, holder, card } = setup();
    const roll = step('roll', []);
    expect(canPick(roll, 'objects', die, button.id)).toBe(true);
    expect(canPick(roll, 'objects', holder, button.id)).toBe(true);
    expect(canPick(roll, 'objects', card, button.id)).toBe(false);
    expect(canPick(step('rotate', []), 'objects', button, button.id)).toBe(false);
    expect(canPick(step('move', []), 'target', byKind(state, 'token'), button.id)).toBe(true);
    expect(canPick(roll, 'target', die, button.id)).toBe(false);
  });
});

describe('button persistence', () => {
  it('round-trips buttons through the game schema', () => {
    const { state, button } = setup(
      step('move', ['d'], { targetIds: ['h'], deckMode: 'bottom', count: 3, orientation: 'faceUp' }),
      step('rotate', ['d'], { mode: 'to', degrees: 90 }),
      step('sort', ['d'], { by: 'name' }),
      step('counter', ['c'], { mode: 'set', amount: 3 }),
    );
    const sized = { ...button, fontSize: 30 };
    const game = { ...fixtureGame(), objects: [...state.objects.filter((o) => o.id !== button.id), sized] };
    const parsed = byKind<ButtonObject>(tableOf(parseGame(JSON.parse(JSON.stringify(game)))), 'button');
    expect(parsed.steps).toEqual(button.steps);
    expect(parsed.fontSize).toBe(30);
  });

  it("reads a move step's single destination and a holder's sideways flag from earlier builds", () => {
    const { state, button } = setup();
    const old = { ...button, steps: [{ id: 's', type: 'move', objectIds: ['d'], targetId: 'h', deckMode: 'top', orientation: 'keep' }] };
    const game = { ...fixtureGame(), objects: [...state.objects.filter((o) => o.id !== button.id), old] };
    const parsed = byKind<ButtonObject>(tableOf(parseGame(JSON.parse(JSON.stringify(game)))), 'button');
    expect(parsed.steps[0]).toEqual({ id: 's', type: 'move', objectIds: ['d'], targetIds: ['h'], deckMode: 'top', orientation: 'keep' });
    const sideways = { ...game, objects: game.objects.map((o) => (o.kind === 'deck' && !o.isPile ? { ...o, cardsSideways: true } : o)) };
    const decks = parseGame(JSON.parse(JSON.stringify(sideways))).objects.filter((o): o is DeckObject => o.kind === 'deck' && !o.isPile);
    expect(decks.every((d) => d.cardRotation === 90 && !('cardsSideways' in d))).toBe(true);
  });

  it('rejects unknown step types', () => {
    const { state, button } = setup();
    const bad = { ...button, steps: [{ id: 's', type: 'explode', objectIds: [] }] };
    const game = { ...fixtureGame(), objects: [...state.objects.filter((o) => o.id !== button.id), bad] };
    expect(() => parseGame(JSON.parse(JSON.stringify(game)))).toThrow(SchemaError);
  });
});
