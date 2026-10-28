import { describe, expect, it } from 'vitest';
import { applyCommand } from '../domain/commands';
import { canPick, createStep, describeStep, planButton } from '../domain/buttons';
import { createCardDef, createObject, setAllCardCopies, cardGroups } from '../domain/objects';
import { parseGame } from '../domain/schema';
import { formatSeconds, timerElapsed, timerFinished, timerText, timerToggleCommand, timerToggleLabel } from '../domain/timer';
import type { DeckObject, TableState, TimerObject, TimerStep, TokenObject } from '../domain/types';
import { fixtureGame, tableOf } from './fixtures';

function setup(patch: Partial<TimerObject> = {}) {
  const game = fixtureGame();
  const timer: TimerObject = { ...createObject('timer', { center: { x: 0, y: 0 }, zIndex: 50 }), duration: 60, ...patch };
  game.objects.push(timer);
  return { state: tableOf(game), timer, game };
}

const timerOf = (s: TableState, id: string) => s.objects.find((o) => o.id === id) as TimerObject;

describe('timers', () => {
  it('start paused as a 5-minute countdown that beeps', () => {
    const t = createObject('timer', { center: { x: 0, y: 0 }, zIndex: 1 });
    expect(t).toMatchObject({ mode: 'countdown', duration: 300, elapsedMs: 0, sound: true, name: 'Timer' });
    expect(t.startedAt).toBeUndefined();
    expect(timerText(t, Date.now())).toBe('5:00');
  });

  it('formats times', () => {
    expect(formatSeconds(0)).toBe('0:00');
    expect(formatSeconds(65)).toBe('1:05');
    expect(formatSeconds(3600 + 2 * 60 + 3)).toBe('1:02:03');
  });

  it('start, pause and resume keep the time counted; reset goes back to the start', () => {
    const { state, timer } = setup();
    const started = applyCommand(state, { type: 'StartTimer', id: timer.id, at: 1000 });
    expect(timerOf(started, timer.id).startedAt).toBe(1000);
    // Starting a running timer changes nothing.
    expect(applyCommand(started, { type: 'StartTimer', id: timer.id, at: 5000 })).toBe(started);
    expect(timerText(timerOf(started, timer.id), 11_500)).toBe('0:50');
    const paused = applyCommand(started, { type: 'PauseTimer', id: timer.id, at: 11_000 });
    expect(timerOf(paused, timer.id)).toMatchObject({ elapsedMs: 10_000 });
    expect(timerOf(paused, timer.id).startedAt).toBeUndefined();
    expect(applyCommand(paused, { type: 'PauseTimer', id: timer.id, at: 20_000 })).toBe(paused);
    // While paused time doesn't pass.
    expect(timerElapsed(timerOf(paused, timer.id), 99_000)).toBe(10_000);
    const resumed = applyCommand(paused, { type: 'StartTimer', id: timer.id, at: 50_000 });
    expect(timerElapsed(timerOf(resumed, timer.id), 55_000)).toBe(15_000);
    const reset = applyCommand(resumed, { type: 'ResetTimer', id: timer.id });
    expect(timerOf(reset, timer.id)).toMatchObject({ elapsedMs: 0 });
    expect(timerOf(reset, timer.id).startedAt).toBeUndefined();
    expect(applyCommand(reset, { type: 'ResetTimer', id: timer.id })).toBe(reset);
  });

  it('a countdown stops at 0:00 and starts over when started again', () => {
    const { state, timer } = setup({ duration: 10 });
    const started = applyCommand(state, { type: 'StartTimer', id: timer.id, at: 0 });
    const t = timerOf(started, timer.id);
    expect(timerFinished(t, 9_999)).toBe(false);
    expect(timerText(t, 9_001)).toBe('0:01');
    expect(timerFinished(t, 10_000)).toBe(true);
    expect(timerText(t, 60_000)).toBe('0:00');
    expect(timerToggleLabel(t, 60_000)).toBe('Restart');
    const restarted = applyCommand(started, timerToggleCommand(t, 60_000));
    expect(timerOf(restarted, timer.id)).toMatchObject({ elapsedMs: 0, startedAt: 60_000 });
    // A finished countdown that was paused also starts over.
    const pausedAtEnd = applyCommand(started, { type: 'PauseTimer', id: timer.id, at: 30_000 });
    expect(timerOf(pausedAtEnd, timer.id).elapsedMs).toBe(10_000);
    const again = applyCommand(pausedAtEnd, { type: 'StartTimer', id: timer.id, at: 40_000 });
    expect(timerOf(again, timer.id)).toMatchObject({ elapsedMs: 0, startedAt: 40_000 });
  });

  it('a stopwatch counts up without limit', () => {
    const { state, timer } = setup({ mode: 'stopwatch' });
    const started = applyCommand(state, { type: 'StartTimer', id: timer.id, at: 0 });
    const t = timerOf(started, timer.id);
    expect(timerText(t, 125_900)).toBe('2:05');
    expect(timerFinished(t, 10_000_000)).toBe(false);
    expect(timerToggleLabel(t, 1000)).toBe('Pause');
  });

  it('timers and the new token shapes survive a save', () => {
    const { game, timer } = setup({ startedAt: 1234, elapsedMs: 500, label: 'Round' });
    const pawn: TokenObject = { ...createObject('token', { center: { x: 0, y: 0 }, zIndex: 60 }), shape: 'meeple' };
    game.objects.push(pawn);
    const parsed = parseGame(JSON.parse(JSON.stringify(game)));
    expect(parsed.objects.find((o) => o.id === timer.id)).toEqual({ ...timer, startedAt: 1234, elapsedMs: 500, label: 'Round' });
    expect(parsed.objects.find((o) => o.id === pawn.id)).toMatchObject({ shape: 'meeple' });
  });
});

describe('timer automation step', () => {
  const run = (state: TableState, timerId: string, mode: TimerStep['mode'], now: number) => {
    const button = createObject('button', { center: { x: 0, y: 900 }, zIndex: 99 });
    const step = { ...createStep('timer'), objectIds: [timerId], mode } as TimerStep;
    const cmd = planButton(state, { ...button, steps: [step] }, undefined, now);
    return cmd ? applyCommand(state, cmd) : state;
  };

  it('starts, pauses, toggles, resets and restarts timers at the time the button is clicked', () => {
    const { state, timer } = setup({ duration: 10 });
    expect(createStep('timer')).toMatchObject({ type: 'timer', mode: 'start' });
    const started = run(state, timer.id, 'start', 1000);
    expect(timerOf(started, timer.id).startedAt).toBe(1000);
    // Start on a running timer changes nothing; pause keeps the time counted.
    expect(run(started, timer.id, 'start', 3000)).toBe(started);
    const paused = run(started, timer.id, 'pause', 4000);
    expect(timerOf(paused, timer.id)).toMatchObject({ elapsedMs: 3000 });
    expect(run(paused, timer.id, 'pause', 5000)).toBe(paused);
    const toggled = run(paused, timer.id, 'toggle', 6000);
    expect(timerOf(toggled, timer.id).startedAt).toBe(6000);
    expect(timerOf(run(toggled, timer.id, 'toggle', 7000), timer.id).startedAt).toBeUndefined();
    const reset = run(toggled, timer.id, 'reset', 8000);
    expect(timerOf(reset, timer.id)).toMatchObject({ elapsedMs: 0 });
    expect(timerOf(reset, timer.id).startedAt).toBeUndefined();
    const restarted = run(toggled, timer.id, 'restart', 9000);
    expect(timerOf(restarted, timer.id)).toMatchObject({ elapsedMs: 0, startedAt: 9000 });
  });

  it('start begins a new countdown when the running one ran out', () => {
    const { state, timer } = setup({ duration: 10 });
    const started = run(state, timer.id, 'start', 0);
    const again = run(started, timer.id, 'start', 60_000);
    expect(timerOf(again, timer.id)).toMatchObject({ elapsedMs: 0, startedAt: 60_000 });
  });

  it('only accepts timers, is described and survives a save', () => {
    const { state, timer, game } = setup();
    const step = { ...createStep('timer'), objectIds: [timer.id], mode: 'restart' } as TimerStep;
    expect(describeStep(state, step)).toBe('Restart Timer');
    const button = createObject('button', { center: { x: 0, y: 900 }, zIndex: 99 });
    expect(canPick(step, 'objects', timer, button.id)).toBe(true);
    expect(
      canPick(
        step,
        'objects',
        state.objects.find((o) => o.kind === 'die')!,
        button.id,
      ),
    ).toBe(false);
    game.objects.push({ ...button, steps: [step] });
    const parsed = parseGame(JSON.parse(JSON.stringify(game)));
    expect(parsed.objects.find((o) => o.id === button.id)).toMatchObject({ steps: [step] });
  });
});

describe('copies of every card', () => {
  it('sets the same number of copies for every row of the card list', () => {
    const deck = createObject('deck', { center: { x: 0, y: 0 }, zIndex: 1 });
    const defs = ['A', 'B', 'C'].map((name) => createCardDef({ name, faceText: name }));
    const withCards: DeckObject = {
      ...deck,
      cards: [...defs, { ...defs[1], id: 'b2' }],
      initialCards: [defs[0], defs[1], { ...defs[1], id: 'b2' }, defs[2]],
    };
    const next = setAllCardCopies(withCards, 3)!;
    expect(cardGroups(next.initialCards).map((g) => [g[0].name, g.length])).toEqual([
      ['A', 3],
      ['B', 3],
      ['C', 3],
    ]);
    expect(new Set(next.initialCards.map((c) => c.id)).size).toBe(9);
    expect(next.cards).toHaveLength(9);
    expect(setAllCardCopies({ ...withCards, ...next }, 3)).toBeNull();
    const fewer = setAllCardCopies({ ...withCards, ...next }, 1)!;
    expect(fewer.initialCards.map((c) => c.name)).toEqual(['A', 'B', 'C']);
  });
});
