import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CAMERA } from '../../domain/camera';
import { nowIso } from '../../domain/ids';
import { gameTable } from '../../domain/game';
import { SCHEMA_VERSION, type CameraState, type Game, type TableState } from '../../domain/types';
import { createAutosaver, type Autosaver } from '../../persistence/autosave';
import { describeStorageError, repo } from '../../persistence/repository';
import { captureThumbnail, onStageLeaving } from '../../canvas/stageRegistry';
import { useTableStore, type DocMeta } from '../../state/tableStore';

export interface Snapshot {
  doc: DocMeta;
  table: TableState;
  camera: CameraState;
}

export function takeSnapshot(): Snapshot | null {
  const s = useTableStore.getState();
  if (!s.doc) return null;
  return { doc: s.doc, table: s.history.present, camera: s.camera };
}

export function snapshotToGame(snap: Snapshot, thumbnail?: string): Game {
  const { doc, table, camera } = snap;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: nowIso(),
    objects: table.objects,
    annotations: table.annotations,
    camera,
    ...(doc.tableColor ? { tableColor: doc.tableColor } : {}),
    thumbnail: thumbnail ?? doc.thumbnail,
    ...(doc.lastPlayedAt ? { lastPlayedAt: doc.lastPlayedAt } : {}),
  };
}

async function persist(snap: Snapshot): Promise<void> {
  const current = useTableStore.getState().doc;
  const isCurrent = current?.id === snap.doc.id;
  // The snapshot may predate the latest "played" mark or thumbnail (neither is a table change), so take them from the store.
  const doc = isCurrent
    ? {
        ...snap.doc,
        thumbnail: current.thumbnail ?? snap.doc.thumbnail,
        ...(current.lastPlayedAt ? { lastPlayedAt: current.lastPlayedAt } : {}),
      }
    : snap.doc;
  await repo.saveGame(snapshotToGame({ ...snap, doc }));
}

/** Records that the open game is being played now (shown as "Last played" in the library). */
export function markPlayed(id: string): void {
  const s = useTableStore.getState();
  if (s.doc?.id !== id) return;
  const at = nowIso();
  s.setDocMeta({ lastPlayedAt: at });
  repo.markPlayed(id, at).catch(() => undefined);
}

let activeSaver: Autosaver | null = null;

/** Flushes pending changes of the currently open game. Returns false if saving failed. */
export async function flushActiveDocument(): Promise<boolean> {
  if (!activeSaver) return true;
  await activeSaver.flush();
  return useTableStore.getState().saveStatus !== 'error';
}

export type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'missing' } | { status: 'error'; message: string };

/** Loads a game into the table store and keeps its single saved record up to date. */
export function useGameDocument(id: string): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const lastSnap = useRef<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const saver = createAutosaver({
      delayMs: 600,
      save: async () => {
        if (lastSnap.current) await persist(lastSnap.current);
      },
      onStatus: (status, err) => {
        if (useTableStore.getState().doc?.id !== id) return;
        useTableStore.getState().setSaveStatus(status, err ? describeStorageError(err) : null);
      },
    });
    activeSaver = saver;
    // The library thumbnail is only taken when leaving the game (rendering it on every autosave is costly), and only
    // when the table or the view changed since the last one.
    let thumbStale = false;
    const captureOnLeave = () => {
      if (!thumbStale || useTableStore.getState().doc?.id !== id) return;
      const thumbnail = captureThumbnail();
      if (!thumbnail) return;
      thumbStale = false;
      useTableStore.getState().setDocMeta({ thumbnail });
      lastSnap.current = takeSnapshot();
      saver.markDirty();
    };

    (async () => {
      setState({ status: 'loading' });
      try {
        const g = await repo.getGame(id);
        if (cancelled) return;
        if (!g) return setState({ status: 'missing' });
        useTableStore.getState().load(
          {
            id: g.id,
            title: g.title,
            createdAt: g.createdAt,
            thumbnail: g.thumbnail,
            tableColor: g.tableColor,
            lastPlayedAt: g.lastPlayedAt,
          },
          gameTable(g),
          g.camera,
        );
        lastSnap.current = takeSnapshot();
        thumbStale = !g.thumbnail;
        unsubscribe = useTableStore.subscribe((s, prev) => {
          if (s.doc?.id !== id) return;
          if (s.revision !== prev.revision || s.cameraRevision !== prev.cameraRevision) {
            thumbStale = true;
            lastSnap.current = takeSnapshot();
            saver.markDirty();
          }
        });
        setState({ status: 'ready' });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: describeStorageError(err) });
      }
    })();

    const onHide = () => {
      if (document.visibilityState === 'hidden') void saver.flush();
    };
    const onPageHide = () => {
      captureOnLeave();
      void saver.flush();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saver.isDirty() || useTableStore.getState().saveStatus === 'error') {
        void saver.flush();
        e.preventDefault();
      }
    };
    // Leaving the game unmounts the table: the canvas reports it while its stage can still be drawn.
    const stopLeaving = onStageLeaving(captureOnLeave);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      cancelled = true;
      stopLeaving();
      unsubscribe?.();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      void saver.flush().finally(() => saver.dispose());
      if (activeSaver === saver) activeSaver = null;
    };
  }, [id]);

  return state;
}

/** Centres the world origin (empty table) or fits the scene the first time a game is shown. */
export function useInitialCamera(ready: boolean, fit: () => void): void {
  const viewportW = useTableStore((s) => s.viewport.width);
  const done = useRef(false);
  useEffect(() => {
    done.current = false;
  }, [ready]);
  useEffect(() => {
    if (!ready || done.current || viewportW === 0) return;
    done.current = true;
    const s = useTableStore.getState();
    const c = s.camera;
    const isDefault = c.x === DEFAULT_CAMERA.x && c.y === DEFAULT_CAMERA.y && c.scale === DEFAULT_CAMERA.scale;
    if (!isDefault) return;
    if (s.history.present.objects.length > 0) fit();
    else s.setCamera({ x: s.viewport.width / 2, y: s.viewport.height / 2, scale: 1 });
  }, [ready, viewportW, fit]);
}
