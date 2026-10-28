import type Konva from 'konva';

let stage: Konva.Stage | null = null;

export function registerStage(s: Konva.Stage | null): void {
  stage = s;
}

export function getStage(): Konva.Stage | null {
  return stage;
}

/** Width of library thumbnails in pixels: twice the size they are shown at, so they stay sharp on high-DPI screens. */
export const THUMBNAIL_WIDTH = 640;

/** Canvas with `src` drawn at half its size, smoothed. */
function halve(src: HTMLCanvasElement, width = Math.round(src.width / 2), height = Math.round(src.height / 2)): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, width);
  out.height = Math.max(1, height);
  const ctx = out.getContext('2d');
  if (!ctx) return src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/** JPEG thumbnail of the current view, composited onto the table colour (best-effort). */
export function captureThumbnail(width = THUMBNAIL_WIDTH): string | undefined {
  if (!stage) return undefined;
  try {
    const w = stage.width();
    const h = stage.height();
    if (!w || !h) return undefined;
    // Render at about twice the target size, then shrink in halving steps: shrinking a lot in one go drops
    // most pixels and makes text and lines jagged.
    const ratio = Math.min(2, (width * 2) / w);
    const hidden = [stage.findOne('Transformer'), stage.findOne('.grid-layer')].filter((n) => n?.visible());
    hidden.forEach((n) => n?.visible(false));
    let layers: HTMLCanvasElement;
    try {
      layers = stage.toCanvas({ pixelRatio: ratio });
    } finally {
      hidden.forEach((n) => n?.visible(true));
    }
    let out = document.createElement('canvas');
    out.width = layers.width;
    out.height = layers.height;
    const ctx = out.getContext('2d');
    if (!ctx) return undefined;
    const bg = getComputedStyle(stage.container().parentElement ?? stage.container()).backgroundColor;
    ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#3b3f46';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(layers, 0, 0);
    while (out.width / 2 >= width) out = halve(out);
    if (out.width > width) out = halve(out, width, Math.round((out.height * width) / out.width));
    return out.toDataURL('image/jpeg', 0.85);
  } catch {
    return undefined;
  }
}
