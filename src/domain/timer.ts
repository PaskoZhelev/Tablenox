import type { Command } from './commands';
import type { TimerObject } from './types';

export const isTimerRunning = (t: TimerObject): boolean => t.startedAt !== undefined;

/** Milliseconds counted at `now` (a countdown never counts past its duration). */
export function timerElapsed(t: TimerObject, now: number): number {
  const ms = t.elapsedMs + (t.startedAt === undefined ? 0 : Math.max(0, now - t.startedAt));
  return t.mode === 'countdown' ? Math.min(ms, t.duration * 1000) : ms;
}

/** A countdown that has reached zero. */
export function timerFinished(t: TimerObject, now: number): boolean {
  return t.mode === 'countdown' && timerElapsed(t, now) >= t.duration * 1000;
}

/** The time shown: what is left of a countdown (whole seconds rounded up, so 0:00 means done) or a stopwatch's count. */
export function timerText(t: TimerObject, now: number): string {
  const ms = t.mode === 'countdown' ? t.duration * 1000 - timerElapsed(t, now) : timerElapsed(t, now);
  const total = t.mode === 'countdown' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  return formatSeconds(total);
}

/** `m:ss`, or `h:mm:ss` from an hour up. */
export function formatSeconds(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Start / pause button: a finished countdown starts over, a running timer pauses, a paused one starts. */
export function timerToggleCommand(t: TimerObject, now: number): Command {
  if (timerFinished(t, now))
    return {
      type: 'Batch',
      commands: [
        { type: 'ResetTimer', id: t.id },
        { type: 'StartTimer', id: t.id, at: now },
      ],
    };
  return isTimerRunning(t) ? { type: 'PauseTimer', id: t.id, at: now } : { type: 'StartTimer', id: t.id, at: now };
}

export function timerToggleLabel(t: TimerObject, now: number): 'Start' | 'Pause' | 'Restart' {
  if (timerFinished(t, now)) return 'Restart';
  return isTimerRunning(t) ? 'Pause' : 'Start';
}
