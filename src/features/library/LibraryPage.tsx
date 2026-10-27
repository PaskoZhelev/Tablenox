import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { navigate } from '../../app/router';
import { Icon } from '../../components/Icon';
import { FileButton } from '../../components/fields';
import { createGame, duplicateGame } from '../../domain/game';
import type { Game } from '../../domain/types';
import { buildExportZip, downloadBytes, EXPORT_EXTENSION, exportFileName, importFile } from '../../import-export/archive';
import { db } from '../../persistence/db';
import { describeStorageError, repo } from '../../persistence/repository';
import { confirmDialog, errorMessage, promptDialog, toast } from '../../state/uiStore';
import { createSampleGame } from './sampleGame';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

async function run(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    toast(describeStorageError(err), 'error');
  }
}

const NOTICE_KEY = 'tablenox.storageNoticeDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(value: boolean) {
  try {
    if (value) localStorage.setItem(NOTICE_KEY, '1');
    else localStorage.removeItem(NOTICE_KEY);
  } catch {
    // Storage may be unavailable (private mode); the notice just reappears next visit.
  }
}

function StorageNotice({ onDismiss }: { onDismiss: () => void }) {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then(
      (e) => setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 }),
      () => undefined,
    );
    navigator.storage?.persisted?.().then(setPersisted, () => undefined);
  }, []);
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
  return (
    <aside className="notice" aria-label="Storage information">
      <div className="notice-text">
        <strong>Games are stored in this browser only.</strong> Clearing site data or using a private window will remove them, so export the
        ones you care about ({EXPORT_EXTENSION}).
        {estimate && estimate.quota > 0 && (
          <span className="notice-meta">
            {' '}
            Using {mb(estimate.usage)} of ~{mb(estimate.quota)}.
          </span>
        )}
        {persisted === false && navigator.storage?.persist && (
          <button
            type="button"
            className="btn btn-small btn-link"
            onClick={async () => {
              const ok = await navigator.storage.persist();
              setPersisted(ok);
              toast(ok ? 'Persistent storage granted.' : 'The browser declined persistent storage.', ok ? 'success' : 'info');
            }}
          >
            Ask browser to keep data
          </button>
        )}
        {persisted && <span className="notice-meta"> Persistent storage is on.</span>}
      </div>
      <button type="button" className="notice-close" aria-label="Dismiss storage notice" title="Dismiss" onClick={onDismiss}>
        <Icon name="close" size={16} />
      </button>
    </aside>
  );
}

function Thumb({ src, title }: { src?: string; title: string }) {
  return (
    <div className="lib-thumb" aria-hidden="true">
      {src ? <img src={src} alt="" /> : <span>{title.trim().slice(0, 1).toUpperCase() || '?'}</span>}
    </div>
  );
}

function GameCard({ g }: { g: Game }) {
  return (
    <li className="lib-card" data-testid="game-card">
      <button type="button" className="lib-thumb-btn" aria-label={`Play ${g.title}`} onClick={() => navigate({ name: 'play', id: g.id })}>
        <Thumb src={g.thumbnail} title={g.title} />
      </button>
      <div className="lib-card-body">
        <h3 className="lib-title" title={g.title}>
          {g.title}
        </h3>
        <p className="lib-meta">
          {g.objects.length} {g.objects.length === 1 ? 'object' : 'objects'} · {formatDate(g.updatedAt)}
        </p>
        <div className="lib-actions">
          <button type="button" className="btn btn-primary btn-small" onClick={() => navigate({ name: 'play', id: g.id })}>
            <Icon name="play" size={13} /> Play
          </button>
          <button type="button" className="btn btn-small" onClick={() => navigate({ name: 'edit', id: g.id })}>
            Edit
          </button>
          <span className="lib-tools">
            <button
              type="button"
              className="lib-tool"
              aria-label="Duplicate"
              title="Duplicate"
              onClick={() =>
                run(async () => {
                  await repo.saveGame(duplicateGame(g));
                  toast('Game duplicated.', 'success');
                })
              }
            >
              <Icon name="copy" size={16} />
            </button>
            <button
              type="button"
              className="lib-tool"
              aria-label="Rename"
              title="Rename"
              onClick={() =>
                run(async () => {
                  const title = await promptDialog({ title: 'Rename game', label: 'Title', defaultValue: g.title, confirmLabel: 'Rename' });
                  if (title) await db.games.update(g.id, { title, updatedAt: new Date().toISOString() });
                })
              }
            >
              <Icon name="pen" size={16} />
            </button>
            <button
              type="button"
              className="lib-tool"
              aria-label="Export"
              title="Export"
              onClick={() =>
                run(async () => {
                  downloadBytes(await buildExportZip(g), exportFileName(g.title));
                })
              }
            >
              <Icon name="download" size={16} />
            </button>
            <button
              type="button"
              className="lib-tool lib-tool-danger"
              aria-label={`Delete ${g.title}`}
              title="Delete"
              onClick={() =>
                run(async () => {
                  const ok = await confirmDialog({
                    title: `Delete "${g.title}"?`,
                    message: 'This cannot be undone. Export it first if you want a backup.',
                    confirmLabel: 'Delete',
                    danger: true,
                  });
                  if (ok) await repo.deleteGame(g.id);
                })
              }
            >
              <Icon name="trash" size={16} />
            </button>
          </span>
        </div>
      </div>
    </li>
  );
}

export function LibraryPage() {
  const games = useLiveQuery(() => db.games.orderBy('updatedAt').reverse().toArray(), []);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [pinned, setPinned] = useState(false);
  const showNotice = pinned || (!dismissed && !!games && games.length > 0);

  // Clean up images no longer used by any game (e.g. after deleting one).
  useEffect(() => {
    repo.collectGarbage().catch(() => undefined);
  }, []);

  const newGame = () =>
    run(async () => {
      const title = await promptDialog({ title: 'New game', label: 'Game title', defaultValue: 'Untitled game', confirmLabel: 'Create' });
      if (!title) return;
      const g = createGame(title);
      await repo.saveGame(g);
      navigate({ name: 'edit', id: g.id });
    });

  const onImport = (files: FileList) =>
    run(async () => {
      setBusy(true);
      try {
        const res = await importFile(files[0]);
        toast(`Imported "${res.title}".`, 'success');
      } catch (err) {
        toast(`Import failed: ${errorMessage(err)}`, 'error');
      } finally {
        setBusy(false);
      }
    });

  return (
    <div className="library">
      <header className="library-header">
        <div className="brand">
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={34} height={34} />
          <h1>Tablenox</h1>
        </div>
        <div className="library-actions">
          <button type="button" className="btn btn-primary" onClick={newGame}>
            <Icon name="plus" size={16} /> New game
          </button>
          <FileButton
            label={busy ? 'Importing…' : 'Import'}
            icon="upload"
            accept=".zip,application/zip"
            onFiles={onImport}
            testId="import-input"
          />
          <button
            type="button"
            className="btn"
            onClick={() =>
              run(async () => {
                const g = await createSampleGame();
                toast(`Added "${g.title}".`, 'success');
              })
            }
          >
            Add sample game
          </button>
        </div>
      </header>

      {showNotice && (
        <StorageNotice
          onDismiss={() => {
            setPinned(false);
            setDismissed(true);
            writeDismissed(true);
          }}
        />
      )}

      <section className="library-section" aria-labelledby="games-h">
        <h2 id="games-h">Games{games && games.length > 0 && <span className="count">{games.length}</span>}</h2>
        {games === undefined ? (
          <p className="hint">Loading…</p>
        ) : games.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">The table is empty.</p>
            <p>Start a new game, import a {EXPORT_EXTENSION} file, or add the sample roll-and-write to see how things fit together.</p>
          </div>
        ) : (
          <ul className="lib-grid">
            {games.map((g) => (
              <GameCard key={g.id} g={g} />
            ))}
          </ul>
        )}
      </section>
      <footer className="library-footer">
        Saved in this browser.{' '}
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            setDismissed(false);
            writeDismissed(false);
            setPinned(true);
          }}
        >
          About storage
        </button>
      </footer>
    </div>
  );
}
