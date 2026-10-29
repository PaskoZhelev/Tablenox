import { memo, useMemo } from 'react';
import { Line, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useShallow } from 'zustand/react/shallow';
import { TEXT_LINE_HEIGHT } from '../domain/annotations';
import { screenToWorld } from '../domain/camera';
import type { Annotations, InkStroke, TextAnnotation } from '../domain/types';
import { useTableStore } from '../state/tableStore';
import { FONT } from '../objects/visuals';
import { moveTextAnnotation, startEditingText } from './textEditing';

interface MarkListProps {
  strokes: readonly InkStroke[];
  text: readonly TextAnnotation[];
  hiddenIds: ReadonlySet<string>;
  editingId: string | undefined;
  textDraggable: boolean;
}

/** Pen strokes, stamps and text, in the coordinates of whatever contains them (the table, or a sheet's own). */
function MarkList({ strokes, text, hiddenIds, editingId, textDraggable }: MarkListProps) {
  return (
    <>
      {strokes.map((s) =>
        hiddenIds.has(s.id) ? null : (
          <Line
            key={s.id}
            points={s.points.length === 2 ? [...s.points, s.points[0] + 0.01, s.points[1]] : s.points}
            stroke={s.color}
            strokeWidth={s.width}
            opacity={s.opacity}
            lineCap="round"
            lineJoin="round"
            tension={s.straight ? 0 : 0.35}
            listening={false}
            perfectDrawEnabled={false}
          />
        ),
      )}
      {text.map((t) => {
        if (hiddenIds.has(t.id) || t.id === editingId) return null;
        return (
          <Text
            key={t.id}
            id={t.id}
            name="text-annotation"
            x={t.position.x}
            y={t.position.y}
            text={t.text}
            fontSize={t.fontSize}
            lineHeight={TEXT_LINE_HEIGHT}
            fontFamily={FONT}
            fill={t.color}
            draggable={textDraggable}
            onDragEnd={(e: KonvaEventObject<DragEvent>) => {
              // Dropped onto a sheet, the text belongs to it from now on; dropped on the table, to the table.
              moveTextAnnotation(t.id, screenToWorld(useTableStore.getState().camera, e.target.getAbsolutePosition()));
            }}
            onDblClick={() => startEditingText(t)}
            onDblTap={() => startEditingText(t, true)}
          />
        );
      })}
    </>
  );
}

interface Props {
  annotations: Annotations;
  hiddenIds: ReadonlySet<string>;
  editingId: string | undefined;
  textDraggable: boolean;
}

/** Marks made on the table itself; marks on a sheet are drawn by the sheet (`SheetMarks`), so they move with it. */
function AnnotationLayerImpl({ annotations, hiddenIds, editingId, textDraggable }: Props) {
  const strokes = useMemo(() => annotations.strokes.filter((s) => !s.objectId), [annotations.strokes]);
  const text = useMemo(() => annotations.text.filter((t) => !t.objectId), [annotations.text]);
  return <MarkList strokes={strokes} text={text} hiddenIds={hiddenIds} editingId={editingId} textDraggable={textDraggable} />;
}

export const AnnotationLayer = memo(AnnotationLayerImpl);

type SheetMarkGroups = Map<string, { strokes: InkStroke[]; text: TextAnnotation[] }>;
const groupCache = new WeakMap<Annotations, SheetMarkGroups>();
const NO_MARKS = { strokes: [] as InkStroke[], text: [] as TextAnnotation[] };

/** Marks grouped by the sheet they belong to, cached per (immutable) annotations object. */
function marksBySheet(a: Annotations): SheetMarkGroups {
  let groups = groupCache.get(a);
  if (!groups) {
    const g: SheetMarkGroups = new Map();
    const of = (id: string) => g.get(id) ?? g.set(id, { strokes: [], text: [] }).get(id)!;
    for (const s of a.strokes) if (s.objectId) of(s.objectId).strokes.push(s);
    for (const t of a.text) if (t.objectId) of(t.objectId).text.push(t);
    groups = g;
    groupCache.set(a, g);
  }
  return groups;
}

/** The marks made on one sheet, drawn inside its object node (its own coordinates), so they move, turn and lift with it. */
function SheetMarksImpl({ objectId }: { objectId: string }) {
  const strokes = useTableStore(useShallow((s) => (marksBySheet(s.history.present.annotations).get(objectId) ?? NO_MARKS).strokes));
  const text = useTableStore(useShallow((s) => (marksBySheet(s.history.present.annotations).get(objectId) ?? NO_MARKS).text));
  const hiddenIds = useTableStore((s) => s.erasingIds);
  const editingId = useTableStore((s) => s.editingText?.id);
  const textDraggable = useTableStore((s) => s.tool === 'select' && !s.spaceHeld && !s.picking);
  if (strokes.length === 0 && text.length === 0) return null;
  return <MarkList strokes={strokes} text={text} hiddenIds={hiddenIds} editingId={editingId} textDraggable={textDraggable} />;
}

export const SheetMarks = memo(SheetMarksImpl);
