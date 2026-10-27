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

function ItemFace({ item }: { item: PickableItem }) {
  if (item.shape === 'die') return <DieFace item={item} />;
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
  const cancel = () => dialog.resolve(null);
  const focusIndex = Math.max(
    0,
    dialog.items.findIndex((c) => c.id === dialog.currentId),
  );
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
        <ul className="card-picker" aria-label={dialog.listLabel}>
          {dialog.items.map((c, i) => (
            <li key={c.id}>
              <button
                ref={i === focusIndex ? firstRef : undefined}
                type="button"
                className={`card-picker-item ${c.id === dialog.currentId ? 'is-current' : ''}`}
                aria-label={`${i + 1}. ${c.name}`}
                aria-current={c.id === dialog.currentId ? 'true' : undefined}
                title={c.id === dialog.currentId ? `${c.name} (shown now)` : c.name}
                onClick={() => dialog.resolve(c.id)}
              >
                <span className="card-picker-face">
                  <ItemFace item={c} />
                </span>
                <span className="card-picker-name">{c.shape === 'die' ? c.name : `${i + 1}. ${c.name}`}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
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

export function DialogHost() {
  const dialog = useUiStore((s) => s.dialog);
  const toasts = useUiStore((s) => s.toasts);
  return (
    <>
      {dialog &&
        (dialog.kind === 'pick' ? <PickBody key={dialog.title} dialog={dialog} /> : <DialogBody key={dialog.title} dialog={dialog} />)}
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
