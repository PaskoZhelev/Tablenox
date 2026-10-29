# Acceptance checklist (spec §13)

> Revision 2 replaced the template/session split with **one save per game** at the user's request (ADR-0011). Criteria 10, 11 and 14 are interpreted accordingly. Test names below are those of the current suites: E2E in `e2e/tablenox.spec.ts`, unit tests in `src/tests/`.

| #  | Criterion | Status | Evidence |
| -- | --------- | ------ | -------- |
| 1  | Create a game, upload a board image, add a card, save; no network API | ✅ | E2E *create a game: upload board, add card, move/resize/rotate, reload* |
| 2  | Edit mode repositions/scales/rotates; Play mode can't move a locked board | ✅ | E2E *create a game…* (drag, inspector resize, Transformer rotation handle, persisted after reload); E2E *boards stay put in Play mode unless made movable there; locking stops moving in both modes* |
| 3  | Wheel zoom keeps the pointer's world point fixed (zoom range now 5%–400%) | ✅ | `camera.test.ts` (500 random zooms); E2E *writing…* (real wheel events) |
| 4  | Pen mark aligns after pan/zoom and stays aligned | ✅ | E2E *writing…* (stroke coordinates match the pointer, unchanged after zooming); `camera.test.ts` drift test. Marks drawn on a sheet stay on it when the sheet moves: E2E *roll-and-write: marks, stamps and text belong to the sheet…*, `marks.test.ts` |
| 5  | Draw, erase, undo erasure, redo | ✅ | E2E *writing…*; `commands.test.ts` history tests |
| 6  | Typed numbers persist position across reload and zoom | ✅ | E2E *writing…* |
| 7  | Card drag + flip survive reload | ✅ | E2E *deck: face-down drawing is configurable; shuffle/draw persist; counter persists* (drawn and dragged cards after reload); `commands.test.ts` (flip) |
| 8  | Shuffle persists order; draw decrements; reload doesn't duplicate or re-randomise | ✅ | E2E *deck…*; `commands.test.ts` › deck rules |
| 9  | Die roll and counter persist across reload | ✅ | E2E *deck…* (counter after reload); E2E *dice: click selects and drags without rolling…*; die values are fields of `RollDie` (`commands.test.ts`), so a reload never re-rolls |
| 10 | ~~Session gameplay leaves template unchanged~~ → Edit/Play share one save; switching modes keeps progress | ✅ (revised) | E2E *one save per game: Play → Edit → Play keeps progress; reload keeps it; no extra saves*; use **Duplicate** to keep a pristine copy |
| 11 | ~~Two independent sessions~~ → independent copies via Duplicate | ✅ (revised) | E2E *duplicate game, modify duplicate, original unchanged…*; `game.test.ts` |
| 12 | IndexedDB save failure surfaces an error without losing in-memory work | ✅ | E2E *storage write failure shows a visible warning and export route; retry recovers* (simulated `QuotaExceededError`); `autosave.test.ts` |
| 13 | Export with images → clear data → import → board and cards load | ✅ | E2E *export, clear data, import restores board and cards with images*; `archive.test.ts` round trips (single game and whole library) |
| 14 | Deleting a game keeps images still used by other games | ✅ | `repository.test.ts` › *deleting a game keeps images that another game still uses* (images are now shared by content, see ADR-0031) |
| 15 | Chrome, Firefox, Edge; no console errors on the primary path | ✅ | The E2E suite runs on Chromium (Chrome/Edge engine) and Firefox via Playwright projects; tests assert no console errors on the primary paths |
| 16 | lint, typecheck, test, build pass; core E2E passes | ✅ | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` (also in `.github/workflows/tests.yml`) |

## Delivered since the original list

These were limitations or deferred items in earlier revisions:

| Item | Evidence |
| ---- | -------- |
| Multi-selection (Edit and Play mode) | ADR-0016, ADR-0024; E2E *edit mode: box-select with the camera locked…*, *play mode: Shift+drag box-selects movable pieces…* |
| Touch: pinch zoom, two-finger pan, long-press menu | ADR-0022; E2E *phone: one-row top bar, tap shows the action bar, long-press opens the menu…, pinch zooms…* |
| Configurable grid spacing and snap to grid | ADR-0031; E2E *roll-and-write…* (snap); `shortcuts.test.tsx` (`G`, grid-step nudges); `marks.test.ts` › snap to grid |
| Align and distribute a selection | ADR-0031; E2E *roll-and-write…* (align top edges); `objectActions.test.ts` › *aligns and distributes a selection* |
| Marks that belong to a sheet (move, turn, resize and delete with it) | ADR-0031; E2E *roll-and-write…*; `marks.test.ts` |
| Stamps (tick, cross, circle, dot, slash, star) | ADR-0031; E2E *roll-and-write…*; `marks.test.ts` › stamps |
| Manual card order inside holders | Card list ▲ / ▼ (ADR-0027), spread holders take drops where they land (ADR-0023) |
| Library backup: export all games, import several files | ADR-0031; `archive.test.ts`, `libraryPage.test.tsx` |
| Imports up to 100 MB; large exports warn before downloading | ADR-0031; `archive.test.ts` |
| Images stored once (SHA-256) and scaled down to 2048 px | ADR-0031; `repository.test.ts`, `archive.test.ts` |

## Known limitations

- Eraser removes whole strokes (no segment erasing); a stamp is one stroke.
- Holder snapping ignores holder rotation.
- Resize snapping applies to unrotated objects without a fixed aspect ratio (boards, images, cards, tokens and dice keep their ratio and resize freely); grid settings are the same for every game.
- Marks belong to boards and images only; a duplicated sheet starts without marks.
- Images uploaded before content hashing was added are never matched as duplicates.
- No PWA/offline cache; the app needs the static files to load.
