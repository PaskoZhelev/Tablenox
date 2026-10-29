import { useEffect, useRef, useState } from 'react';
import { DIE_PIP_LAYOUT } from '../domain/objects';
import { dismissToast, useUiStore, type DialogRequest, type PickableItem, type PickRequest } from '../state/uiStore';
import { AssetThumb } from './AssetThumb';

function DieFace({ item }: { item: PickableItem }) {
  const pips = item.pips ? DIE_PIP_LAYOUT[item.pips] : undefined;
  return (
    <span className="die-picker-face" style={{ background: item.faceColor, color: item.textColor }}>
      {item.faceAssetId ? (
        <AssetThumb assetId={item.faceAssetId} size={64} label={item.name} />
      ) : pips ? (
        pips.map(([x, y], i) => (
          <span key={i} className="die-picker-pip" style={{ left: `${x * 100}%`, top: `${y * 100}%`, background: item.textColor }} />
        ))
      ) : (
        <span className="die-picker-text">{item.faceText || item.name}</span>
      )}
    </span>
  );
}

function ItemFace({ item, back }: { item: PickableItem; back?: boolean }) {
  if (item.shape === 'die') return <DieFace item={item} />;
  if (back) {
    if (item.backAssetId) return <AssetThumb assetId={item.backAssetId} size={90} label={`Back of ${item.name}`} />;
    return <span className="card-picker-text" style={{ background: item.backColor }} aria-label={`Back of ${item.name}`} role="img" />;
  }
  if (item.faceAssetId) return <AssetThumb assetId={item.faceAssetId} size={90} label={item.name} />;
  return (
    <span className="card-picker-text" style={{ background: item.faceColor, color: item.textColor }}>
      {item.faceText || item.name}
    </span>
  );
}

function PickBody({ dialog }: { dialog: PickRequest }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => firstRef.current?.focus(), []);
  const [selected, setSelected] = useState<string[]>(() => dialog.selectedIds?.filter((id) => dialog.items.some((c) => c.id === id)) ?? []);
  const [backs, setBacks] = useState(false);
  const hasBacks = dialog.items.some((c) => c.shape !== 'die' && (c.backColor !== undefined || c.backAssetId));
  const cancel = () => dialog.resolve(null);
  const confirm = () => {
    if (selected.length === 0 && !dialog.allowEmpty) return;
    const chosen = new Set(selected);
    dialog.resolve(dialog.items.filter((c) => chosen.has(c.id)).map((c) => c.id));
  };
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const focusIndex = Math.max(
    0,
    dialog.items.findIndex((c) => c.id === dialog.currentId),
  );
  const n = selected.length;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
          }
        }}
      >
        <h2 id="modal-title">{dialog.title}</h2>
        {dialog.message && <p className="modal-message">{dialog.message}</p>}
        {hasBacks && (
          <div className="button-row card-picker-sides" role="group" aria-label="Show">
            {(
              [
                [false, 'Fronts'],
                [true, 'Backs'],
              ] as const
            ).map(([b, label]) => (
              <button
                key={label}
                type="button"
                className={`btn btn-small ${backs === b ? 'is-active' : ''}`}
                aria-pressed={backs === b}
                onClick={() => setBacks(b)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <ul className="card-picker" aria-label={dialog.listLabel}>
          {dialog.items.map((c, i) => {
            const isSelected = selected.includes(c.id);
            return (
              <li key={c.id}>
                <button
                  ref={i === focusIndex ? firstRef : undefined}
                  type="button"
                  className={`card-picker-item ${c.id === dialog.currentId ? 'is-current' : ''} ${isSelected ? 'is-selected' : ''}`}
                  aria-label={`${i + 1}. ${c.name}`}
                  aria-current={c.id === dialog.currentId ? 'true' : undefined}
                  aria-pressed={dialog.multiple ? isSelected : undefined}
                  title={c.id === dialog.currentId ? `${c.name} (shown now)` : c.name}
                  onClick={() => (dialog.multiple ? toggle(c.id) : dialog.resolve([c.id]))}
                >
                  {dialog.multiple && (
                    <span className="card-picker-check" aria-hidden="true">
                      {isSelected ? '✓' : ''}
                    </span>
                  )}
                  <span className="card-picker-face">
                    <ItemFace item={c} back={backs} />
                  </span>
                  <span className="card-picker-name">{c.shape === 'die' ? c.name : `${i + 1}. ${c.name}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="modal-actions">
          {dialog.multiple && (
            <span className="card-picker-count" aria-live="polite">
              {n === 0 ? 'Click cards to select them' : `${n} selected`}
            </span>
          )}
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
          {dialog.multiple && (
            <button type="button" className="btn btn-primary" disabled={n === 0 && !dialog.allowEmpty} onClick={confirm}>
              {`${dialog.confirmLabel ?? 'Pick'}${n > 0 ? ` ${n} card${n === 1 ? '' : 's'}` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DialogBody({ dialog }: { dialog: Exclude<DialogRequest, PickRequest> }) {
  const [value, setValue] = useState(dialog.kind === 'prompt' ? (dialog.defaultValue ?? '') : '');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialog.kind === 'prompt') {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      confirmRef.current?.focus();
    }
  }, [dialog]);

  const cancel = () => (dialog.kind === 'confirm' ? dialog.resolve(false) : dialog.resolve(null));
  const accept = () => (dialog.kind === 'confirm' ? dialog.resolve(true) : dialog.resolve(value.trim() ? value.trim() : null));

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onSubmit={(e) => {
          e.preventDefault();
          accept();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
          }
        }}
      >
        <h2 id="modal-title">{dialog.title}</h2>
        {dialog.kind === 'confirm' && dialog.message && <p className="modal-message">{dialog.message}</p>}
        {dialog.kind === 'prompt' && (
          <label className="field">
            <span>{dialog.label}</span>
            <input ref={inputRef} value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="submit"
            className={`btn ${dialog.kind === 'confirm' && dialog.danger ? 'btn-danger' : 'btn-primary'}`}
          >
            {dialog.confirmLabel ?? (dialog.kind === 'confirm' ? 'Confirm' : 'OK')}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A fresh key per dialog request, so a second dialog with the same title starts over (e.g. one Pick step per holder). */
const dialogKeys = new WeakMap<object, number>();
let dialogSeq = 0;
const keyOf = (d: object) => {
  let k = dialogKeys.get(d);
  if (k === undefined) dialogKeys.set(d, (k = ++dialogSeq));
  return k;
};

export function DialogHost() {
  const dialog = useUiStore((s) => s.dialog);
  const toasts = useUiStore((s) => s.toasts);
  return (
    <>
      {dialog &&
        (dialog.kind === 'pick' ? <PickBody key={keyOf(dialog)} dialog={dialog} /> : <DialogBody key={keyOf(dialog)} dialog={dialog} />)}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.message}</span>
            <button className="icon-btn small" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
