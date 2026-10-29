import { beforeEach, describe, expect, it } from 'vitest';
import { chooseStepCards, pickCardsFromDeck, runButton } from '../canvas/actions';
import { createStep } from '../domain/buttons';
import { createObject } from '../domain/objects';
import type { ButtonObject, ButtonStep, DeckObject, PickStep } from '../domain/types';
import { useTableStore } from '../state/tableStore';
import { useUiStore, type PickRequest } from '../state/uiStore';
import { fixtureGame, tableOf } from './fixtures';

const present = () => useTableStore.getState().history.present;
const deckNamed = (name: string) => present().objects.find((o): o is DeckObject => o.kind === 'deck' && o.name === name)!;
const buttonNow = () => present().objects.find((o): o is ButtonObject => o.kind === 'button')!;
const pastLength = () => useTableStore.getState().history.past.length;

/** Opens the fixture game with a button whose steps are built from the game's "Deck" and "Holder". */
function load(steps: (deck: DeckObject, holder: DeckObject) => ButtonStep[] = () => []) {
  const g = fixtureGame();
  const deck = g.objects.find((o): o is DeckObject => o.kind === 'deck' && o.name === 'Deck')!;
  const holder = g.objects.find((o): o is DeckObject => o.kind === 'deck' && o.name === 'Holder')!;
  const button = { ...createObject('button', { center: { x: 0, y: 500 }, zIndex: 99 }), steps: steps(deck, holder) };
  g.objects.push(button);
  useTableStore.getState().load({ id: g.id, title: g.title, createdAt: g.createdAt }, tableOf(g), g.camera);
  return { button, deck, holder };
}

/** Waits for the open pick dialog, then answers it. */
async function answerPick(answer: (d: PickRequest) => string[] | null): Promise<PickRequest> {
  for (let i = 0; i < 50 && useUiStore.getState().dialog?.kind !== 'pick'; i++) await Promise.resolve();
  const d = useUiStore.getState().dialog;
  if (d?.kind !== 'pick') throw new Error('no pick dialog');
  d.resolve(answer(d));
  return d;
}

const pickStep = (patch: Partial<PickStep>): PickStep => ({ ...(createStep('pick') as PickStep), ...patch });
const firstStep = () => buttonNow().steps[0] as PickStep;

describe('button actions', () => {
  beforeEach(() => {
    useTableStore.getState().unload();
    useUiStore.setState({ dialog: null });
  });

  it('runs a button with preset Pick cards at once, as one undo step', async () => {
    const { button, deck } = load((deck, holder) => [
      pickStep({ objectIds: [deck.id], targetIds: [holder.id], cards: { [deck.id]: [deck.cards[1].id, deck.cards[0].id] } }),
    ]);
    await runButton(button.id);
    expect(useUiStore.getState().dialog).toBeNull();
    expect(deckNamed('Holder').cards.map((c) => c.id)).toEqual([deck.cards[0].id, deck.cards[1].id]);
    expect(pastLength()).toBe(1);
  });

  it('asks for run-time Pick cards; Cancel dispatches nothing', async () => {
    const { button } = load((deck, holder) => [pickStep({ objectIds: [deck.id], targetIds: [holder.id], choose: 'run' })]);
    const running = runButton(button.id);
    const d = await answerPick((req) => [req.items[4].id]);
    await running;
    expect(d.title).toContain('pick card(s) from Deck');
    expect(deckNamed('Holder').cards.map((c) => c.name)).toEqual(['C5']);
    const cancelled = runButton(button.id);
    await answerPick(() => null);
    await cancelled;
    expect(pastLength()).toBe(1);
  });

  it('sets up a Pick step’s cards from the holder’s definition with the current choice selected', async () => {
    const { button, deck } = load((deck) => [pickStep({ id: 'p', objectIds: [deck.id], cards: { [deck.id]: [deck.cards[1].id] } })]);
    // Cards out of the holder are still offered: the definition is what a set-up chooses from.
    useTableStore.getState().dispatch({ type: 'UpdateObject', id: deck.id, patch: { cards: deck.cards.slice(3) } });
    const choosing = chooseStepCards(button.id, 'p', deck.id);
    const d = await answerPick((req) => [req.items[0].id, req.items[2].id]);
    await choosing;
    expect(d.items.map((c) => c.name)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
    expect(d.selectedIds).toEqual([deck.cards[1].id]);
    expect(d.allowEmpty).toBe(true);
    expect(firstStep().cards).toEqual({ [deck.id]: [deck.cards[0].id, deck.cards[2].id] });
    // An empty choice clears it; Cancel keeps it.
    const clearing = chooseStepCards(button.id, 'p', deck.id);
    await answerPick(() => []);
    await clearing;
    expect(firstStep().cards).toBeUndefined();
    const before = pastLength();
    const cancelling = chooseStepCards(button.id, 'p', deck.id);
    await answerPick(() => null);
    await cancelling;
    expect(pastLength()).toBe(before);
  });

  it('ignores a set-up for a holder removed from the step while the dialog was open, and unknown steps', async () => {
    const { button, deck } = load((deck) => [pickStep({ id: 'p', objectIds: [deck.id] })]);
    const choosing = chooseStepCards(button.id, 'p', deck.id);
    await answerPick((req) => {
      useTableStore.getState().dispatch({ type: 'UpdateObject', id: button.id, patch: { steps: [pickStep({ id: 'p', objectIds: [] })] } });
      return [req.items[0].id];
    });
    await choosing;
    expect(firstStep().cards).toBeUndefined();
    await chooseStepCards(button.id, 'missing', deck.id);
    expect(useUiStore.getState().dialog).toBeNull();
  });

  it('Pick card(s)… draws the chosen cards next to the holder (several as one pile)', async () => {
    const { deck } = load();
    const picking = pickCardsFromDeck(deck.id);
    await answerPick((req) => [req.items[0].id, req.items[3].id]);
    await picking;
    const pile = present().objects.find((o): o is DeckObject => o.kind === 'deck' && o.isPile)!;
    expect(pile.cards.map((c) => c.name)).toEqual(['C1', 'C4']);
    expect(deckNamed('Deck').cards).toHaveLength(3);
  });
});
