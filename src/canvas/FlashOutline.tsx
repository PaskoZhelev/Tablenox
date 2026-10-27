import { useEffect, useRef } from 'react';
import Konva from 'konva';
import { Rect } from 'react-konva';
import { useTableStore } from '../state/tableStore';

const PAD = 16;

/** A yellow outline that pops up around an object and fades out (`flashObject`), so it is easy to spot on the table. */
export function FlashOutline() {
  const seq = useTableStore((s) => s.flash?.seq);
  const o = useTableStore((s) => (s.flash ? s.history.present.objects.find((x) => x.id === s.flash!.id) : undefined));
  const ref = useRef<Konva.Rect>(null);
  const shown = !!o;

  useEffect(() => {
    const r = ref.current;
    if (!r || seq === undefined) return;
    r.opacity(1);
    r.scale({ x: 1.3, y: 1.3 });
    const tween = new Konva.Tween({ node: r, duration: 1.2, scaleX: 1, scaleY: 1, opacity: 0, easing: Konva.Easings.EaseOut });
    tween.play();
    return () => tween.destroy();
  }, [seq, shown]);

  if (!o) return null;
  return (
    <Rect
      ref={ref}
      name="flash-outline"
      x={o.position.x + o.width / 2}
      y={o.position.y + o.height / 2}
      offsetX={o.width / 2 + PAD}
      offsetY={o.height / 2 + PAD}
      width={o.width + PAD * 2}
      height={o.height + PAD * 2}
      rotation={o.rotation}
      stroke="#f4c542"
      strokeWidth={5}
      cornerRadius={12}
      strokeScaleEnabled={false}
      shadowColor="#f4c542"
      shadowBlur={14}
      opacity={0}
      listening={false}
    />
  );
}
