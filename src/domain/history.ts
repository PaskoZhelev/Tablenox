import type { TableState } from './types';

export const HISTORY_LIMIT = 100;

export interface History {
  past: TableState[];
  present: TableState;
  future: TableState[];
}

export function createHistory(present: TableState): History {
  return { past: [], present, future: [] };
}

/** Records `next` as a new entry. No-op (same reference) states are ignored. */
export function pushHistory(h: History, next: TableState, limit = HISTORY_LIMIT): History {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [] };
}

export function undoHistory(h: History): History {
  if (h.past.length === 0) return h;
  const past = h.past.slice(0, -1);
  return { past, present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redoHistory(h: History): History {
  if (h.future.length === 0) return h;
  const [next, ...future] = h.future;
  return { past: [...h.past, h.present], present: next, future };
}
