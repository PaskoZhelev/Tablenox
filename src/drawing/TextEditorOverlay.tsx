import { useEffect, useRef, useState } from 'react';
import { placeText, TEXT_LINE_HEIGHT } from '../domain/annotations';
import { worldToScreen } from '../domain/camera';
import { newId } from '../domain/ids';
import { currentTable, useTableStore, type TextEditing } from '../state/tableStore';

function commit(editing: TextEditing, text: string) {
  const { dispatch, setEditingText } = useTableStore.getState();
  setEditingText(null);
  if (editing.id) {
    dispatch({ type: 'EditTextAnnotation', id: editing.id, patch: { text } });
  } else if (text.trim()) {
    // Typed on a sheet, the text belongs to it (and moves with it).
    const place = placeText(currentTable().objects, editing.position);
    dispatch({
      type: 'AddTextAnnotation',
      annotation: {
        id: newId(),
        position: place.position,
        text,
        fontSize: editing.fontSize,
        color: editing.color,
        ...(place.objectId ? { objectId: place.objectId } : {}),
      },
    });
  }
}

function Editor({ editing }: { editing: TextEditing }) {
  const camera = useTableStore((s) => s.camera);
  const [text, setText] = useState(editing.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Defer focus until after the pointer gesture that opened the editor completes.
    const t = setTimeout(() => {
      el.focus();
      el.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const screen = worldToScreen(camera, editing.position);
  const fontPx = editing.fontSize * camera.scale;
  const lines = text.split('\n');
  const cols = Math.max(2, ...lines.map((l) => l.length + 1));

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) commit(editing, text);
    else useTableStore.getState().setEditingText(null);
  };

  return (
    <textarea
      ref={ref}
      className="text-annotation-editor"
      aria-label="Annotation text"
      value={text}
      rows={lines.length}
      cols={cols}
      spellCheck={false}
      style={{
        left: screen.x,
        top: screen.y,
        fontSize: fontPx,
        lineHeight: TEXT_LINE_HEIGHT,
        color: editing.color,
        width: `${cols * 0.62 * fontPx + 8}px`,
        height: `${lines.length * TEXT_LINE_HEIGHT * fontPx + 4}px`,
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        }
      }}
    />
  );
}

export function TextEditorOverlay() {
  const editing = useTableStore((s) => s.editingText);
  if (!editing) return null;
  return <Editor key={`${editing.id ?? 'new'}-${editing.position.x}-${editing.position.y}`} editing={editing} />;
}
