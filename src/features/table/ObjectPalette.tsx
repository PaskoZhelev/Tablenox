import { useEffect, useRef } from 'react';
import { Icon } from '../../components/Icon';
import { IMAGE_ACCEPT, uploadImages } from '../../components/upload';
import { addObject } from '../../canvas/actions';
import { useTableStore } from '../../state/tableStore';
import { addPaletteItem, closeUnlessPinned, PALETTE_DRAG_TYPE, PALETTE_GROUPS } from './paletteItems';

/** Hidden file inputs for "Board from image" / "Image"; always mounted in Edit mode so the upload survives the palette closing. */
export function PaletteFileInputs() {
  const onFile = (kind: 'board' | 'image') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const [a] = await uploadImages([file]);
    if (a) {
      await addObject(kind, { assetId: a.id });
      closeUnlessPinned();
    }
  };
  return (
    <>
      <input id="add-board-input" type="file" accept={IMAGE_ACCEPT} hidden data-testid="add-board-input" onChange={onFile('board')} />
      <input id="add-image-input" type="file" accept={IMAGE_ACCEPT} hidden data-testid="add-image-input" onChange={onFile('image')} />
    </>
  );
}

/**
 * Edit-mode object palette: tiles for every kind of object, floating next to the tool column. A click adds the
 * object in the middle of the view; dragging a tile onto the table puts it where it is dropped. It closes after
 * adding (and on outside click / Esc) unless pinned.
 */
export function ObjectPalette() {
  const pinned = useTableStore((s) => s.ui.palettePinned);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pinned) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || ref.current?.contains(t) || t.closest('[data-palette-toggle]')) return;
      useTableStore.getState().setPaletteOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [pinned]);

  return (
    <div ref={ref} className="object-palette" role="menu" aria-label="Add object" data-testid="object-palette">
      <div className="object-palette-head">
        <span>Add object</span>
        <button
          type="button"
          className={`hud-btn ${pinned ? 'is-active' : ''}`}
          aria-pressed={pinned}
          aria-label="Keep the palette open"
          title={pinned ? 'Pinned: stays open after adding' : 'Pin: keep open after adding'}
          onClick={() => useTableStore.getState().setUi({ palettePinned: !pinned })}
        >
          <Icon name="pin" size={15} />
        </button>
        <button
          type="button"
          className="hud-btn"
          aria-label="Close palette"
          title="Close (Esc)"
          onClick={() => useTableStore.getState().setPaletteOpen(false)}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
      {PALETTE_GROUPS.map((g) => (
        <section key={g.title} className="palette-group" aria-label={g.title}>
          <h4>{g.title}</h4>
          <div className="palette-grid">
            {g.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="palette-tile"
                title={item.file ? item.hint : `${item.hint}. Click to add, or drag onto the table.`}
                draggable={!item.file}
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_DRAG_TYPE, item.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => void addPaletteItem(item)}
              >
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="object-palette-hint">Click to add in the middle of the view, or drag a tile onto the table.</p>
    </div>
  );
}
