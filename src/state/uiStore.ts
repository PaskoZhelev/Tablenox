import { create } from 'zustand';

export interface ConfirmRequest {
  kind: 'confirm';
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface PromptRequest {
  kind: 'prompt';
  title: string;
  label: string;
  defaultValue?: string;
  confirmLabel?: string;
  resolve: (value: string | null) => void;
}

export type DialogRequest = ConfirmRequest | PromptRequest | PickRequest;

/** An item shown in the face picker: a card face or a die face. */
export interface PickableItem {
  id: string;
  name: string;
  faceText: string;
  faceColor: string;
  faceAssetId?: string;
  /** Colour of the face text; missing means dark. */
  textColor?: string;
  /** `card` (portrait, default) or `die` (square face). */
  shape?: 'card' | 'die';
  /** Standard d6 faces: number of pips drawn instead of the text. */
  pips?: number;
  /** Cards: their back, shown when the picker switches to backs. */
  backColor?: string;
  backAssetId?: string;
}

export interface PickRequest {
  kind: 'pick';
  title: string;
  message?: string;
  /** Accessible name of the list of items, e.g. "Cards". */
  listLabel: string;
  items: PickableItem[];
  /** Item shown as the current choice (and focused first). */
  currentId?: string;
  /** Clicks select several items, confirmed with a button (`confirmLabel`, e.g. "Take"). */
  multiple?: boolean;
  confirmLabel?: string;
  resolve: (ids: string[] | null) => void;
}

export interface Toast {
  id: number;
  tone: 'info' | 'error' | 'success';
  message: string;
}

interface UiState {
  dialog: DialogRequest | null;
  toasts: Toast[];
}

let toastSeq = 0;

export const useUiStore = create<UiState>()(() => ({ dialog: null, toasts: [] }));

export function confirmDialog(opts: Omit<ConfirmRequest, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useUiStore.setState({
      dialog: {
        kind: 'confirm',
        ...opts,
        resolve: (ok) => {
          useUiStore.setState({ dialog: null });
          resolve(ok);
        },
      },
    });
  });
}

export function promptDialog(opts: Omit<PromptRequest, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    useUiStore.setState({
      dialog: {
        kind: 'prompt',
        ...opts,
        resolve: (value) => {
          useUiStore.setState({ dialog: null });
          resolve(value);
        },
      },
    });
  });
}

/** Shows every item's face (cards, die faces) and resolves with the id of the one clicked (null when cancelled). */
export function pickDialog(opts: Omit<PickRequest, 'kind' | 'resolve' | 'multiple'>): Promise<string | null> {
  return pickManyDialog({ ...opts, multiple: false }).then((ids) => ids?.[0] ?? null);
}

/** Like `pickDialog`, but several items can be selected; resolves with their ids in list order (null when cancelled). */
export function pickManyDialog(opts: Omit<PickRequest, 'kind' | 'resolve'>): Promise<string[] | null> {
  return new Promise((resolve) => {
    useUiStore.setState({
      dialog: {
        kind: 'pick',
        multiple: true,
        ...opts,
        resolve: (ids) => {
          useUiStore.setState({ dialog: null });
          resolve(ids);
        },
      },
    });
  });
}

export function toast(message: string, tone: Toast['tone'] = 'info', durationMs = tone === 'error' ? 7000 : 3500): void {
  const id = ++toastSeq;
  useUiStore.setState((s) => ({ toasts: [...s.toasts, { id, tone, message }] }));
  setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: number): void {
  useUiStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
