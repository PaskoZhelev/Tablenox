# Architecture Decision Records

Short records of choices that deviate from, or fill gaps in, `solo_tabletop_design_spec.md`.

## ADR-0001: oxlint instead of ESLint

**Context:** the spec suggests ESLint + Prettier. The project was scaffolded with oxlint (Vite's current react-ts template).
**Decision:** keep oxlint (`npm run lint`, config in `.oxlintrc.json`) and add Prettier for formatting.
**Consequences:** much faster linting with the React hooks rules enabled. Switching to ESLint later only needs a config, not code changes.

## ADR-0002: hash routing without a router library

**Decision:** a 30-line `useSyncExternalStore` hash router (`src/app/router.ts`) with routes `#/`, `#/edit/:id`, `#/play/:id`.
**Why:** three routes don't justify a dependency, and hash URLs need no SPA rewrite rules on Cloudflare Pages.

## ADR-0003: object geometry and locking semantics

- `position` is the **top-left corner of the unrotated box** in world units; rotation is about the object's centre. The Konva group uses `offset = size/2`, so rotation, transforms and drops don't drift.
- `locked` applies in **both** modes. Locked objects cannot be dragged or transformed, and dragging one pans the camera, so a locked sheet behaves like the table surface. They can be unlocked in Edit mode: from the selection action bar, the right-click menu or `L` (locking is setup, so Play mode doesn't offer it).
- New boards default to `locked: true` ("default board is locked"). Their size comes from the image's natural size (capped at 2000 units wide), so 100% zoom shows the image at native resolution.

## ADR-0004: deck model and drop rules (drop rules updated by ADR-0013)

- `deck.cards[0]` is the top card. `initialCards` is the full ordered definition used by **Reset**. In Edit mode both arrays are edited together.
- Drawing creates a card object carrying `sourceDeckId` and `cardDefId`. `DrawCard` contains the new card ID, so replaying a command is a no-op, and `ReturnCard` will not re-add a definition that is already in the deck. This prevents duplicates.
- In **Play** mode, dropping a card onto its own deck returns it to the top. In **Edit** mode, dropping any card onto a deck adds it to the deck definition.
- In Play mode the deck itself is not draggable: dragging from it draws the top card and hands the pointer to the new card (playingcards.io-style). Decks are moved in Edit mode.
- Holders snap cards whose centre lands inside: `stack` centres them; `spread` lays all contained cards out left-to-right by x position. Holder rotation is ignored for snapping in the MVP.

## ADR-0005: "Reset session" re-applies start-of-game shuffles (superseded by ADR-0011)

The session stores `initial`, a deep copy of the template taken at instantiation, before any shuffling. **Reset** dispatches `ReplaceTable(prepareStart(initial))`, which re-shuffles decks marked "Shuffle when a session starts". Reset is undoable. This matches what a player expects from a fresh start, rather than replaying the same deck order.

## ADR-0006: canvas input precedence

- The mouse wheel over the canvas **always zooms** about the cursor (`preventDefault` only on the canvas; the page itself doesn't scroll). Trackpad pinch (`ctrlKey` wheel) zooms with higher sensitivity.
- Pan with: drag on empty table or a locked object (Select tool), the Pan tool, Space + drag, or middle-drag.
- With Pen, Eraser or Text active, objects are not draggable, so writing never moves a sheet.
- The eraser radius is measured in **screen pixels** (consistent feel at any zoom); pen width is measured in **world units** (marks scale with the sheet).

## ADR-0007: storage is IndexedDB, not `localStorage`

The original request mentioned "local storage". The spec specifies IndexedDB, which is also local to the browser, and Tablenox uses it. `localStorage` is limited to about 5 MB of strings and would fail as soon as a few board images were uploaded. Nothing leaves the browser in either case.

## ADR-0008: export file format name

The spec's example manifest uses `"format": "solo-tabletop"`. Tablenox uses `"format": "tablenox"` and the extension `.tablenox.zip`, matching the product name. Everything else follows the spec's manifest shape.

## ADR-0009: test hooks

In development builds only (`import.meta.env.DEV`), the table store is exposed as `window.__tablenoxStore` so Playwright can assert on world-space state, such as stroke coordinates. Production builds don't include it.

## ADR-0010: text-based card faces

Cards and deck definitions have optional `faceText`/`faceColor` in addition to images. This lets "Standard 52" and "Numbered…" decks work without bundling third-party card art, and keeps cards usable before images are uploaded.

## ADR-0011: one save per game (supersedes the template/session split and ADR-0005)

**Context:** the spec separated reusable templates from play sessions, with a new session for every playthrough. In practice every "Play" click created another session, which led to thousands of saves. Switching Edit → Play then appeared to reset progress because it opened a fresh session.
**Decision:** a game is a single `Game` document (schema v2). Edit and Play are two views of it, switched in place (`#/edit/:id` ↔ `#/play/:id`, no reload), and every change autosaves over the same record. Annotations no longer have a template/session scope. "Reset session" and "shuffle on start" were removed; **Gather & reset** on a deck and library **Duplicate** cover those needs.
**Migration:** the IndexedDB upgrade to v2 collapses each template with its sessions into one game, keeping whichever was saved most recently. Sessions whose template had been deleted become one game per former template. The old stores are then dropped, and unused images are garbage-collected when the library opens. v1 export files still import.

## ADR-0012: minimal, game-first chrome

The canvas fills the window. All controls float: a compact top bar, a single collapsible tool column, a properties drawer (Edit mode, closed by default), a contextual action bar next to the selected object, and a right-click menu. `U` hides everything except a small restore button. Panel preferences are stored in `localStorage`; these are UI preferences only, not game data.

## ADR-0013: card stacking, piles and free placement

- While a card is dragged, the deck or card under its centre is highlighted (faded, with a yellow outline). On release, the card goes on top of that deck, or both cards form a **pile**: a deck with `isPile: true` that disappears when it is emptied.
- In Play mode a card can be dropped on **any** deck or pile. `CardDef` carries its own back and optional `faceUp`, so mixed piles render correctly. **Gather & reset** removes a deck's own cards from the table and from every other deck or pile, returns foreign cards to their own deck (or onto the table), and restores the definition order.
- Holding **Shift** while dropping skips stacking and holder snapping. Shift+drag on a deck in Play mode moves the deck instead of drawing from it.

## ADR-0014: clicks never roll dice

A single click only selects, so dice can be dragged without accidental rolls. Rolling uses double-click, the action bar, the right-click menu or `R`. Double-clicks are detected manually (two primary-button clicks on the same object within 400 ms), because Konva's `dblclick` also fires for a left+right click pair, which opened the context menu and triggered the double-click action at the same time.

## ADR-0015: table polish (revision 3)

- **No selection outline.** The dashed selection border was removed; the floating action bar identifies the selected object, and Edit mode keeps the resize/rotate handles.
- **Deck handle.** The count badge is a drag handle: in Play mode, dragging it moves the whole deck (same as Shift+drag), while dragging the deck body draws a card.
- **Card zoom on hover** (UI preference, off by default): after a 250 ms hover, face-up cards and face-up pile tops are shown large in a separate small Konva stage that reuses the card renderer, so the preview matches the table exactly. *Superseded by ADR-0016 (per-object zoom).*
- **Camera lock** (UI preference): plain drags on the table or on locked objects no longer pan. Explicit panning (Pan tool, Space+drag, middle button) and wheel zoom still work.
- **Table colour** is stored per game (`Game.tableColor`, optional), saved like the title and not part of undo history.
- **Custom dice.** `DieObject.faces?: DieFace[]` (label and/or image). When present, it replaces the numbered `sides`; `value` stays the 1-based index of the face shown. Rolling, value clamping, asset tracking and import/export all work on the face count. Optional fields keep schema v2 backward compatible.

## ADR-0016: per-object zoom, multi-select, card identity (revision 5)

- **Zoom on hover is per object.** `BaseObject.hoverZoom?: 'off' | 'small' | 'medium' | 'large' | 'xlarge'` replaces the global UI toggle (and the `Z` shortcut). Missing means off; table cards without their own value use their home deck's value, piles use the deck owning their top card. Card previews only ever show faces. *ADR-0023: previews also show backs, and holders inherit too.*
- **Cards keep their own size and back.** A card inside a deck that does not own its definition never takes that deck's size or back image. `CardDef.width/height` are stored when they differ from the owning deck; back images fall back only to the owning deck. The deck renders its top card at that card's size, centred.
- **Multi-select (Edit mode).** The store keeps `selectedIds` next to the primary `selectedId`. The Konva Transformer is attached to every selected unlocked node, so dragging one drags all (Konva behaviour); each node's drop is a free move, coalesced into a single undo step. Ctrl/Shift+click toggles membership; Shift+drag on the table (or any drag when the camera is locked) draws a selection box that selects fully enclosed objects.
- **Holders follow their rotation.** Stack/spread layouts are computed in holder space and rotated; with `HolderObject.alignRotation`, dropped objects take on the holder's rotation (`MoveObject.rotation`).

## ADR-0017: picked-up look and moving piles (revision 6)

- **Picked-up look (Play mode only).** While dragged in Play mode, an object's inner `lift` group tweens to +3° and ×1.04, and a blurred, blackened copy of the object is rendered behind it as a shadow, so the shadow follows the real silhouette (round tokens, transparent images). Konva only draws shadows per shape, not per group, hence the copy; it is cached at ≤ 240 px so blurring large boards stays cheap. The outer node's position/rotation are untouched, so drop maths is unaffected. Edit-mode drags keep the plain look, for precise placement.
- **Piles move as a unit.** A pile dropped on a deck or pile is merged with `MergePileIntoDeck`: its cards go on top in order, using the same orientation rule as single cards, and the pile disappears. In Edit mode, dropping on a (non-pile) deck also moves the card definitions to that deck, freezing each card's current size/back. Piles and decks dropped in a holder snap like cards (centred in a stack holder, laid out in a spread holder).

## ADR-0018: automation buttons

- **A button is an object.** `ButtonObject` (`kind: 'button'`: `label`, `color`, `textColor`, `steps: ButtonStep[]`) lives in `objects[]`, so it is saved, duplicated, undone and exported like everything else. Schema v2 stays valid (a new optional kind). Steps are a discriminated union on `type`: `move`, `recall`, `rotate`, `flip`, `shuffle`, `sort`, `roll`, `counter`; each lists `objectIds` (a holder stands for the pieces lying in it, see `resolveTargets`).
- **Steps compile to commands, not to new reducers.** `planButton(table, button, random)` in `domain/buttons.ts` applies each step's commands to a working copy so later steps see earlier effects (cards drawn by a move step can be flipped by the next step), and returns one `Batch`. Random values and new card ids are decided while planning, so the batch replays deterministically and the whole run is one undo step. Only `SortDeck` is new in the reducer.
- **Moves reuse the drop rules** (updated by ADR-0019). Cards go into a holder or pile via `DrawCard` + `AddCardToDeck`, keeping their order; a holder in a step's object list gives up its cards (all, or N from the top/bottom) and never moves itself. Onto any other object, the first card is centred on it and the next ones form a pile with it (`MergeCards`), so the count badge shows. Other pieces are centred on the destination (taking a holder's rotation when it asks for that).
- **Recall** returns cards to their home holder and gathers decks and piles with `ResetDeck`; other pieces are left alone (no remembered home position).
- **Play mode.** A click runs the button (`ObjectNode`, ignoring clicks that were camera drags); buttons are neither draggable nor selectable there, and they sink (scale 0.95, darker, no shadow) while the pointer is held on them. The label size is `fontSize` or automatic, and `fitFontSize` always shrinks it to fit the button, word-wrapped. Missing objects are skipped, and steps list them as "missing object" in the editor.
- **Picking objects on the table.** `picking: { buttonId, stepId, field }` in the table store (not undoable, Edit mode only) puts the canvas in pick mode: objects aren't draggable, the Transformer hides, clicks call `pickOnTable` (toggle) instead of selecting, Shift+drag (or any drag with the camera locked) draws a box whose fully enclosed objects are added, other drags pan. `canPick`/`applyPick` (domain) decide which objects a step accepts. Picked objects get a dashed blue outline. Pick mode (also for a destination, where a click replaces it) ends with Esc, *Done picking*, closing the step, or the panel unmounting. Rapid picks coalesce into one undo step.
- **Automations panel.** A button's steps are edited in their own drawer (`AutomationPanel`), separate from the properties panel, which only shows the button's look plus an *Automations* button. `automationButtonId` in the store is independent of the selection, so clicking an object's name in a step selects it on the table (`focusObject`, which pans to it if needed) without closing the panel; while the panel is open the selected object gets a yellow outline, which also works for locked objects that have no Transformer. Esc deselects first, then closes the panel.
- **Flip on holders.** A holder resolves to itself plus the loose pieces lying on it; its cards (and piles) turn over as a whole (`FlipDeck`) when their top side isn't the requested one, loose cards flip individually.

## ADR-0019: decks are holders

**Context:** decks (card stacks with a definition, left behind as an "Empty deck" wrapper) and holders (zones that snapped loose cards) were two concepts that confused users, and automations moved the deck "wrapper" together with its cards.

**Decision:**

- **One container.** `kind: 'deck'` is now the **holder**: a zone that the cards live in. It gained the old holder fields as optional properties (`layout`, `color`, `label`, `alignRotation`) plus `cardWidth`/`cardHeight` (the size of the cards it owns, so resizing the zone never resizes its cards). A **deck** is just a holder with a card definition (`initialCards`). `HolderObject`/`kind: 'holder'` is gone. A **pile** (`isPile`) is still a loose stack without a zone that disappears when empty. The UI calls them "Holder" and "Pile" (`kindLabel`).
- **Layouts render, they don't move objects.** `stack` shows the top card (with one thin edge under it when there are 2+ cards); `spread` lays every card out along the zone, right-most = top (`cardSlots` / `spreadLayout`). In Play mode a press on a card draws it (`cardIndexAt` → `DrawCard.index`), and a card or pile dropped on a spread goes where it was dropped (`spreadInsertIndex` → `AddCardToDeck.index` / `MergePileIntoDeck.index`, previewed as a gap while dragging). Double-click turns a card over in place (`FlipDeckCard`). A holder shows no text unless it has a label (drawn above or below the zone); the count badge only shows when it has cards.
- **The stack moves, not the holder.** In Play mode, dragging a holder's count badge lifts all its cards out as a new pile (`TakeStack`, carrying the new pile id) and hands the pointer to it; the holder stays where it is. **Boards and holders are fixed in Play mode** (dragging them pans) and move freely in Edit mode, unless their `playMovable` flag is set. `locked` keeps its meaning (no moving in either mode); new boards are no longer locked.
- **Drop rules.** A card dropped on a holder or pile goes into it; on a card it forms a pile. A pile dropped on a holder or pile merges into it. Other pieces dropped on a holder only take its rotation (`alignRotation`). Holders and boards just move. **Every holder keeps each card's side** (like piles always did); cards without a stored side lie face down. Flipping all cards stores the side explicitly. A holder's `drawSide` decides the side a card has when taken out: `keep` (as it lies, the default for every new holder, decks included) or always `faceUp` / `faceDown` (`drawnFaceUp`). A deck is therefore exactly like any other holder; new holders are a card plus `HOLDER_MARGIN` on each side so the zone shows around the cards.
- **No migrations (testing phase).** The schema was reset to **v1** and the Dexie database to version 1 with only `games`, `assets` and `settings`; all upgrade code (the old template/session split, v2→v3) was removed. Local data from earlier builds has to be deleted; other schema versions are rejected on load and import.

## ADR-0020: bags, recall and "go to holder"

**Context:** tokens taken off a stack could not be put back, piles and cards had no one-step way home in Play mode, the card list sat below the cards' settings, and a pile in the editor did not say which holder it belongs to. Games also needed a container to draw random pieces from.

**Decision:**

- **Bag (`kind: 'bag'`).** `items: BagItem[]` (index 0 = top; cards, piles, tokens, dice, counters, labels, images — `bagAccepts`) holds **whole objects with their own ids**, so a piece that comes out is the very same object. Any object that was put into or drawn from a bag carries `bagId` (on `BaseObject`); that is the only "home" a loose piece has. Commands: `BagPut` (identical tokens join one entry), `BagDraw` (carries the table position and `newId`; from a token stack with several tokens one token comes out as `newId`), `ShuffleBag` (order decided outside the reducer), `RecallToBag` (puts back everything with that `bagId`). Dropping a card, pile or other piece on a bag is a `BagPut` (`resolveDrop`; Shift = free placement). Bags are surfaces like holders (stay at their z-level, fixed in Play mode unless `playMovable`; `hasPlayMovable`). In Play mode a drag from a bag draws a random piece (`randomBagIndex`, a token stack weighs one per token) and hands the pointer to it; Edit mode lists the contents in the inspector. `ResetDeck` also removes the holder's cards from bags.
- **Automation.** *Move* accepts bags as a source (top/bottom N pieces, token stacks one by one, `drawFromBag` in the planner) and as a destination (`deliver`); *Shuffle* accepts bags; *Recall* accepts every piece with a home: cards go to their bag first, otherwise their holder; a bag recalls everything with its `bagId`. The editor's pick lists follow `STEP_KINDS`.
- **Tokens remember their stack.** `SplitTokens` stores `sourceId` (the root of the family, so splitting a taken stack again still points at the original). `RecallToken` merges a token into its source when that still exists and `sameTokenLook`. The menu offers *Return to stack* on such a token and *Recall all tokens* on the stack; the Recall step does the same (a stack with tokens out recalls them all).
- **Piles and cards go home.** `ReturnPile` sends each card of a pile to the holder that owns its definition (cards without one stay; an empty pile disappears). Cards already had *Return to holder*.
- **Holder properties.** The *Card list* section (with its tools) is first, then *Holder*, then *Cards*. A card's and a pile's properties show *Go to <holder>* buttons (`focusObject`).
- **Schema.** Still v1 (no migrations in the testing phase): new optional `bagId` / `sourceId` and the new `bag` kind.
- **One face picker.** `pickDialog` (`uiStore`, rendered by `DialogHost`) shows a grid of faces for cards (*Pick a card…*, red suits in red via `cardTextColor`) and for dice (`pickDieFace`: images, labels, or pips for a standard d6 using the shared `DIE_PIP_LAYOUT`); it replaces the die-value dropdown in the action bar, the menu and the inspector.
- **Unnamed objects** are shown by their kind (`displayName`) in automation chips, pick lists, step summaries and the object list. Clicking an object in a step selects it and pulses a yellow outline around it on the table (`flashObject` → `FlashOutline`), so it is easy to spot.

## ADR-0021: object palette and checkboxes

- **Object palette instead of an Add dropdown.** `ObjectPalette` (`features/table`, items and drop handling in `paletteItems.ts`) is a floating grid of tiles grouped *Cards / Pieces / Table*, placed right of the tool column so it covers little of the table. It opens from the green *Add* button in the top bar, the green *+* at the top of the tool column, or `A`; it closes after adding, on Esc or an outside click, unless pinned (`ui.palettePinned`, saved with the other UI prefs; `paletteOpen` is transient and reset on mode change). Tiles are HTML5-draggable: dropping one on the table area adds the object centred on the drop point (`addObject(kind, { center })`). The image-file inputs (`PaletteFileInputs`) stay mounted in Edit mode so an upload finishes even if the palette closes.
- **Checkbox (`kind: 'checkbox'`)**: `checked`, `mark` (`check | cross | dot | fill`), `boxShape` (`square | circle | none`), `color` (mark), `boxColor`, `boxFill` (null = transparent). Field names avoid the token `shape` and board `fill`, so `ObjectPatch` stays a usable intersection. In Play mode a checkbox behaves like a button: no drag (a drag pans), no action bar, a click toggles it (`toggleCheckbox` → `UpdateObject`, one undo step); in Edit mode it moves normally and a double-click toggles it. The whole box is hit-testable even when transparent.
- **Check boxes step** (`type: 'check'`, `mode: toggle | check | uncheck`). A board in the list stands for every checkbox lying on it, a holder for the ones on it (via `resolveTargets`), so one step can clear a whole score sheet.
- **Defaults.** New bags have no name (nothing is printed on them; the UI shows "Bag"), and the default card back no longer shows a "T".

## ADR-0022: touch input and phone layout

**Context:** the game should be playable on a phone. Konva reports touch taps as `tap`/`dbltap`, never `click`, so a tap selected an object without showing its action bar, and the Text tool and step picking ignored taps. There was no pinch zoom, iOS never sends `contextmenu` (no way to open the full menu), and the top bar wrapped over the tool column on narrow screens.

**Decision:**

- **Taps are clicks.** `TableCanvas` handles Stage `click` and `tap` through one `handleClick` (selection bar, picking, Text tool). A click/tap arrives after the window's `pointerup` ended the gesture, so the last ended gesture (`lastGesture`) decides whether the pointer moved (a pan or selection box never selects on release). Double-tap reuses Konva's `dbltap` (`ObjectNode`, annotations).
- **Two-finger pinch / pan.** Capture-phase pointer listeners on the canvas container track touches that start on the canvas. A second finger cancels whatever the first started (pen stroke, pan, box, Konva drag) and every move applies `pinchBy` (`domain/camera.ts`: zoom by the distance ratio about the previous midpoint, then pan with the midpoint), so the world point between the fingers stays there. Camera only, never undoable.
- **Long-press = right-click.** 500 ms without moving more than 10 px opens the same menu as right-click (`openMenuAt`); the native `contextmenu` is ignored while touches are down. On the first touch, `Konva.dragDistance` becomes 6 px so a resting finger doesn't start a drag first.
- **No ghost taps.** `canvas/touch.ts` holds a flag set by a pinch or long-press and cleared when the next touch sequence starts; Stage taps, object taps / double-taps and counter buttons ignore taps while it is set. A non-passive `touchstart` on the canvas element prevents compatibility mouse events, the iOS callout and double-tap page zoom (Konva already does this on shapes); because that also stops the browser's focus change, a touch on the table blurs an open text field, and a touch that closes the text editor only closes it (as a mouse click does).
- **Keyboard on tap.** Mobile browsers only open the keyboard for a field focused inside the user gesture, so a tap with the Text tool (or a double-tap on a text annotation) renders the editor with `flushSync` and focuses it immediately (`focusTextEditor`).
- **Layout.** The top bar publishes its measured height as `--hud-top-h` on `.canvas-wrap`; the palette, drawers and pick banner sit below it. ≤ 640 px wide: one compact full-width top bar (title shrinks, icon-only mode switch, no separators, no *Add* since the tool column has the same **+**), full-width drawers. ≤ 640 px wide or tall: the tool column starts below the top bar and scrolls. `pointer: coarse`: larger HUD buttons, menu items and Transformer anchors, and 16 px fields (iOS zooms the page on focusing smaller text); touch-only devices hide shortcut hints. Menus, dropdowns and the help dialog are limited to the screen and scroll. *Fit everything* centres the scene in the space not covered by the top bar and tool column (`fitBounds` insets, ignored when they would take more than half the view) with less padding on small screens.

## ADR-0023: crisp card images, turned cards, spread direction, dealing to several destinations

**Context:** card images with small text were hard to read at normal zoom. Landscape cards needed a holder that shows portrait cards turned, in a row. Previews only showed faces, so face-down cards (and cards in holders other than their deck) never zoomed. A Move step could only target one object, so dealing one card to each of four holders took four steps.

**Decision:**

- **Mipmapped images.** Browsers shrink a large image in one `drawImage` step by sampling only a few source pixels, which makes fine print jagged and blurry. `useCrispImage(id, w, h)` (`objects/useAssetImage.ts`) draws a copy halved step by step (`mipLevel` / a cached chain of canvases per decoded image, each made with `imageSmoothingQuality = 'high'`) that still covers the on-screen size (camera scale times `devicePixelRatio`). The level is chosen in a store selector, so objects only re-render when it changes. The hover preview passes its own scale through `RenderScaleContext`. Used for boards, images, card faces and backs, and token images.
- **Turned cards.** `DeckObject.cardRotation` (holders only, whole degrees 0 to 359, missing = upright; presets 0/90/180/270 in the panel) turns every card the holder shows. `spreadLayout` gives each card a slot the size of the box around the turned card (`rotatedBox`), and `DeckVisual` draws the upright card turned about the slot's centre. Display only: cards keep their size and come out upright. (A first version had a `cardsSideways` flag; `parseGame` reads it as 90.)
- **Spread direction follows the long side.** A spread runs left to right when the holder is wider than tall and top to bottom otherwise (`spreadsVertically`); the top card is right-most / bottom-most and drawn last, `spreadInsertIndex` compares along the same axis. Rotating a holder rotates the whole spread with it.
- **Zone style.** New `strokeStyle` (`dashed` default | `solid`); `DEFAULT_HOLDER_FILL_OPACITY` is now 0 (only the outline shows).
- **Previews show what lies there.** Card previews show the back of a face-down card (backs aren't secret in a solo game). A spread previews the card under the mouse (`hoverCardId` in the store, set by `ObjectNode` with `cardIndexAt`). Holders and piles without their own setting use the setting of the deck that owns the card shown (`effectiveHoverZoom(state, o, cardId)`; the picker calls this *Same as the cards' deck*).
- **Swap buttons.** The properties panel can swap an object's width and height (keeping its centre) and a holder's card width and height.
- **Move to several destinations.** `MoveStep.targetIds` replaces the single `targetId` (`parseGame` turns an old `targetId` into a one-item list, since unknown keys would otherwise be dropped). With one destination nothing changes. With several, cards and pieces from each holder / pile / bag are **dealt** one to each destination in turn, round after round: `count` is how many each destination gets (missing = deal everything); loose pieces go one per destination in turn; a destination is never used as a source. Picking destinations on the table toggles them like the object list (`applyPick`), and the summary reads *Deal top 1 card of Deck to each of A, B, C*.

## ADR-0024: Play-mode box selection, Edit-mode holder previews, quieter holders

**Context:** in Play mode only one piece could be moved at a time. In Edit mode a holder laid out all its cards, which made decks heavy to work with while building, and the holder settings put the zone between the card list and the card settings. New holders were much larger than their cards, their outline was loud, a lone card in a holder still showed a count badge, and the default table was green.

**Decision:**

- **Box selection in Play mode.** Shift+drag on the table (any drag with the camera locked) draws the same selection box as in Edit mode, also when it starts on a fixed board, holder, bag, button or checkbox. It only selects what a player can move there (`movableInPlay`: visible, not locked, not `fixedInPlay`, not a button or checkbox) and adds to the current selection. The Transformer is attached to the members without resize / rotate handles, so dragging one moves the others (Konva behaviour), and `ObjectNode` drops them as plain moves with a shared coalesce key (one undo step), as in Edit mode. Members that aren't Konva-draggable in Play mode (piles, token stacks, movable holders / bags) start the group drag themselves after a few pixels (`group` gesture in `TableCanvas`), so dragging them moves the selection instead of dealing a card. A group gets no action bar or group menu in Play mode (the group actions are setup actions); the keyboard shortcuts for one object don't apply to a group.
- **Edit-mode holder preview.** In Edit mode `DeckVisual` draws a holder (not a pile) as its zone plus, when it has cards, a small picture of the top card's face with the card count below it (`HolderPreview`, `name="holder-preview"`); the cards themselves, the drop gap and the corner badge are not drawn. To stay consistent with what is shown, Edit mode places dropped cards on top of spread holders (`resolveDrop` only adds `index` in Play mode), double-click doesn't flip a holder's top card there, and hover previews the top card.
- **Holder panel order.** *Card list* (each card has ▲ / ▼, `moveCardDef`: swaps in `initialCards` and, when both are there, in `cards`), then *Cards* (now with *Use fronts as backs*, `withFrontAsBack`: turns on individual backs and copies each face image and colour to the back; backs never show text), then *Holder*.
- **Quieter defaults.** `HOLDER_MARGIN` is 6 (was 14); `DEFAULT_HOLDER_STROKE_OPACITY` = 0.2 when `strokeOpacity` is missing; the count badge shows from 2 cards; the default table colour (`--felt`, the thumbnail fallback and the colour picker) is grey `#3b3f46`.
