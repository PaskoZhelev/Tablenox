import Konva from 'konva';

type TextMetrics = ReturnType<Konva.Text['measureSize']>;

/** Most fonts (style, size, family) whose sample metrics are kept; the table uses far fewer. */
const MAX_FONTS = 500;
const sampleMetrics = new Map<string, TextMetrics>();
const measureSize = Konva.Text.prototype.measureSize;

/**
 * Every Konva `Text` measures the letter "M" each time it is drawn, to place its baseline. That only depends on the font,
 * yet it is a good share of drawing a busy table while it is panned, zoomed or dragged on, so it is measured once per font.
 */
Konva.Text.prototype.measureSize = function (this: Konva.Text, text: string): TextMetrics {
  if (text !== 'M') return measureSize.call(this, text);
  const key = `${this.fontStyle()}|${this.fontVariant()}|${this.fontSize()}|${this.fontFamily()}`;
  let metrics = sampleMetrics.get(key);
  if (!metrics) {
    if (sampleMetrics.size >= MAX_FONTS) sampleMetrics.clear();
    metrics = measureSize.call(this, text);
    sampleMetrics.set(key, metrics);
  }
  return metrics;
};

// A font that finishes loading measures differently from its fallback.
globalThis.document?.fonts?.addEventListener?.('loadingdone', () => sampleMetrics.clear());
