import type { DragEvent } from 'react';
import type { IconName } from '../../components/Icon';
import { addObject } from '../../canvas/actions';
import { screenToWorld } from '../../domain/camera';
import type { ObjectKind, TokenShape, Vec2 } from '../../domain/types';
import { useTableStore } from '../../state/tableStore';

export interface PaletteItem {
  id: string;
  label: string;
  icon: IconName;
  hint: string;
  kind: ObjectKind;
  withCards?: boolean;
  /** Shape of a token tile's token (also its name). */
  tokenShape?: TokenShape;
  /** Asks for an image file first (can't be dragged onto the table). */
  file?: 'board' | 'image';
}

export const PALETTE_GROUPS: { title: string; items: PaletteItem[] }[] = [
  {
    title: 'Cards',
    items: [
      { id: 'card', kind: 'card', label: 'Card', icon: 'card', hint: 'A single card with a face and a back' },
      {
        id: 'deck',
        kind: 'deck',
        label: 'Deck',
        icon: 'deck',
        hint: 'A holder filled with a standard 52-card deck (shuffle, draw, reset)',
        withCards: true,
      },
      {
        id: 'holder',
        kind: 'deck',
        label: 'Holder',
        icon: 'holder',
        hint: 'An empty zone that cards are put into (stacked or spread out)',
      },
    ],
  },
  {
    title: 'Pieces',
    items: [
      { id: 'token', kind: 'token', label: 'Token', icon: 'token', hint: 'A coloured piece or image token' },
      { id: 'pawn', kind: 'token', label: 'Pawn', icon: 'pawn', hint: 'A pawn-shaped token', tokenShape: 'pawn' },
      { id: 'meeple', kind: 'token', label: 'Meeple', icon: 'meeple', hint: 'A meeple-shaped token', tokenShape: 'meeple' },
      { id: 'die', kind: 'die', label: 'Die', icon: 'dice', hint: 'A d4–d20 die, or one with custom faces' },
      { id: 'counter', kind: 'counter', label: 'Counter', icon: 'counter', hint: 'A number with − / + buttons' },
      { id: 'checkbox', kind: 'checkbox', label: 'Checkbox', icon: 'checkbox', hint: 'Checked / unchecked with a click in Play mode' },
      { id: 'timer', kind: 'timer', label: 'Timer', icon: 'timer', hint: 'A countdown or stopwatch: start, pause and reset' },
      { id: 'bag', kind: 'bag', label: 'Bag', icon: 'bag', hint: 'Holds cards, tokens, dice… out of sight: shuffle, draw and recall' },
    ],
  },
  {
    title: 'Table',
    items: [
      {
        id: 'board-image',
        kind: 'board',
        label: 'Board from image',
        icon: 'board',
        hint: 'A board / sheet from an image file',
        file: 'board',
      },
      { id: 'board', kind: 'board', label: 'Blank board', icon: 'board', hint: 'Board without an image (pick one later)' },
      { id: 'image', kind: 'image', label: 'Image', icon: 'image', hint: 'A picture from an image file', file: 'image' },
      { id: 'label', kind: 'label', label: 'Text label', icon: 'label', hint: 'Static text' },
      { id: 'button', kind: 'button', label: 'Automation button', icon: 'button', hint: 'A button that runs a list of steps in Play mode' },
    ],
  },
];

const ITEMS = PALETTE_GROUPS.flatMap((g) => g.items);
export const PALETTE_DRAG_TYPE = 'application/x-tablenox-object';

/** Closes the palette after adding something, unless it is pinned. */
export function closeUnlessPinned() {
  const s = useTableStore.getState();
  if (!s.ui.palettePinned) s.setPaletteOpen(false);
}

export async function addPaletteItem(item: PaletteItem, center?: Vec2) {
  if (item.file) {
    document.getElementById(`add-${item.file}-input`)?.click();
    return;
  }
  await addObject(item.kind, { withCards: item.withCards, center, tokenShape: item.tokenShape });
  closeUnlessPinned();
}

/** World point under a page position, on the table canvas. */
function worldAt(clientX: number, clientY: number): Vec2 | null {
  const el = document.querySelector('[data-testid="table-canvas"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
  return screenToWorld(useTableStore.getState().camera, { x: clientX - r.left, y: clientY - r.top });
}

/** Drop handlers for the table area: a palette tile dropped there adds its object where it lands. */
export const paletteDropHandlers = {
  onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  },
  onDrop(e: DragEvent) {
    const item = ITEMS.find((i) => i.id === e.dataTransfer.getData(PALETTE_DRAG_TYPE));
    if (!item) return;
    e.preventDefault();
    const center = worldAt(e.clientX, e.clientY);
    if (center) void addPaletteItem(item, center);
  },
};

/** Toggles the object palette (top bar and tool column). */
export function usePaletteToggle(): { open: boolean; toggle: () => void } {
  const open = useTableStore((s) => s.paletteOpen || s.ui.palettePinned);
  return { open, toggle: () => useTableStore.getState().setPaletteOpen(!open) };
}
