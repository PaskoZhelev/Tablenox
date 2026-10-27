import { useEffect } from 'react';
import {
  deleteObjects,
  duplicateObjects,
  fitToScene,
  flipCard,
  flipDeck,
  nudgeObjects,
  rollDie,
  rotateBy,
  selectAll,
  shuffleBag,
  shuffleDeck,
  toggleLock,
  toggleLockMany,
  zoomIn,
  zoomOut,
  zoomReset,
} from '../../canvas/actions';
import { buildExportZip, downloadBytes, exportFileName } from '../../import-export/archive';
import { fixedInPlay } from '../../domain/objects';
import { currentTable, useTableStore, type Tool } from '../../state/tableStore';
import { confirmDialog, errorMessage, toast } from '../../state/uiStore';
import { snapshotToGame, takeSnapshot } from './useTableDocument';

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'pan', p: 'pen', e: 'eraser', t: 'text' };

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

export function useTableShortcuts(onHelp?: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('.modal-backdrop')) return;
      const s = useTableStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        if (s.mode === 'edit' && s.selectedIds.length) duplicateObjects(s.selectedIds);
        return;
      }
      if (mod && key === 'a' && s.mode === 'edit') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (mod || e.altKey) return;

      if (e.key === ' ') {
        e.preventDefault();
        s.setSpaceHeld(true);
        return;
      }
      if (e.key === 'Escape') {
        if (s.picking) s.setPicking(null);
        else if (s.editingText) s.setEditingText(null);
        else if (s.contextMenu) s.setContextMenu(null);
        else if (s.paletteOpen && !s.ui.palettePinned) s.setPaletteOpen(false);
        else if (s.selectedId) s.select(null);
        else if (s.automationButtonId) s.openAutomations(null);
        else if (s.tool !== 'select') s.setTool('select');
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.mode === 'edit' && s.selectedIds.length && !s.picking) {
        e.preventDefault();
        deleteObjects(s.selectedIds);
        return;
      }
      if (e.key === '+' || e.key === '=') return zoomIn();
      if (e.key === '-' || e.key === '_') return zoomOut();
      if (e.key === '0') return zoomReset();
      if (e.key === 'F' && e.shiftKey) return fitToScene();

      const multi = s.mode === 'edit' && s.selectedIds.length > 1;
      if (multi) {
        if (key === 'l') return toggleLockMany(s.selectedIds);
        if (e.key.startsWith('Arrow')) {
          e.preventDefault();
          const d = e.shiftKey ? 10 : 1;
          nudgeObjects(
            s.selectedIds,
            e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0,
            e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0,
          );
          return;
        }
      }
      const selected = !multi && s.selectedId ? currentTable().objects.find((o) => o.id === s.selectedId) : undefined;
      if (key === 'f' && selected?.kind === 'card') return flipCard(selected.id);
      if (key === 'f' && selected?.kind === 'deck') return flipDeck(selected.id);
      if (key === 's' && selected?.kind === 'deck') return shuffleDeck(selected.id);
      if (key === 's' && selected?.kind === 'bag') return shuffleBag(selected.id);
      if (key === 'r' && selected) {
        if (selected.kind === 'die') return rollDie(selected.id);
        if (!selected.locked && !(s.mode === 'play' && fixedInPlay(selected))) return rotateBy(selected.id, e.shiftKey ? -90 : 90);
        return;
      }
      if (key === 'l' && selected && s.mode === 'edit') return toggleLock(selected.id);
      if (key === 'c') return s.setUi({ cameraLocked: !s.ui.cameraLocked });
      if (key === 'u') return s.setUi({ uiHidden: !s.ui.uiHidden });
      if (key === 'i' && s.mode === 'edit') return s.setUi({ inspectorOpen: !s.ui.inspectorOpen });
      if (key === 'a' && s.mode === 'edit') return s.setPaletteOpen(!(s.paletteOpen || s.ui.palettePinned));
      if (e.key === '?') return onHelp?.();
      if (e.key.startsWith('Arrow') && selected && s.mode === 'edit' && !selected.locked) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        s.dispatch(
          { type: 'MoveObject', id: selected.id, position: { x: selected.position.x + dx, y: selected.position.y + dy } },
          { coalesceKey: `nudge:${selected.id}` },
        );
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool && !e.shiftKey) s.setTool(tool);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') useTableStore.getState().setSpaceHeld(false);
    };
    const onBlur = () => useTableStore.getState().setSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [onHelp]);
}

export async function exportCurrent(): Promise<void> {
  const snap = takeSnapshot();
  if (!snap) return;
  try {
    // Export from memory so it works even when saving to IndexedDB failed.
    const bytes = await buildExportZip(snapshotToGame(snap));
    downloadBytes(bytes, exportFileName(snap.doc.title));
    toast('Export downloaded.', 'success');
  } catch (err) {
    toast(`Export failed: ${errorMessage(err)}`, 'error');
  }
}

export async function clearMarks(): Promise<void> {
  const s = useTableStore.getState();
  const { strokes, text } = s.history.present.annotations;
  if (strokes.length + text.length === 0) {
    toast('There are no pen or text marks to clear.');
    return;
  }
  const ok = await confirmDialog({
    title: 'Clear all marks?',
    message: `Removes ${strokes.length + text.length} pen stroke(s) and text note(s). You can undo this.`,
    confirmLabel: 'Clear marks',
    danger: true,
  });
  if (ok) s.dispatch({ type: 'ClearAnnotations' });
}
