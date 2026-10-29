import { flushSync } from 'react-dom';
import { placeText, textWorldPosition } from '../domain/annotations';
import type { TextAnnotation, Vec2 } from '../domain/types';
import { currentTable, useTableStore } from '../state/tableStore';

/** Focuses the open annotation editor right away (touch: the keyboard only opens from inside the tap handler). */
export function focusTextEditor(): void {
  document.querySelector<HTMLTextAreaElement>('.text-annotation-editor')?.focus();
}

export function startEditingText(t: TextAnnotation, touch = false): void {
  // The editor sits on the screen, so a text on a sheet opens where it shows on the table.
  const position = textWorldPosition(currentTable().objects, t);
  if (!position) return;
  const open = () => useTableStore.getState().setEditingText({ id: t.id, position, text: t.text, fontSize: t.fontSize, color: t.color });
  if (!touch) return open();
  flushSync(open);
  focusTextEditor();
}

/** Moves a text annotation so its top-left is at world point `world`; it then belongs to the sheet there, or the table. */
export function moveTextAnnotation(id: string, world: Vec2): void {
  const place = placeText(currentTable().objects, world);
  useTableStore.getState().dispatch({ type: 'EditTextAnnotation', id, patch: { position: place.position, objectId: place.objectId } });
}
