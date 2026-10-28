import { Shape } from 'react-konva';
import type { CameraState } from '../domain/types';

const BASE_SPACING = 50;

/** Infinite-looking grid drawn only for the visible world rectangle. */
export function Grid({ camera, width, height, light }: { camera: CameraState; width: number; height: number; light?: boolean }) {
  // Dark lines on a light table, light lines on a dark one.
  const ink = light ? '0,0,0' : '255,255,255';
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        let spacing = BASE_SPACING;
        while (spacing * camera.scale < 18) spacing *= 2;
        const x0 = -camera.x / camera.scale;
        const y0 = -camera.y / camera.scale;
        const x1 = x0 + width / camera.scale;
        const y1 = y0 + height / camera.scale;
        const c = ctx._context;
        c.save();
        c.lineWidth = 1 / camera.scale;
        c.beginPath();
        for (let x = Math.floor(x0 / spacing) * spacing; x <= x1; x += spacing) {
          c.moveTo(x, y0);
          c.lineTo(x, y1);
        }
        for (let y = Math.floor(y0 / spacing) * spacing; y <= y1; y += spacing) {
          c.moveTo(x0, y);
          c.lineTo(x1, y);
        }
        c.strokeStyle = `rgba(${ink},${light ? 0.1 : 0.07})`;
        c.stroke();
        c.beginPath();
        c.moveTo(0, y0);
        c.lineTo(0, y1);
        c.moveTo(x0, 0);
        c.lineTo(x1, 0);
        c.strokeStyle = `rgba(${ink},${light ? 0.25 : 0.18})`;
        c.stroke();
        c.restore();
      }}
    />
  );
}
