import { useEffect, useState } from 'react';
import { Layer, Stage } from 'react-konva';
import { worldToScreen } from '../domain/camera';
import { objectBounds } from '../domain/geometry';
import { ownerDeckOf, resolveCardLook } from '../domain/objects';
import { effectiveHoverZoom, HOVER_ZOOM_PX } from '../domain/rules';
import type { Mode, TableState, TabletopObject } from '../domain/types';
import { CardVisual, ObjectVisual } from '../objects/visuals';
import { useTableStore } from '../state/tableStore';

const SHOW_DELAY_MS = 250;

interface Preview {
  w: number;
  h: number;
  render: () => React.ReactNode;
}

/** What to show enlarged: card faces only (never hidden backs), any other object as it looks on the table. */
function previewOf(o: TabletopObject, table: TableState, mode: Mode): Preview | null {
  if (o.kind === 'card') {
    if (!o.faceUp) return null;
    return {
      w: o.width,
      h: o.height,
      render: () => (
        <CardVisual
          w={o.width}
          h={o.height}
          faceUp
          faceAssetId={o.faceAssetId}
          faceText={o.faceText}
          faceColor={o.faceColor}
          backColor={o.backColor}
        />
      ),
    };
  }
  if (o.kind === 'deck') {
    const top = o.cards[0];
    if (!top || top.faceUp !== true) return null;
    const look = resolveCardLook(top, o, ownerDeckOf(table.objects, top.id));
    return {
      w: look.width,
      h: look.height,
      render: () => (
        <CardVisual
          w={look.width}
          h={look.height}
          faceUp
          faceAssetId={top.faceAssetId}
          faceText={top.faceText}
          faceColor={top.faceColor}
          backColor={look.backColor}
        />
      ),
    };
  }
  return { w: o.width, h: o.height, render: () => <ObjectVisual o={o} mode={mode} /> };
}

/** Enlarged view of the object under the mouse, for objects with "Zoom on hover" set. */
export function HoverPreview() {
  const hoverId = useTableStore((s) => (s.tool === 'select' && !s.draggingId && !s.contextMenu ? s.hoverId : null));
  const hovered = useTableStore((s) => s.history.present.objects.find((o) => o.id === hoverId));
  const table = useTableStore((s) => s.history.present);
  const mode = useTableStore((s) => s.mode);
  const camera = useTableStore((s) => s.camera);
  const viewport = useTableStore((s) => s.viewport);
  const [readyId, setReadyId] = useState<string | null>(null);
  const zoom = hovered ? effectiveHoverZoom(table, hovered) : 'off';

  useEffect(() => {
    if (zoom === 'off' || !hoverId) return;
    const t = setTimeout(() => setReadyId(hoverId), SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [zoom, hoverId]);

  if (zoom === 'off' || !hovered || readyId !== hoverId) return null;
  const preview = previewOf(hovered, table, mode);
  if (!preview) return null;

  const scale = Math.min(
    HOVER_ZOOM_PX[zoom] / Math.max(preview.w, preview.h),
    (viewport.width - 16) / preview.w,
    (viewport.height - 16) / preview.h,
  );
  const w = preview.w * scale;
  const h = preview.h * scale;

  const b = objectBounds(hovered);
  const tl = worldToScreen(camera, { x: b.x, y: b.y });
  const br = worldToScreen(camera, { x: b.x + b.width, y: b.y + b.height });
  const gap = 16;
  let left = br.x + gap;
  if (left + w > viewport.width - 8) left = tl.x - gap - w;
  left = Math.max(8, Math.min(viewport.width - w - 8, left));
  const top = Math.max(8, Math.min(viewport.height - h - 8, (tl.y + br.y) / 2 - h / 2));

  return (
    <div
      className="hover-preview"
      data-testid="card-preview"
      data-zoom={zoom}
      style={{ left, top, width: w, height: h }}
      aria-hidden="true"
    >
      <Stage width={w} height={h} scaleX={scale} scaleY={scale} listening={false}>
        <Layer listening={false}>{preview.render()}</Layer>
      </Stage>
    </div>
  );
}
