import { lazy, Suspense } from 'react';
import { DialogHost } from '../components/DialogHost';
import { LibraryPage } from '../features/library/LibraryPage';
import { ErrorBoundary } from './ErrorBoundary';
import { parseHash, useHash } from './router';

const TableScreen = lazy(() => import('../features/table/TableScreen').then((m) => ({ default: m.TableScreen })));

export function App() {
  const route = parseHash(useHash());
  return (
    <ErrorBoundary>
      {route.name === 'library' ? (
        <LibraryPage />
      ) : (
        <Suspense fallback={<div className="center-message">Loading table…</div>}>
          <TableScreen key={route.id} id={route.id} mode={route.name} />
        </Suspense>
      )}
      <DialogHost />
    </ErrorBoundary>
  );
}
