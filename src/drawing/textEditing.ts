import { flushSync } from 'react-dom';
import type { TextAnnotation } from '../domain/types';
import { useTableStore } from '../state/tableStore';

/** Focuses the open annotation editor right away (touch: the keyboard only opens from inside the tap handler). */
export function focusTextEditor(): void {
  document.querySelector<HTMLTextAreaElement>('.text-annotation-editor')?.focus();
}

export function startEditingText(t: TextAnnotation, touch = false): void {
  const open = () =>
    useTableStore.getState().setEditingText({ id: t.id, position: t.position, text: t.text, fontSize: t.fontSize, color: t.color });
  if (!touch) return open();
  flushSync(open);
  focusTextEditor();
}
