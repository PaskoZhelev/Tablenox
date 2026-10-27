import { Icon, type IconName } from '../../components/Icon';
import { fitToScene, zoomIn, zoomOut, zoomReset } from '../../canvas/actions';
import { PALETTE_COLORS } from '../../domain/objects';
import { useTableStore, type Tool } from '../../state/tableStore';
import { usePaletteToggle } from './paletteItems';

const TOOLS: { tool: Tool; label: string; icon: IconName; key: string }[] = [
  { tool: 'select', label: 'Select / move', icon: 'select', key: 'V' },
  { tool: 'pan', label: 'Pan', icon: 'pan', key: 'H' },
  { tool: 'pen', label: 'Pen', icon: 'pen', key: 'P' },
  { tool: 'eraser', label: 'Eraser', icon: 'eraser', key: 'E' },
  { tool: 'text', label: 'Text', icon: 'text', key: 'T' },
];

const PEN_WIDTHS = [2, 4, 8, 14];

function ToolOptions() {
  const tool = useTableStore((s) => s.tool);
  const pen = useTableStore((s) => s.pen);
  const setPen = useTableStore((s) => s.setPen);
  const textStyle = useTableStore((s) => s.textStyle);
  const setTextStyle = useTableStore((s) => s.setTextStyle);
  const eraserRadius = useTableStore((s) => s.eraserRadius);
  const setEraserRadius = useTableStore((s) => s.setEraserRadius);
  if (tool !== 'pen' && tool !== 'text' && tool !== 'eraser') return null;

  if (tool === 'eraser') {
    return (
      <div className="tool-options" aria-label="Eraser options">
        <label className="inline-range">
          <span>Size</span>
          <input type="range" min={4} max={40} value={eraserRadius} onChange={(e) => setEraserRadius(Number(e.target.value))} />
        </label>
      </div>
    );
  }
  const color = tool === 'text' ? textStyle.color : pen.color;
  const setColor = (c: string) => (tool === 'text' ? setTextStyle({ color: c }) : setPen({ color: c }));
  return (
    <div className="tool-options" aria-label={tool === 'pen' ? 'Pen options' : 'Text options'}>
      <div className="swatches">
        {PALETTE_COLORS.slice(0, 8).map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch ${color === c ? 'is-active' : ''}`}
            style={{ background: c }}
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
          />
        ))}
        <input type="color" className="swatch-custom" aria-label="Custom colour" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      {tool === 'pen' ? (
        <div className="swatches">
          {PEN_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              className={`width-btn ${pen.width === w ? 'is-active' : ''}`}
              aria-label={`Pen width ${w}`}
              aria-pressed={pen.width === w}
              onClick={() => setPen({ width: w })}
            >
              <span style={{ width: Math.min(18, w + 2), height: Math.min(18, w + 2) }} />
            </button>
          ))}
          <button
            type="button"
            className={`chip ${pen.opacity < 1 ? 'is-active' : ''}`}
            aria-pressed={pen.opacity < 1}
            title="Highlighter (semi-transparent)"
            onClick={() => setPen({ opacity: pen.opacity < 1 ? 1 : 0.4 })}
          >
            Highlight
          </button>
        </div>
      ) : (
        <label className="inline-select">
          <span className="sr-only">Font size</span>
          <select value={textStyle.fontSize} onChange={(e) => setTextStyle({ fontSize: Number(e.target.value) })}>
            {[12, 16, 20, 28, 36, 48, 64, 96].map((s) => (
              <option key={s} value={s}>
                {s}px
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Compact vertical tool column; collapses to a single button. */
export function Toolbar() {
  const tool = useTableStore((s) => s.tool);
  const setTool = useTableStore((s) => s.setTool);
  const scale = useTableStore((s) => s.camera.scale);
  const mode = useTableStore((s) => s.mode);
  const open = useTableStore((s) => s.ui.toolbarOpen);
  const showGrid = useTableStore((s) => s.ui.showGrid);
  const cameraLocked = useTableStore((s) => s.ui.cameraLocked);
  const setUi = useTableStore((s) => s.setUi);
  const { open: paletteOpen, toggle: togglePalette } = usePaletteToggle();
  const activeTool = TOOLS.find((t) => t.tool === tool)!;

  if (!open) {
    return (
      <div className="hud-tools is-collapsed">
        <button
          type="button"
          className="hud-btn is-active"
          aria-label={`Show tools (current: ${activeTool.label})`}
          title="Show tools"
          onClick={() => setUi({ toolbarOpen: true })}
        >
          <Icon name={activeTool.icon} size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="hud-tools-wrap">
      <div className="hud-tools" role="toolbar" aria-label="Tools" aria-orientation="vertical">
        {mode === 'edit' && (
          <>
            <button
              type="button"
              className={`hud-btn hud-btn-add ${paletteOpen ? 'is-active' : ''}`}
              aria-pressed={paletteOpen}
              aria-label="Object palette (A)"
              title="Add objects: open the palette (A)"
              data-palette-toggle
              onClick={togglePalette}
            >
              <Icon name="plus" size={18} />
            </button>
            <span className="hud-sep-h" />
          </>
        )}
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            className={`hud-btn ${tool === t.tool ? 'is-active' : ''}`}
            aria-pressed={tool === t.tool}
            aria-label={`${t.label} (${t.key})`}
            title={`${t.label} (${t.key})`}
            onClick={() => setTool(t.tool)}
          >
            <Icon name={t.icon} size={18} />
          </button>
        ))}
        <span className="hud-sep-h" />
        <button type="button" className="hud-btn" aria-label="Zoom in (+)" title="Zoom in (+)" onClick={zoomIn}>
          <Icon name="zoomIn" size={18} />
        </button>
        <button
          type="button"
          className="hud-btn zoom-pct"
          title="Reset to 100% (0)"
          aria-label={`Zoom ${Math.round(scale * 100)}%, reset to 100%`}
          onClick={zoomReset}
          data-testid="zoom-level"
        >
          {Math.round(scale * 100)}%
        </button>
        <button type="button" className="hud-btn" aria-label="Zoom out (-)" title="Zoom out (-)" onClick={zoomOut}>
          <Icon name="zoomOut" size={18} />
        </button>
        <button
          type="button"
          className="hud-btn"
          aria-label="Fit everything (Shift+F)"
          title="Fit everything (Shift+F)"
          onClick={fitToScene}
        >
          <Icon name="fit" size={18} />
        </button>
        {mode === 'edit' && (
          <button
            type="button"
            className={`hud-btn ${showGrid ? 'is-active' : ''}`}
            aria-pressed={showGrid}
            aria-label="Toggle grid"
            title="Toggle grid"
            onClick={() => setUi({ showGrid: !showGrid })}
          >
            <Icon name="grid" size={18} />
          </button>
        )}
        <span className="hud-sep-h" />
        <button
          type="button"
          className={`hud-btn ${cameraLocked ? 'is-active' : ''}`}
          aria-pressed={cameraLocked}
          aria-label="Lock camera: dragging never pans (C)"
          title={
            cameraLocked
              ? 'Camera locked: dragging the table does not pan; in Edit mode it selects (C)'
              : 'Lock camera: dragging the table does not pan; in Edit mode it selects (C)'
          }
          onClick={() => setUi({ cameraLocked: !cameraLocked })}
        >
          <Icon name={cameraLocked ? 'moveOff' : 'move'} size={18} />
        </button>
        <span className="hud-sep-h" />
        <button
          type="button"
          className="hud-btn"
          aria-label="Collapse tools"
          title="Collapse tools"
          onClick={() => setUi({ toolbarOpen: false })}
        >
          <Icon name="chevronLeft" size={18} />
        </button>
      </div>
      <ToolOptions />
    </div>
  );
}
