import { useCallback, useEffect, useState } from 'react';
import { navigate } from '../../app/router';
import { TableCanvas } from '../../canvas/TableCanvas';
import { fitToScene } from '../../canvas/actions';
import { Icon } from '../../components/Icon';
import { Inspector } from '../../objects/Inspector';
import { AutomationPanel, PickBanner } from '../../objects/ButtonEditor';
import { useTableStore } from '../../state/tableStore';
import { errorMessage, toast } from '../../state/uiStore';
import { HelpDialog } from './HelpDialog';
import { ObjectPalette, PaletteFileInputs } from './ObjectPalette';
import { paletteDropHandlers } from './paletteItems';
import { Toolbar } from './Toolbar';
import { SaveErrorBanner, TopBar } from './TopBar';
import { clearMarks, exportCurrent, useTableShortcuts } from './tableCommands';
import { flushActiveDocument, useGameDocument, useInitialCamera } from './useTableDocument';

export function TableScreen({ id, mode }: { id: string; mode: 'edit' | 'play' }) {
  const load = useGameDocument(id);
  const ready = load.status === 'ready' && useTableStore.getState().doc?.id === id;
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  useInitialCamera(ready, fitToScene);
  useTableShortcuts(openHelp);
  const uiHidden = useTableStore((s) => s.ui.uiHidden);
  const inspectorOpen = useTableStore((s) => s.ui.inspectorOpen);
  const automationsOpen = useTableStore((s) => !!s.automationButtonId);
  const paletteShown = useTableStore((s) => s.paletteOpen || s.ui.palettePinned);
  const setUi = useTableStore((s) => s.setUi);

  // The mode lives in the URL; switching never reloads or copies the game.
  useEffect(() => {
    useTableStore.getState().setMode(mode);
  }, [mode]);

  const onBack = async () => {
    try {
      await flushActiveDocument();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
    navigate({ name: 'library' });
  };

  if (load.status === 'missing' || load.status === 'error') {
    return (
      <div className="center-message">
        <h1>{load.status === 'missing' ? 'Not found' : 'Could not open'}</h1>
        <p>{load.status === 'missing' ? 'This game no longer exists in this browser.' : load.message}</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'library' })}>
          Back to library
        </button>
      </div>
    );
  }

  return (
    <div className={`table-screen mode-${mode}`}>
      <main className="canvas-wrap" aria-label="Table" {...(mode === 'edit' ? paletteDropHandlers : {})}>
        {ready ? <TableCanvas /> : <div className="center-message">Loading…</div>}
        {uiHidden ? (
          <button
            type="button"
            className="hud-btn hud-restore"
            aria-label="Show interface (U)"
            title="Show interface (U)"
            onClick={() => setUi({ uiHidden: false })}
          >
            <Icon name="menu" size={18} />
          </button>
        ) : (
          <>
            <TopBar
              onBack={() => void onBack()}
              onMode={(m) => navigate({ name: m, id })}
              onExport={() => void exportCurrent()}
              onHelp={openHelp}
              onClearMarks={() => void clearMarks()}
            />
            <Toolbar />
            {mode === 'edit' && paletteShown && <ObjectPalette />}
            {mode === 'edit' && automationsOpen && <AutomationPanel />}
            {mode === 'edit' && inspectorOpen && !automationsOpen && (
              <aside className="inspector-drawer" aria-label="Properties">
                <button
                  type="button"
                  className="hud-btn drawer-close"
                  aria-label="Close properties panel"
                  title="Close (I)"
                  onClick={() => setUi({ inspectorOpen: false })}
                >
                  <Icon name="close" size={16} />
                </button>
                <Inspector />
              </aside>
            )}
          </>
        )}
        <SaveErrorBanner onRetry={() => void flushActiveDocument()} onExport={() => void exportCurrent()} />
        {mode === 'edit' && <PickBanner />}
        {mode === 'edit' && <PaletteFileInputs />}
      </main>
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
