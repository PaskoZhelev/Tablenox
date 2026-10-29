import { create } from 'zustand';
import { applyCommand, type Command } from '../domain/commands';
import { DEFAULT_CAMERA } from '../domain/camera';
import { createHistory, pushHistory, redoHistory, undoHistory, type History } from '../domain/history';
import { emptyTable } from '../domain/game';
import type { CameraState, Mode, TableState, Vec2 } from '../domain/types';
import type { SaveStatus } from '../persistence/autosave';
import { clampGridSize, DEFAULT_GRID_SIZE } from '../domain/geometry';
import { DEFAULT_STAMP_SIZE, type StampShape } from '../domain/stamps';

export type Tool = 'select' | 'pan' | 'pen' | 'eraser' | 'text' | 'stamp';

export interface DocMeta {
  id: string;
  title: string;
  createdAt: string;
  thumbnail?: string;
  tableColor?: string;
  lastPlayedAt?: string;
}

export interface TextEditing {
  /** Existing annotation id, or undefined when creating a new one. */
  id?: string;
  position: Vec2;
  text: string;
  fontSize: number;
  color: string;
}

export interface ContextMenuState {
  objectId: string;
  /** Screen position relative to the canvas container. */
  x: number;
  y: number;
  /** Show actions for the whole multi-selection instead of the single object. */
  multi?: boolean;
}

/** Edit mode: clicks on the table choose objects for a button step instead of selecting them. */
export interface PickingState {
  buttonId: string;
  stepId: string;
  /** `objects`: the step's object list; `target`: a move step's destinations (both toggle). */
  field: 'objects' | 'target';
}

/** `barObjectId` value while the action bar is open for a multi-selection. */
export const MULTI_BAR = '__multi__';

/** Interface-chrome preferences, persisted in localStorage. */
export interface UiPrefs {
  toolbarOpen: boolean;
  inspectorOpen: boolean;
  uiHidden: boolean;
  showGrid: boolean;
  /** Dragging never pans the camera (wheel, Pan tool and Space still do). In Edit mode it draws a selection box. */
  cameraLocked: boolean;
  /** Edit mode: the object palette stays open after adding an object. */
  palettePinned: boolean;
  /** Spacing of the Edit-mode grid, in world units. */
  gridSize: number;
  /** Edit mode: dragged and added objects (and arrow-key nudges) snap to the grid. */
  snapToGrid: boolean;
}

const UI_PREFS_KEY = 'tablenox.ui';
const DEFAULT_UI: UiPrefs = {
  toolbarOpen: true,
  inspectorOpen: false,
  uiHidden: false,
  showGrid: true,
  cameraLocked: false,
  palettePinned: false,
  gridSize: DEFAULT_GRID_SIZE,
  snapToGrid: false,
};

function loadUiPrefs(): UiPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(UI_PREFS_KEY) : null;
    if (!raw) return { ...DEFAULT_UI };
    const saved = JSON.parse(raw) as Partial<UiPrefs> & { hoverZoom?: unknown };
    delete saved.hoverZoom;
    const prefs = { ...DEFAULT_UI, ...saved };
    return { ...prefs, gridSize: clampGridSize(Number(prefs.gridSize)) };
  } catch {
    return { ...DEFAULT_UI };
  }
}

function saveUiPrefs(p: UiPrefs) {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(p));
  } catch {
    // ignore (private mode etc.)
  }
}

export interface TableStoreState {
  doc: DocMeta | null;
  mode: Mode;
  history: History;
  camera: CameraState;
  viewport: { width: number; height: number };
  /** Primary selected object (the most recently selected one). Always a member of `selectedIds`. */
  selectedId: string | null;
  /** Every selected object; more than one only in Edit mode. */
  selectedIds: string[];
  tool: Tool;
  spaceHeld: boolean;
  pen: { color: string; width: number; opacity: number };
  textStyle: { color: string; fontSize: number };
  stamp: { shape: StampShape; color: string; size: number };
  eraserRadius: number;
  /** Marks the eraser is going over (hidden until the stroke ends and erases them). */
  erasingIds: ReadonlySet<string>;
  ui: UiPrefs;
  editingText: TextEditing | null;
  /** Object currently being dragged (hides the selection action bar). */
  draggingId: string | null;
  /** Object whose action bar was opened by a plain left click; the bar only shows while it is selected. */
  barObjectId: string | null;
  /** Deck/card a dragged card would merge into, or holder a dragged object is over, on release. */
  dropTargetId: string | null;
  /** Where a card/pile dropped on the spread holder `dropTargetId` would go (index into its cards). */
  dropIndex: number | null;
  contextMenu: ContextMenuState | null;
  /** Card or deck under the mouse (for the hover preview). */
  hoverId: string | null;
  /** Id of the card under the mouse inside the hovered holder/pile (a spread can show any of its cards). */
  hoverCardId: string | null;
  /** Touch: card (or holder / pile) held down with a long-press; its enlarged preview shows at once until the finger lifts. */
  pressPreviewId: string | null;
  /** The held card inside `pressPreviewId` when that is a holder / pile. */
  pressPreviewCardId: string | null;
  picking: PickingState | null;
  /** Edit mode: button whose automations panel is open (independent of the selection). */
  automationButtonId: string | null;
  /** Object to highlight briefly on the table (e.g. picked from an automation step); `seq` restarts the pulse. */
  flash: { id: string; seq: number } | null;
  /** Holders / piles / bags the last shuffle (by hand or automation) went through, for a short animation; `seq` restarts it. */
  shuffled: { ids: string[]; seq: number } | null;
  /** Edit mode: the object palette is open (it also shows while pinned, see `ui.palettePinned`). */
  paletteOpen: boolean;
  /** Increments whenever persisted document content changes (table or title). */
  revision: number;
  /** Increments whenever the camera changes. */
  cameraRevision: number;
  saveStatus: SaveStatus;
  saveError: string | null;
  lastCoalesce: { key: string; at: number } | null;
}

export interface TableStoreActions {
  load(doc: DocMeta, table: TableState, camera: CameraState): void;
  unload(): void;
  setMode(mode: Mode): void;
  dispatch(cmd: Command | null, opts?: { coalesceKey?: string }): boolean;
  undo(): void;
  redo(): void;
  setCamera(camera: CameraState): void;
  setViewport(size: { width: number; height: number }): void;
  setTitle(title: string): void;
  select(id: string | null): void;
  /** Replaces the selection; `primary` defaults to the last id. */
  setSelection(ids: string[], primary?: string | null): void;
  /** Adds or removes one object from the selection (Edit mode multi-select). */
  toggleSelected(id: string): void;
  setTool(tool: Tool): void;
  setSpaceHeld(held: boolean): void;
  setPen(p: Partial<TableStoreState['pen']>): void;
  setTextStyle(p: Partial<TableStoreState['textStyle']>): void;
  setStamp(p: Partial<TableStoreState['stamp']>): void;
  setEraserRadius(r: number): void;
  setErasingIds(ids: ReadonlySet<string>): void;
  setUi(p: Partial<UiPrefs>): void;
  setEditingText(t: TextEditing | null): void;
  setDragging(id: string | null): void;
  setSelectionBar(id: string | null): void;
  setDropTarget(id: string | null, index?: number | null): void;
  setContextMenu(m: ContextMenuState | null): void;
  setHover(id: string | null, cardId?: string | null): void;
  setPressPreview(id: string | null, cardId?: string | null): void;
  setPicking(p: PickingState | null): void;
  openAutomations(buttonId: string | null): void;
  /** Briefly pulses an outline around an object on the table. */
  flashObject(id: string): void;
  /** Opens or closes the object palette; closing also unpins it. */
  setPaletteOpen(open: boolean): void;
  setTableColor(color: string | undefined): void;
  setSaveStatus(status: SaveStatus, error?: string | null): void;
  setDocMeta(patch: Partial<DocMeta>): void;
}

export type TableStore = TableStoreState & TableStoreActions;

const COALESCE_WINDOW_MS = 1200;

const EMPTY_IDS: ReadonlySet<string> = new Set();

/** Ids of the holders / piles / bags a command shuffles (also inside batches). */
export function shuffledBy(cmd: Command): string[] {
  if (cmd.type === 'ShuffleDeck' || cmd.type === 'ShuffleBag') return [cmd.id];
  if (cmd.type === 'Batch') return [...new Set(cmd.commands.flatMap(shuffledBy))];
  return [];
}

const transient = {
  doc: null,
  history: createHistory(emptyTable()),
  camera: { ...DEFAULT_CAMERA },
  selectedId: null,
  selectedIds: [] as string[],
  tool: 'select' as Tool,
  spaceHeld: false,
  editingText: null,
  erasingIds: EMPTY_IDS,
  draggingId: null,
  barObjectId: null,
  dropTargetId: null,
  dropIndex: null,
  contextMenu: null,
  hoverId: null,
  hoverCardId: null,
  pressPreviewId: null as string | null,
  pressPreviewCardId: null as string | null,
  picking: null as PickingState | null,
  automationButtonId: null as string | null,
  flash: null as { id: string; seq: number } | null,
  shuffled: null as { ids: string[]; seq: number } | null,
  paletteOpen: false,
  revision: 0,
  cameraRevision: 0,
  saveStatus: 'saved' as SaveStatus,
  saveError: null,
  lastCoalesce: null,
};

function validSelection(table: TableState, s: Pick<TableStoreState, 'selectedId' | 'selectedIds'>) {
  const ids = new Set(table.objects.map((o) => o.id));
  const selectedIds = s.selectedIds.filter((id) => ids.has(id));
  const selectedId = s.selectedId && ids.has(s.selectedId) ? s.selectedId : (selectedIds[selectedIds.length - 1] ?? null);
  return selectedIds.length === s.selectedIds.length && selectedId === s.selectedId
    ? { selectedId: s.selectedId, selectedIds: s.selectedIds }
    : { selectedId, selectedIds };
}

export const useTableStore = create<TableStore>()((set, get) => ({
  ...transient,
  mode: 'play',
  viewport: { width: 0, height: 0 },
  pen: { color: '#1f4fd1', width: 4, opacity: 1 },
  textStyle: { color: '#1f4fd1', fontSize: 28 },
  stamp: { shape: 'check', color: '#1f4fd1', size: DEFAULT_STAMP_SIZE },
  eraserRadius: 10,
  ui: loadUiPrefs(),

  load(doc, table, camera) {
    set({ ...transient, doc, history: createHistory(table), camera });
  },

  unload() {
    set({ ...transient });
  },

  setMode(mode) {
    const s = get();
    if (s.mode === mode) return;
    // Multi-selection is an Edit-mode feature.
    const selection = mode === 'play' && s.selectedIds.length > 1 ? { selectedId: null, selectedIds: [], barObjectId: null } : {};
    set({
      mode,
      editingText: null,
      contextMenu: null,
      dropTargetId: null,
      dropIndex: null,
      picking: null,
      automationButtonId: null,
      paletteOpen: false,
      ...selection,
    });
  },

  dispatch(cmd, opts) {
    if (!cmd) return false;
    const s = get();
    const next = applyCommand(s.history.present, cmd);
    if (next === s.history.present) return false;
    const now = Date.now();
    const canCoalesce =
      !!opts?.coalesceKey &&
      s.lastCoalesce?.key === opts.coalesceKey &&
      now - s.lastCoalesce.at < COALESCE_WINDOW_MS &&
      s.history.past.length > 0;
    const history = canCoalesce ? { ...s.history, present: next, future: [] } : pushHistory(s.history, next);
    const shuffledIds = shuffledBy(cmd);
    set({
      history,
      revision: s.revision + 1,
      ...validSelection(next, s),
      lastCoalesce: opts?.coalesceKey ? { key: opts.coalesceKey, at: now } : null,
      ...(shuffledIds.length ? { shuffled: { ids: shuffledIds, seq: (s.shuffled?.seq ?? 0) + 1 } } : {}),
    });
    return true;
  },

  undo() {
    const s = get();
    const history = undoHistory(s.history);
    if (history === s.history) return;
    set({
      history,
      revision: s.revision + 1,
      ...validSelection(history.present, s),
      lastCoalesce: null,
      editingText: null,
    });
  },

  redo() {
    const s = get();
    const history = redoHistory(s.history);
    if (history === s.history) return;
    set({
      history,
      revision: s.revision + 1,
      ...validSelection(history.present, s),
      lastCoalesce: null,
      editingText: null,
    });
  },

  setCamera(camera) {
    set((s) => ({ camera, cameraRevision: s.cameraRevision + 1 }));
  },

  setViewport(viewport) {
    set({ viewport });
  },

  setTitle(title) {
    const s = get();
    if (!s.doc || s.doc.title === title) return;
    set({ doc: { ...s.doc, title }, revision: s.revision + 1 });
  },

  select(id) {
    const s = get();
    if (s.selectedId === id && s.selectedIds.length === (id ? 1 : 0)) return;
    set({ selectedId: id, selectedIds: id ? [id] : [] });
  },

  setSelection(ids, primary) {
    const unique = [...new Set(ids)];
    const selectedId =
      primary !== undefined && (primary === null || unique.includes(primary)) ? primary : (unique[unique.length - 1] ?? null);
    set({ selectedIds: unique, selectedId: unique.length ? selectedId : null });
  },

  toggleSelected(id) {
    const s = get();
    if (s.selectedIds.includes(id)) {
      const rest = s.selectedIds.filter((x) => x !== id);
      set({ selectedIds: rest, selectedId: s.selectedId === id ? (rest[rest.length - 1] ?? null) : s.selectedId });
    } else {
      set({ selectedIds: [...s.selectedIds, id], selectedId: id });
    }
  },

  setTool(tool) {
    set({ tool, editingText: null, contextMenu: null });
  },

  setSpaceHeld(spaceHeld) {
    if (get().spaceHeld !== spaceHeld) set({ spaceHeld });
  },

  setPen(p) {
    set((s) => ({ pen: { ...s.pen, ...p } }));
  },

  setTextStyle(p) {
    set((s) => ({ textStyle: { ...s.textStyle, ...p } }));
  },

  setStamp(p) {
    set((s) => ({ stamp: { ...s.stamp, ...p } }));
  },

  setEraserRadius(eraserRadius) {
    set({ eraserRadius });
  },

  setErasingIds(erasingIds) {
    if (get().erasingIds !== erasingIds) set({ erasingIds });
  },

  setUi(p) {
    const ui = { ...get().ui, ...p };
    saveUiPrefs(ui);
    set({ ui });
  },

  setEditingText(editingText) {
    set({ editingText });
  },

  setDragging(draggingId) {
    if (get().draggingId === draggingId) return;
    set(draggingId ? { draggingId, contextMenu: null, barObjectId: null } : { draggingId });
  },

  setSelectionBar(barObjectId) {
    if (get().barObjectId !== barObjectId) set({ barObjectId });
  },

  setDropTarget(dropTargetId, dropIndex = null) {
    const s = get();
    if (s.dropTargetId !== dropTargetId || s.dropIndex !== dropIndex) set({ dropTargetId, dropIndex });
  },

  setContextMenu(contextMenu) {
    set({ contextMenu });
  },

  setHover(hoverId, hoverCardId = null) {
    const s = get();
    if (s.hoverId !== hoverId || s.hoverCardId !== hoverCardId) set({ hoverId, hoverCardId });
  },

  setPressPreview(pressPreviewId, pressPreviewCardId = null) {
    const s = get();
    if (s.pressPreviewId !== pressPreviewId || s.pressPreviewCardId !== pressPreviewCardId) set({ pressPreviewId, pressPreviewCardId });
  },

  setPicking(picking) {
    const cur = get().picking;
    if (
      cur === picking ||
      (cur && picking && cur.buttonId === picking.buttonId && cur.stepId === picking.stepId && cur.field === picking.field)
    )
      return;
    set(picking ? { picking, contextMenu: null, tool: 'select' } : { picking });
  },

  openAutomations(automationButtonId) {
    const s = get();
    if (s.automationButtonId === automationButtonId) return;
    set({ automationButtonId, contextMenu: null, ...(s.picking ? { picking: null } : {}) });
  },

  flashObject(id) {
    set({ flash: { id, seq: (get().flash?.seq ?? 0) + 1 } });
  },

  setPaletteOpen(open) {
    const s = get();
    if (open) {
      if (!s.paletteOpen) set({ paletteOpen: true });
      return;
    }
    if (s.ui.palettePinned) s.setUi({ palettePinned: false });
    if (s.paletteOpen) set({ paletteOpen: false });
  },

  setTableColor(tableColor) {
    const s = get();
    if (!s.doc || s.doc.tableColor === tableColor) return;
    set({ doc: { ...s.doc, tableColor }, revision: s.revision + 1 });
  },

  setSaveStatus(saveStatus, error = null) {
    set({ saveStatus, saveError: error });
  },

  setDocMeta(patch) {
    const s = get();
    if (s.doc) set({ doc: { ...s.doc, ...patch } });
  },
}));

export function currentTable(): TableState {
  return useTableStore.getState().history.present;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __tablenoxStore?: typeof useTableStore }).__tablenoxStore = useTableStore;
}
