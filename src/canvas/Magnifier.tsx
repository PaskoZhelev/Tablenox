import { useEffect, useRef } from 'react';
import { useTableStore } from '../state/tableStore';
import { getStage } from './stageRegistry';

/** Size of the magnifier on screen, in CSS pixels. */
export const MAGNIFIER_SIZE = { width: 360, height: 240 };
/** Without mouse moves the magnifier still redraws this often, so changes on the table (a drop, a roll) show up. */
const IDLE_REDRAW_MS = 120;

/** Last pointer position over the page (client coordinates), so the magnifier can open where the mouse already is. */
let lastPointer: { x: number; y: number } | null = null;

/**
 * Hold Z: a lens centred on the mouse shows the table under it enlarged `ui.magnifierZoom` times (the wheel changes
 * it while Z is held). The region is drawn again by Konva at the higher pixel ratio, so text and edges stay sharp.
 */
export function Magnifier() {
  const held = useTableStore((s) => s.magnifierHeld);
  const zoom = useTableStore((s) => s.ui.magnifierZoom);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove, true);
    return () => window.removeEventListener('pointermove', onMove, true);
  }, []);

  useEffect(() => {
    if (!held) return;
    let frame = 0;
    let drawnAt = 0;
    let drawnFor: { x: number; y: number } | null = null;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const p = lastPointer;
      if (p === drawnFor && now - drawnAt < IDLE_REDRAW_MS) return;
      drawnFor = p;
      drawnAt = now;
      const stage = getStage();
      const box = boxRef.current;
      const canvas = canvasRef.current;
      const parent = box?.parentElement;
      if (!stage || !box || !canvas || !parent || !p) return;
      const area = parent.getBoundingClientRect();
      const x = p.x - area.left;
      const y = p.y - area.top;
      const over = x >= 0 && y >= 0 && x <= area.width && y <= area.height;
      box.style.visibility = over ? 'visible' : 'hidden';
      if (!over) return;
      const { width, height } = MAGNIFIER_SIZE;
      box.style.transform = `translate(${Math.round(x - width / 2)}px, ${Math.round(y - height / 2)}px)`;
      const dpr = globalThis.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const stageArea = stage.container().getBoundingClientRect();
      const sx = p.x - stageArea.left;
      const sy = p.y - stageArea.top;
      const sw = width / zoom;
      const sh = height / zoom;
      ctx.fillStyle = getComputedStyle(parent).backgroundColor || '#3b3f46';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try {
        const view = stage.toCanvas({ x: sx - sw / 2, y: sy - sh / 2, width: sw, height: sh, pixelRatio: zoom * dpr });
        ctx.drawImage(view, 0, 0, canvas.width, canvas.height);
      } catch {
        // A stage that can't be drawn (e.g. being torn down) leaves the lens empty for this frame.
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [held, zoom]);

  if (!held) return null;
  return (
    <div
      ref={boxRef}
      className="magnifier"
      data-testid="magnifier"
      style={{ width: MAGNIFIER_SIZE.width, height: MAGNIFIER_SIZE.height, visibility: 'hidden' }}
    >
      <canvas ref={canvasRef} style={{ width: MAGNIFIER_SIZE.width, height: MAGNIFIER_SIZE.height }} />
      <span className="magnifier-zoom">{`${zoom.toFixed(1).replace(/\.0$/, '')}×`}</span>
    </div>
  );
}
