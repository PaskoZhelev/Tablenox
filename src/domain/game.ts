import { DEFAULT_CAMERA } from './camera';
import { newId, nowIso } from './ids';
import { SCHEMA_VERSION, type Game, type TableState } from './types';

export function emptyTable(): TableState {
  return { objects: [], annotations: { strokes: [], text: [] } };
}

export function createGame(title = 'Untitled game'): Game {
  const now = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    objects: [],
    camera: { ...DEFAULT_CAMERA },
    annotations: { strokes: [], text: [] },
  };
}

export function gameTable(g: Game): TableState {
  return { objects: g.objects, annotations: g.annotations };
}

export function duplicateGame(g: Game): Game {
  const now = nowIso();
  return { ...structuredClone(g), id: newId(), title: `${g.title} (copy)`, createdAt: now, updatedAt: now };
}
