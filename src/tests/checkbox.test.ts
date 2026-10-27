import { describe, expect, it } from 'vitest';
import { applyCommand } from '../domain/commands';
import { canPick, createStep, describeStep, planButton } from '../domain/buttons';
import { createObject } from '../domain/objects';
import { parseGame } from '../domain/schema';
import type { ButtonObject, ButtonStep, CheckboxObject, CheckStep, TableState, TabletopObject } from '../domain/types';
import { fixtureGame, tableOf } from './fixtures';

const get = <T extends TabletopObject>(s: TableState, id: string) => s.objects.find((o) => o.id === id) as T;

function setup() {
  const game = fixtureGame();
  const board = game.objects.find((o) => o.kind === 'board')!;
  // Two checkboxes on the board (one checked), one elsewhere.
  const a: CheckboxObject = { ...createObject('checkbox', { center: { x: 0, y: 0 }, zIndex: 50 }), name: 'A' };
  const b: CheckboxObject = { ...createObject('checkbox', { center: { x: 100, y: 100 }, zIndex: 51 }), name: 'B', checked: true };
  const far: CheckboxObject = { ...createObject('checkbox', { center: { x: 3000, y: 3000 }, zIndex: 52 }), name: 'Far' };
  const button = createObject('button', { center: { x: 0, y: 900 }, zIndex: 99 });
  game.objects.push(a, b, far, button);
  return { state: tableOf(game), board, a, b, far, button, game };
}

const check = (ids: string[], mode: CheckStep['mode']): ButtonStep => ({ ...createStep('check'), objectIds: ids, mode }) as CheckStep;

function run(state: TableState, button: ButtonObject, steps: ButtonStep[]): TableState {
  const cmd = planButton(state, { ...button, steps });
  return cmd ? applyCommand(state, cmd) : state;
}

describe('checkboxes', () => {
  it('start unchecked with a square box and a checkmark', () => {
    const c = createObject('checkbox', { center: { x: 0, y: 0 }, zIndex: 1 });
    expect(c).toMatchObject({ checked: false, mark: 'check', boxShape: 'square', name: 'Checkbox' });
  });

  it('toggle, check and uncheck with an automation step', () => {
    const { state, a, b, button } = setup();
    const toggled = run(state, button, [check([a.id, b.id], 'toggle')]);
    expect(get<CheckboxObject>(toggled, a.id).checked).toBe(true);
    expect(get<CheckboxObject>(toggled, b.id).checked).toBe(false);
    const checked = run(state, button, [check([a.id, b.id], 'check')]);
    expect([a.id, b.id].map((id) => get<CheckboxObject>(checked, id).checked)).toEqual([true, true]);
    // Nothing to do: no command at all.
    expect(planButton(state, { ...button, steps: [check([b.id], 'check')] })).toBeNull();
  });

  it('treats a board as every checkbox lying on it', () => {
    const { state, board, a, b, far, button } = setup();
    const cleared = run(state, button, [check([board.id], 'uncheck')]);
    expect(get<CheckboxObject>(cleared, b.id).checked).toBe(false);
    const all = run(state, button, [check([board.id], 'check')]);
    expect(get<CheckboxObject>(all, a.id).checked).toBe(true);
    expect(get<CheckboxObject>(all, far.id).checked).toBe(false);
  });

  it('is offered in the check step, with boards and holders', () => {
    const { state, a, board, button } = setup();
    const holder = state.objects.find((o) => o.kind === 'deck' && !o.isPile)!;
    const st = createStep('check');
    expect(canPick(st, 'objects', a, button.id)).toBe(true);
    expect(canPick(st, 'objects', board, button.id)).toBe(true);
    expect(canPick(st, 'objects', holder, button.id)).toBe(true);
    expect(canPick(createStep('roll'), 'objects', a, button.id)).toBe(false);
    expect(describeStep(state, check([a.id], 'uncheck'))).toBe('Uncheck A');
  });

  it('survive saving and loading', () => {
    const { game, b } = setup();
    const parsed = parseGame(JSON.parse(JSON.stringify(game)));
    expect(parsed.objects.find((o) => o.id === b.id)).toEqual(b);
  });
});

describe('bag defaults', () => {
  it('has no name', () => {
    expect(createObject('bag', { center: { x: 0, y: 0 }, zIndex: 1 }).name).toBe('');
  });
});
