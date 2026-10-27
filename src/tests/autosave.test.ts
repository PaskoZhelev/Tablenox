import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosaver, type SaveStatus } from '../persistence/autosave';

describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces saves and reports status transitions', async () => {
    const save = vi.fn(async () => {});
    const statuses: SaveStatus[] = [];
    const a = createAutosaver({ delayMs: 500, save, onStatus: (s) => statuses.push(s) });
    a.markDirty();
    a.markDirty();
    a.markDirty();
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('saved');
    expect(statuses).toContain('saving');
  });

  it('keeps changes dirty and surfaces an error when saving fails (AC12)', async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    const events: { s: SaveStatus; e?: unknown }[] = [];
    const a = createAutosaver({ delayMs: 100, save, onStatus: (s, e) => events.push({ s, e }) });
    a.markDirty();
    await vi.advanceTimersByTimeAsync(150);
    expect(events.at(-1)?.s).toBe('error');
    expect((events.at(-1)!.e as DOMException).name).toBe('QuotaExceededError');
    expect(a.isDirty()).toBe(true);
    fail = false;
    await a.flush();
    expect(events.at(-1)?.s).toBe('saved');
    expect(a.isDirty()).toBe(false);
  });

  it('flush saves immediately and is a no-op when clean', async () => {
    const save = vi.fn(async () => {});
    const a = createAutosaver({ delayMs: 10000, save, onStatus: () => {} });
    await a.flush();
    expect(save).not.toHaveBeenCalled();
    a.markDirty();
    await a.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves again if changes arrive during an in-flight save', async () => {
    let resolveSave: () => void = () => {};
    const save = vi.fn(() => new Promise<void>((r) => (resolveSave = r)));
    const a = createAutosaver({ delayMs: 50, save, onStatus: () => {} });
    a.markDirty();
    await vi.advanceTimersByTimeAsync(60);
    expect(save).toHaveBeenCalledTimes(1);
    a.markDirty();
    resolveSave();
    await vi.advanceTimersByTimeAsync(60);
    resolveSave();
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
