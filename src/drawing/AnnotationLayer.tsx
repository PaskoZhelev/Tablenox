import { memo } from 'react';
import { Line, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { TEXT_LINE_HEIGHT } from '../domain/annotations';
import type { Annotations } from '../domain/types';
import { useTableStore } from '../state/tableStore';
import { FONT } from '../objects/visuals';
import { startEditingText } from './textEditing';

interface Props {
  annotations: Annotations;
  hiddenIds: ReadonlySet<string>;
  editingId: string | undefined;
  textDraggable: boolean;
}

function AnnotationLayerImpl({ annotations, hiddenIds, editingId, textDraggable }: Props) {
  return (
    <>
      {annotations.strokes.map((s) =>
        hiddenIds.has(s.id) ? null : (
          <Line
            key={s.id}
            points={s.points.length === 2 ? [...s.points, s.points[0] + 0.01, s.points[1]] : s.points}
            stroke={s.color}
            strokeWidth={s.width}
            opacity={s.opacity}
            lineCap="round"
            lineJoin="round"
            tension={0.35}
            listening={false}
            perfectDrawEnabled={false}
          />
        ),
      )}
      {annotations.text.map((t) => {
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
              useTableStore.getState().dispatch({
                type: 'EditTextAnnotation',
                id: t.id,
                patch: { position: { x: Math.round(e.target.x()), y: Math.round(e.target.y()) } },
              });
            }}
            onDblClick={() => startEditingText(t)}
            onDblTap={() => startEditingText(t, true)}
          />
        );
      })}
    </>
  );
}

export const AnnotationLayer = memo(AnnotationLayerImpl);
