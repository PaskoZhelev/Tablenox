import type Konva from 'konva';

let stage: Konva.Stage | null = null;

export function registerStage(s: Konva.Stage | null): void {
  stage = s;
}

export function getStage(): Konva.Stage | null {
  return stage;
}

/** Small JPEG thumbnail of the current view, composited onto the table colour (best-effort). */
export function captureThumbnail(maxWidth = 320): string | undefined {
  if (!stage) return undefined;
  try {
    const w = stage.width();
    const h = stage.height();
    if (!w || !h) return undefined;
    const ratio = Math.min(1, maxWidth / w);
    const tr = stage.findOne('Transformer');
    const wasVisible = tr?.visible();
    tr?.visible(false);
    const layers = stage.toCanvas({ pixelRatio: ratio });
    tr?.visible(wasVisible ?? true);
    const out = document.createElement('canvas');
    out.width = layers.width;
    out.height = layers.height;
    const ctx = out.getContext('2d');
    if (!ctx) return undefined;
    const bg = getComputedStyle(stage.container().parentElement ?? stage.container()).backgroundColor;
    ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#3b3f46';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(layers, 0, 0);
    return out.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  }
}
