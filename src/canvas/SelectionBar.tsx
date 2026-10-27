import { useCallback, useEffect, useRef, useState } from 'react';
import { useElementSize } from '../components/useElementSize';
import { Icon } from '../components/Icon';
import { worldToScreen } from '../domain/camera';
import { objectBounds, unionRects } from '../domain/geometry';
import { bagCount, dieFaceLabel, displayName, tokenCount } from '../domain/objects';
import { HOVER_ZOOM_LABELS } from '../domain/rules';
import { HOVER_ZOOM_SIZES, type HoverZoom, type TabletopObject } from '../domain/types';
import { MULTI_BAR, useTableStore } from '../state/tableStore';
import { incrementCounter, pickDieFace, setCounterValue, setHoverZoom } from './actions';
import { getGroupActions, getObjectActions } from './objectActions';

/** Inline value controls for dice and counters (used in the selection bar and the context menu). */
export function ObjectControls({ o }: { o: TabletopObject }) {
  if (o.kind === 'die') {
    return (
      <button
        type="button"
        className="hud-face"
        aria-label={`Choose die face (showing ${dieFaceLabel(o, o.value)})`}
        title="Choose the face shown"
        onClick={() => {
          useTableStore.getState().setContextMenu(null);
          void pickDieFace(o.id);
        }}
      >
        <Icon name="dice" size={15} />
        <span data-testid="die-face">{dieFaceLabel(o, o.value)}</span>
      </button>
    );
  }
  if (o.kind === 'counter') {
    return <CounterControls key={o.value} id={o.id} value={o.value} />;
  }
  if (o.kind === 'deck') {
    return (
      <span className="hud-count" data-testid="deck-count" title="Cards in this deck">
        {o.cards.length}
        {!o.isPile && o.initialCards.length ? ` / ${o.initialCards.length}` : ''}
      </span>
    );
  }
  if (o.kind === 'bag') {
    return (
      <span className="hud-count" data-testid="bag-count" title="Pieces in this bag">
        {bagCount(o)}
      </span>
    );
  }
  if (o.kind === 'token' && tokenCount(o) > 1) {
    return (
      <span className="hud-count" data-testid="token-count" title="Tokens in this stack">
        {tokenCount(o)}
      </span>
    );
  }
  return null;
}

function CounterControls({ id, value }: { id: string; value: number }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(n)) setCounterValue(id, n);
    else setDraft(String(value));
  };
  return (
    <span className="hud-counter">
      <button type="button" className="hud-btn" aria-label="Decrease" onClick={() => incrementCounter(id, -1)}>
        <Icon name="minus" size={16} />
      </button>
      <input
        aria-label="Counter value"
        data-testid="counter-value"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
        }}
      />
      <button type="button" className="hud-btn" aria-label="Increase" onClick={() => incrementCounter(id, 1)}>
        <Icon name="plus" size={16} />
      </button>
    </span>
  );
}

/** Hover-zoom size picker (context menu and inspector). Cards can inherit the setting from their deck. */
export function HoverZoomSelect({ o, className }: { o: TabletopObject; className?: string }) {
  const inheritLabel = o.kind === 'card' ? 'Same as deck' : 'Off';
  const value = o.hoverZoom === undefined || (o.kind !== 'card' && o.hoverZoom === 'off') ? '' : o.hoverZoom;
  return (
    <select
      className={className}
      aria-label="Zoom on hover"
      value={value}
      onChange={(e) => setHoverZoom(o.id, (e.target.value || undefined) as HoverZoom | undefined)}
    >
      <option value="">{inheritLabel}</option>
      {HOVER_ZOOM_SIZES.filter((z) => z !== 'off' || o.kind === 'card').map((z) => (
        <option key={z} value={z}>
          {HOVER_ZOOM_LABELS[z]}
        </option>
      ))}
    </select>
  );
}

function barPosition(b: { x: number; y: number; width: number; height: number }, size: { w: number; h: number }) {
  const { camera, viewport } = useTableStore.getState();
  const tl = worldToScreen(camera, { x: b.x, y: b.y });
  const br = worldToScreen(camera, { x: b.x + b.width, y: b.y + b.height });
  const gap = 10;
  let top = br.y + gap;
  if (top + size.h > viewport.height - 8) top = tl.y - size.h - gap;
  top = Math.max(8, Math.min(viewport.height - size.h - 8, top));
  const left = Math.max(8, Math.min(viewport.width - size.w - 8, (tl.x + br.x) / 2 - size.w / 2));
  return { left, top };
}

/** Small floating action bar next to the selected object (or the whole multi-selection). */
export function SelectionBar() {
  const selected = useTableStore((s) => s.history.present.objects.find((o) => o.id === s.selectedId));
  const selectedIds = useTableStore((s) => s.selectedIds);
  const table = useTableStore((s) => s.history.present);
  const mode = useTableStore((s) => s.mode);
  useTableStore((s) => s.camera);
  useTableStore((s) => s.viewport);
  const multi = selectedIds.length > 1;
  const hidden = useTableStore(
    (s) =>
      !!s.draggingId ||
      s.barObjectId !== (s.selectedIds.length > 1 ? MULTI_BAR : s.selectedId) ||
      s.tool !== 'select' ||
      !!s.editingText ||
      !!s.contextMenu,
  );
  const [sizeRef, size] = useElementSize<HTMLDivElement>();

  if (!selected || hidden) return null;
  const members = multi ? table.objects.filter((o) => selectedIds.includes(o.id)) : [selected];
  const bounds = unionRects(members.map(objectBounds));
  if (!bounds) return null;
  const { left, top } = barPosition(bounds, size);

  const actions = multi ? getGroupActions(selectedIds, table) : getObjectActions(selected, mode, table).filter((a) => a.primary);
  return (
    <div
      ref={sizeRef}
      className="selection-bar"
      role="toolbar"
      aria-label={multi ? `${selectedIds.length} objects actions` : `${displayName(selected)} actions`}
      style={{ left, top, visibility: size.w ? 'visible' : 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {multi ? (
        <span className="hud-count" data-testid="selection-count" title="Selected objects">
          {selectedIds.length}
        </span>
      ) : (
        <ObjectControls o={selected} />
      )}
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`hud-btn ${a.active ? 'is-active' : ''}`}
          aria-label={a.label}
          aria-pressed={a.active === undefined ? undefined : a.active}
          title={a.shortcut ? `${a.label} (${a.shortcut})` : a.label}
          onClick={a.run}
        >
          {a.icon && <Icon name={a.icon} size={16} />}
        </button>
      ))}
      <button
        type="button"
        className="hud-btn"
        aria-label="More actions"
        title="More actions (right-click)"
        onClick={(e) => {
          const host = e.currentTarget.closest('.canvas-container')?.getBoundingClientRect();
          const r = e.currentTarget.getBoundingClientRect();
          useTableStore
            .getState()
            .setContextMenu({ objectId: selected.id, x: r.left - (host?.left ?? 0), y: r.bottom - (host?.top ?? 0) + 4, multi });
        }}
      >
        <Icon name="more" size={16} />
      </button>
    </div>
  );
}

/** Right-click menu with every action for an object (also reachable for locked objects). */
export function ContextMenu() {
  const menu = useTableStore((s) => s.contextMenu);
  const o = useTableStore((s) => s.history.present.objects.find((x) => x.id === s.contextMenu?.objectId));
  const selectedIds = useTableStore((s) => s.selectedIds);
  const table = useTableStore((s) => s.history.present);
  const mode = useTableStore((s) => s.mode);
  const viewport = useTableStore((s) => s.viewport);
  const ref = useRef<HTMLDivElement | null>(null);
  const [sizeRef, measured] = useElementSize<HTMLDivElement>();
  const size = measured.w ? measured : { w: 220, h: 300 };
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      sizeRef(el);
    },
    [sizeRef],
  );

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      useTableStore.getState().setContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useTableStore.getState().setContextMenu(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', close, true);
    };
  }, [menu]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button, select, input')?.focus();
  }, [menu?.objectId]);

  if (!menu || !o) return null;
  const multi = !!menu.multi && selectedIds.length > 1;
  const left = Math.max(4, Math.min(viewport.width - size.w - 4, menu.x));
  const top = Math.max(4, Math.min(viewport.height - size.h - 4, menu.y));
  const actions = multi ? getGroupActions(selectedIds, table) : getObjectActions(o, mode, table);
  const title = multi ? `${selectedIds.length} objects` : displayName(o);
  return (
    <div ref={setRefs} className="context-menu" role="menu" aria-label={`${title} menu`} style={{ left, top }}>
      <div className="context-menu-title">
        <span>{title}</span>
        {!multi && <ObjectControls o={o} />}
      </div>
      {!multi && mode === 'edit' && (
        <label className="context-menu-row">
          <Icon name="cardZoom" size={15} />
          <span className="context-menu-label">Zoom on hover</span>
          <HoverZoomSelect o={o} />
        </label>
      )}
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          role="menuitem"
          className={`context-menu-item ${a.danger ? 'is-danger' : ''}`}
          onClick={() => {
            useTableStore.getState().setContextMenu(null);
            a.run();
          }}
        >
          {a.icon && <Icon name={a.icon} size={15} />}
          <span className="context-menu-label">{a.label}</span>
          {a.active !== undefined && <span className="context-menu-check">{a.active ? '✓' : ''}</span>}
          {a.shortcut && <kbd>{a.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}
