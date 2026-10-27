# Acceptance checklist (spec §13)

> Revision 2 replaced the template/session split with **one save per game** at the user's request (ADR-0011). Criteria 10, 11 and 14 are interpreted accordingly, and the test names below refer to the current suite in `e2e/tablenox.spec.ts`.

| #  | Criterion | Status | Evidence |
| -- | --------- | ------ | -------- |
| 1  | Create template, upload board image, add a card, save; no network API | ✅ | `e2e/tablenox.spec.ts` › *create template, upload board, add card, save and reload* |
| 2  | Edit mode repositions/scales/rotates; Play mode can't move a locked board | ✅ | E2E *create template…* (drag, inspector resize, Transformer rotation handle, persisted after reload); E2E *play: locked board cannot move…* |
| 3  | Wheel zoom keeps the pointer's world point fixed (0.25×–4×) | ✅ | `camera.test.ts` (500 random zooms); E2E *writing…* (real wheel events) |
| 4  | Pen mark aligns after pan/zoom and stays aligned | ✅ | E2E *writing…* (stroke world coords = expected; unchanged after zooming); `camera.test.ts` drift test |
| 5  | Draw, erase, undo erasure, redo | ✅ | E2E *writing…*; `commands.test.ts` history tests |
| 6  | Typed numbers persist position across reload and zoom | ✅ | E2E *writing…* |
| 7  | Card drag + flip survive reload | ✅ | E2E *play…* |
| 8  | Shuffle persists order; draw decrements; reload doesn't duplicate or re-randomise | ✅ | E2E *play…*; `commands.test.ts` › deck rules |
| 9  | Die roll and counter persist across reload | ✅ | E2E *play…* |
| 10 | ~~Session gameplay leaves template unchanged~~ → Edit/Play share one save; switching modes keeps progress | ✅ (revised) | E2E *one save per game…*; use **Duplicate** to keep a pristine copy (E2E *duplicate game…*) |
| 11 | ~~Two independent sessions~~ → independent copies via Duplicate | ✅ (revised) | E2E *duplicate game, modify duplicate, original unchanged*; v1 data migration in `game.test.ts` and `dbUpgrade.test.ts` |
| 12 | IndexedDB save failure surfaces an error without losing in-memory work | ✅ | E2E *storage write failure…* (simulated `QuotaExceededError`, Retry recovers); `autosave.test.ts` |
| 13 | Export with images → clear data → import → board and cards load | ✅ | E2E *export, clear data, import…*; `archive.test.ts` round-trip |
| 14 | Deleting a game keeps images still used by other games | ✅ | `repository.test.ts` › *deleting a game keeps images that another game still uses* |
| 15 | Chrome, Firefox, Edge; no console errors on the primary path | ✅ | E2E suite runs on Chromium (Chrome/Edge engine) and Firefox via Playwright projects; tests assert no console errors on the primary paths. |
| 16 | lint, typecheck, test, build pass; core E2E passes | ✅ | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` |

## Known limitations / deferred (per spec §12)

- No multi-selection, snapping guides or configurable grid spacing.
- Holder snapping ignores holder rotation; no manual reorder inside holders.
- Touch pinch-zoom isn't implemented (the wheel and trackpad pinch work).
- Eraser removes whole strokes (no segment erasing).
- No PWA/offline cache; the app needs the static files to load.
