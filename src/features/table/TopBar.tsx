import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Dropdown } from '../../components/Dropdown';
import { useTableStore } from '../../state/tableStore';
import { usePaletteToggle } from './paletteItems';

/** Prominent "Add" button: opens the object palette. */
function AddButton() {
  const { open, toggle } = usePaletteToggle();
  return (
    <button
      type="button"
      className={`hud-btn hud-btn-text hud-btn-add ${open ? 'is-active' : ''}`}
      aria-label="Add object"
      aria-expanded={open}
      aria-haspopup="menu"
      title="Add object (A)"
      data-palette-toggle
      onClick={toggle}
    >
      <Icon name="plus" size={16} /> <span className="hud-btn-label">Add</span>
    </button>
  );
}

function SaveIndicator() {
  const status = useTableStore((s) => s.saveStatus);
  const label = status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved changes' : status === 'error' ? 'Save failed' : 'Saved';
  return (
    <span className={`save-dot save-${status}`} role="status" aria-live="polite" data-testid="save-status" title={label}>
      {status === 'saved' ? (
        <Icon name="check" size={14} />
      ) : status === 'error' ? (
        <Icon name="alert" size={14} />
      ) : (
        <span className="dot" />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Prominent, non-blocking banner when saving to the browser fails. */
export function SaveErrorBanner({ onRetry, onExport }: { onRetry: () => void; onExport: () => void }) {
  const status = useTableStore((s) => s.saveStatus);
  const error = useTableStore((s) => s.saveError);
  if (status !== 'error') return null;
  return (
    <div className="save-error-banner" role="alert">
      <Icon name="alert" size={16} />
      <span title={error ?? undefined}>Save failed — your changes are kept in memory.</span>
      <button type="button" className="btn btn-small" onClick={onRetry}>
        Retry
      </button>
      <button type="button" className="btn btn-small" onClick={onExport}>
        Export
      </button>
    </div>
  );
}

function TitleEditor() {
  const title = useTableStore((s) => s.doc?.title ?? '');
  const setTitle = useTableStore((s) => s.setTitle);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="title-input"
      aria-label="Game title"
      value={draft ?? title}
      size={Math.min(28, Math.max(8, (draft ?? title).length + 1))}
      maxLength={200}
      onFocus={() => setDraft(title)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim()) setTitle(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

const TABLE_COLORS = [
  '#3b3f46', // grey (default)
  '#16181d', // near black
  '#5f6670', // slate
  '#1f5c45', // felt green
  '#3d6b4f', // sage
  '#2f4f6f', // navy
  '#3f6f8f', // steel blue
  '#4a3a6b', // purple
  '#5a2430', // wine
  '#6b4a2f', // walnut
  '#a8865f', // oak
  '#c9b79c', // sand
  '#e8e2d4', // parchment
  '#f4f1ea', // off-white
  '#e6e9ee', // light grey
  '#ffffff', // white
];

function TableColorPicker() {
  const color = useTableStore((s) => s.doc?.tableColor);
  const setTableColor = useTableStore((s) => s.setTableColor);
  return (
    <div className="menu-section" aria-label="Table colour">
      <span className="menu-section-title">
        <Icon name="palette" size={16} /> Table colour
      </span>
      <div className="swatches swatches-wide">
        {TABLE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch ${color === c ? 'is-active' : ''}`}
            style={{ background: c }}
            aria-label={`Table colour ${c}`}
            aria-pressed={color === c}
            onClick={() => setTableColor(c)}
          />
        ))}
        <input
          type="color"
          className="swatch-custom"
          aria-label="Custom table colour"
          value={color ?? '#3b3f46'}
          onChange={(e) => setTableColor(e.target.value)}
        />
        <button type="button" className="chip" onClick={() => setTableColor(undefined)} disabled={!color}>
          Default
        </button>
      </div>
    </div>
  );
}

export function TopBar({
  onBack,
  onMode,
  onExport,
  onHelp,
  onClearMarks,
}: {
  onBack: () => void;
  onMode: (mode: 'edit' | 'play') => void;
  onExport: () => void;
  onHelp: () => void;
  onClearMarks: () => void;
}) {
  const mode = useTableStore((s) => s.mode);
  const canUndo = useTableStore((s) => s.history.past.length > 0);
  const canRedo = useTableStore((s) => s.history.future.length > 0);
  const undo = useTableStore((s) => s.undo);
  const redo = useTableStore((s) => s.redo);
  const inspectorOpen = useTableStore((s) => s.ui.inspectorOpen);
  const setUi = useTableStore((s) => s.setUi);
  const ref = useRef<HTMLElement>(null);

  // Panels below the bar (tools, palette, drawers) read its height, which grows when it wraps on narrow screens.
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const update = () => host.style.setProperty('--hud-top-h', `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      host.style.removeProperty('--hud-top-h');
    };
  }, []);

  return (
    <header className="hud-top" ref={ref}>
      <button type="button" className="hud-btn" onClick={onBack} aria-label="Back to library" title="Back to library (all games)">
        <Icon name="home" size={18} />
      </button>
      <span className="hud-sep" />
      <TitleEditor />
      <div className="mode-switch" role="group" aria-label="Mode">
        <button
          type="button"
          className={`mode-btn ${mode === 'edit' ? 'is-active' : ''}`}
          aria-pressed={mode === 'edit'}
          onClick={() => onMode('edit')}
        >
          <Icon name="edit" size={14} /> <span className="mode-label">Edit</span>
        </button>
        <button
          type="button"
          className={`mode-btn ${mode === 'play' ? 'is-active' : ''}`}
          aria-pressed={mode === 'play'}
          onClick={() => onMode('play')}
        >
          <Icon name="play" size={14} /> <span className="mode-label">Play</span>
        </button>
      </div>
      <span className="hud-sep" />
      <button type="button" className="hud-btn" onClick={undo} disabled={!canUndo} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)">
        <Icon name="undo" size={16} />
      </button>
      <button
        type="button"
        className="hud-btn"
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo (Ctrl+Shift+Z)"
        title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
      >
        <Icon name="redo" size={16} />
      </button>
      <SaveIndicator />
      {mode === 'edit' && (
        <>
          <span className="hud-sep" />
          <AddButton />
          <button
            type="button"
            className={`hud-btn ${inspectorOpen ? 'is-active' : ''}`}
            aria-pressed={inspectorOpen}
            aria-label="Properties panel"
            title="Properties panel (I)"
            onClick={() => setUi({ inspectorOpen: !inspectorOpen })}
          >
            <Icon name="sliders" size={16} />
          </button>
        </>
      )}
      <Dropdown label="More" button={<Icon name="more" size={18} />}>
        {(close) => (
          <div className="menu-list">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close();
                onExport();
              }}
            >
              <Icon name="download" size={16} /> Export game (.tablenox.zip)
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close();
                onClearMarks();
              }}
            >
              <Icon name="eraser" size={16} /> Clear all pen &amp; text marks…
            </button>
            <TableColorPicker />
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close();
                setUi({ uiHidden: true });
              }}
            >
              <Icon name="maximize" size={16} /> Hide interface <kbd>U</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close();
                onHelp();
              }}
            >
              <Icon name="help" size={16} /> Controls &amp; shortcuts <kbd>?</kbd>
            </button>
          </div>
        )}
      </Dropdown>
    </header>
  );
}
