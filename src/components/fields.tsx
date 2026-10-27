import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { repo } from '../persistence/repository';
import { Icon } from './Icon';

export function Field({ label, children, inline }: { label: string; children: ReactNode; inline?: boolean }) {
  return (
    <label className={`field ${inline ? 'field-inline' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Text input that commits on blur / Enter rather than on every keystroke (one undo entry per edit). */
export function TextField({
  label,
  value,
  onCommit,
  multiline,
  placeholder,
  maxLength = 500,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Field label={label}>
      {multiline ? (
        <textarea
          value={draft}
          rows={3}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
            if (e.key === 'Escape') setDraft(value);
          }}
        />
      ) : (
        <input
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(value);
          }}
        />
      )}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  allowEmpty,
  emptyLabel = 'none',
}: {
  label: string;
  value: number | null;
  onCommit: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
  /** Placeholder shown while an `allowEmpty` field is empty (what "empty" means). */
  emptyLabel?: string;
}) {
  const fmt = (v: number | null) => (v === null ? '' : String(Math.round(v * 100) / 100));
  const [draft, setDraft] = useState(fmt(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(fmt(value));
  }
  const commit = () => {
    if (draft.trim() === '') {
      if (allowEmpty) onCommit(null);
      else setDraft(fmt(value));
      return;
    }
    let n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(fmt(value));
      return;
    }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setDraft(fmt(n));
    if (n !== value) onCommit(n);
  };
  return (
    <Field label={label}>
      <input
        type="number"
        inputMode="decimal"
        value={draft}
        step={step}
        min={min}
        max={max}
        placeholder={allowEmpty ? emptyLabel : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </Field>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <Field label={label} inline>
      <input type="color" value={normalized} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Slider for a 0–1 value, shown as a percentage. */
export function OpacityField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const percent = Math.round(value * 100);
  return (
    <Field label={`${label}: ${percent}%`}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
    </Field>
  );
}

export function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

import { IMAGE_ACCEPT, uploadImages } from './upload';
import { AssetThumb } from './AssetThumb';

export function FileButton({
  label,
  accept,
  multiple,
  onFiles,
  className = 'btn',
  icon,
  testId,
  ariaLabel,
  content,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: FileList) => void;
  className?: string;
  icon?: Parameters<typeof Icon>[0]['name'];
  testId?: string;
  ariaLabel?: string;
  /** Replaces the icon and label inside the button (e.g. a thumbnail of the current image). */
  content?: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => ref.current?.click()}
        aria-controls={id}
        aria-label={ariaLabel ?? label}
        title={ariaLabel ?? label}
      >
        {content ?? (
          <>
            {icon && <Icon name={icon} />}
            <span>{label}</span>
          </>
        )}
      </button>
      <input
        id={id}
        ref={ref}
        data-testid={testId}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}

export function ImageField({
  label,
  assetId,
  onChange,
  testId,
}: {
  label: string;
  assetId: string | undefined;
  onChange: (id: string | undefined) => void;
  testId?: string;
}) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!assetId) return;
    repo.getAsset(assetId).then((a) => {
      if (!cancelled) setName(a ? a.name : 'missing image');
    });
    return () => {
      cancelled = true;
    };
  }, [assetId]);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="image-field">
        {assetId && <AssetThumb assetId={assetId} size={36} label={`${label} preview`} />}
        <span className="image-field-name" title={assetId ? (name ?? '') : ''}>
          {assetId ? (name ?? '…') : 'No image'}
        </span>
        <FileButton
          label={assetId ? 'Replace' : 'Upload'}
          icon="upload"
          accept={IMAGE_ACCEPT}
          className="btn btn-small"
          testId={testId}
          onFiles={async (files) => {
            const [asset] = await uploadImages([files[0]]);
            if (asset) onChange(asset.id);
          }}
        />
        {assetId && (
          <button type="button" className="btn btn-small" onClick={() => onChange(undefined)} aria-label={`Remove ${label}`}>
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
