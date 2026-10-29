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
- **Move to several destinations.** `MoveStep.targetIds` replaces the single `targetId` (`parseGame` turns an old `targetId` into a one-item list, since unknown keys would otherwise be dropped). With one destination nothing changes. With several, cards and pieces from each holder / pile / bag are **dealt** one to each destination in turn, round after round: `count` is how many each destination gets (missing = deal everything); loose pieces go one per destination in turn; a destination is never used as a source. Picking destinations on the table toggles them like the object list (`applyPick`), and the summary reads *Move top 1 card of Deck to each of A, B, C* (move steps are always summarised as *Move…*, the step's name).

## ADR-0024: Play-mode box selection, Edit-mode holder visibility, quieter holders

**Context:** in Play mode only one piece could be moved at a time. In Edit mode holders were hard to tell apart from the grid once their outline became faint. New holders were much larger than their cards, their outline was loud, a lone card in a holder still showed a count badge, and the default table was green.

**Decision:**

- **Box selection in Play mode.** Shift+drag on the table (any drag with the camera locked) draws the same selection box as in Edit mode, also when it starts on a fixed board, holder, bag, button or checkbox. It only selects what a player can move there (`movableInPlay`: visible, not locked, not `fixedInPlay`, not a button or checkbox) and adds to the current selection. The Transformer is attached to the members without resize / rotate handles, so dragging one moves the others (Konva behaviour), and `ObjectNode` drops them as plain moves with a shared coalesce key (one undo step), as in Edit mode. Members that aren't Konva-draggable in Play mode (piles, token stacks, movable holders / bags) start the group drag themselves after a few pixels (`group` gesture in `TableCanvas`), so dragging them moves the selection instead of dealing a card. A group gets no action bar or group menu in Play mode (the group actions are setup actions); the keyboard shortcuts for one object don't apply to a group.
- **Edit-mode holders (revised).** A first version drew Edit-mode holders as a small picture of the top card with a count instead of their cards, and moved the *Cards* section above *Holder*; both were reverted after feedback. Edit mode shows the cards as Play mode does, and the panel order is again *Card list*, *Holder*, *Cards*. Instead, Edit mode draws a holder's outline at least 85% opaque (`EDIT_MIN_STROKE_OPACITY`; the faint 20% default stays for Play mode, where it doesn't compete with the grid) and a deck (a holder with `initialCards`) shows *Deck (N cards)* below its zone, N being the whole deck, including cards that are out.
- **Card list tools.** Each card has ▲ / ▼ (`moveCardDef`: swaps in `initialCards` and, when both are there, in `cards`); the *Cards* section has *Use fronts as backs* (`withFrontAsBack`: turns on individual backs and copies each face image and colour to the back; backs never show text).
- **Quieter defaults.** `HOLDER_MARGIN` is 6 (was 14); `DEFAULT_HOLDER_STROKE_OPACITY` = 0.3 (was 0.2) when `strokeOpacity` is missing; the count badge shows from 2 cards; the default table colour (`--felt`, the thumbnail fallback and the colour picker) is grey `#3b3f46`.

## ADR-0025: turning a holder's cards, recall options, turned hover previews, smaller zoom floor, library details

**Context:** a Rotate step on a holder turned the whole zone, but a holder in a step stands for what is in it. A Recall step always gathered cards face down, in order, and had no say about rotation. Hover previews were always upright. Zoom stopped at 25% (the MVP range of the design spec), too close for big tables on phones. Library thumbnails were 320 px JPEGs (quality 0.7) rendered in one big downscale, so they looked blurry and jagged on high-DPI screens; the cards showed an object count nobody needed.

**Decision:**

- **Rotate turns a holder's cards.** `planRotate` never rotates a holder (`isHolder`): it sets `DeckObject.cardTurn`, an extra turn on top of the set-up `cardRotation` (`cardRotationOf` adds both; "rotate to" stores the difference, none when it matches the set-up angle). Pieces lying on the holder still rotate (as before, via `resolveTargets`). Keeping the turn separate means the set-up angle is never lost, so it can be restored.
- **Recall options** (`RecallStep.rotation` `reset` (default) | `keep`, `orientation` `keep` (default) | `faceUp` | `faceDown`, `shuffle`). They apply to every holder and bag the step gathers into (listed holders, reset decks, the homes of recalled cards, recalled bags), after gathering: clear `cardTurn`, set every card's side, shuffle (randomness from the button's `RandomSource`). `ResetDeck` clears `cardTurn` (so *Gather & reset* turns the cards back) unless `keepCardTurn`, which the Recall step always passes and handles itself.
- **Turned hover previews.** `BaseObject.hoverRotate` (*Zoomed view*: always upright | turned like on the table), shown next to *Zoom on hover* once the object zooms; inherited like the zoom size (`effectiveHoverRotate`, shared `hoverSettingsDeck`). `HoverPreview` turns the upright preview by `hoverRotationOf` (object rotation plus a holder's card rotation) inside a stage sized to the turned box (`rotatedBox`).
- **Zoom 5%–400%** (`MIN_ZOOM` = 0.05). The grid already adapts its spacing, so it doesn't get denser.
- **Library.** Thumbnails are rendered at about twice their 640 px width (up to pixel ratio 2 on narrow screens), shrunk in halving steps with high-quality smoothing, and saved as JPEG 0.85; the Edit-mode grid and the Transformer are hidden while capturing. Existing thumbnails improve the next time the game is saved. Game cards show *Created* and *Last played* (`Game.lastPlayedAt`, set when a game is opened in Play mode with `repo.markPlayed`, which doesn't change `updatedAt`; `persist` takes it from the store so an older snapshot can't overwrite it; duplicates start unplayed). The header says *Solo Virtual Tabletop*.

## ADR-0026: rotation angles per object, library search and views, fronts / backs in the card list

**Context:** the Rotate action and `R` always turned by 90°. Some pieces should never turn, some only flip end over end, others need 45° steps. With many games the library needed a way to find and scan them. A deck's back settings sat far from its card list, although fronts and backs are edited together. Recalled cards are normally wanted face down.

**Decision:**

- **Rotation angles.** `BaseObject.rotations?: number[]` (multiples of 45°, at least one; missing = 0/90/180/270). The Rotate action and `R` / `Shift+R` go to the next allowed angle clockwise / anticlockwise (`nextRotation`; between two allowed angles, to the nearest one in that direction); with a single angle there is no Rotate action and `R` does nothing. Cards and piles without their own setting use their deck's (`effectiveRotations`, through the same deck lookup as the hover settings), so one setting on a deck covers every card drawn from it. Only player rotation is limited: Edit-mode handles, the *Rotation°* field and automation Rotate steps are setup or scripted and stay free. Piles (and holders where they may move) also get the Rotate action. The properties panel shows eight toggle buttons; the last allowed angle can't be switched off.
- **Library.** A toolbar above the games: search (every word must appear in the title, case and accents ignored), sort (last changed (default), last played (never-played last), newest first, name with natural number order) and grid / list view. Sort and view are UI preferences in `localStorage` (`tablenox.library`), not game data. Filtering and sorting are a pure function (`filterAndSortGames`) so they are unit-tested.
- **Card list = fronts and backs.** The holder's *Card list* section has a *Fronts* subsection (tools and the list) and a *Backs* subsection below it (back colour / image, individual backs, *Set backs from images*, *Use fronts as backs*). *Cards* keeps size, how cards come out and come in, shuffle and gather & reset; the zone's colours and outline are in the *Object* section, below *Rotation angles*.
- **Recall default.** A Recall step's *Face of recalled cards* defaults to face down (missing `orientation`); *As they come back* is now an explicit choice.

## ADR-0027: card copies in a deck, image token stacks, library button, more table colours

**Context:** decks often hold several copies of the same card (e.g. 12 wood, 10 stone, 8 gold), but every copy had to be added and edited one by one. Token stacks drew darkened copies of the token shape under the top one, which looked like black shapes under image tokens. The top bar's back arrow next to the Edit / Play switch was mistaken for "back to Play mode". Only eight table colours were offered, all dark or mid-tone.

**Decision:**

- **Copies are real cards, shown as one row.** No count field on `CardDef`: every copy stays a separate definition with its own id, so drawing, piles, recall, *Gather & reset*, ownership (`homeDeckOf`) and hover settings keep working unchanged. The card list groups runs of identical neighbouring definitions (`cardGroups`, `sameCardLook`: name, face, back, size) into one row with a **× copies** field (`setCardCopies`: new copies are inserted after the row, and in the holder after its last copy there or at the bottom; fewer copies drop the last ones). Editing a row, its back, removing it and ▲ / ▼ (`moveCardGroup`) act on all its copies; *Set backs from images* assigns one image per row. A holder's cards follow a row move only while it still has every card in list order. `numberedDeck` now puts the copies of each number next to each other so "1-10x2" lists as ten rows of two. The field commits on Enter / blur, so typing "12" never creates and deletes copies in between.
- **Image token stacks** draw a small dashed zone around the top token (holder grey, `name="token-stack-zone"`) instead of darkened copies peeking out; coloured shape tokens keep the peeking look. *(Superseded by ADR-0028: no zone any more.)*
- **Library button.** The top bar starts with a house icon (*Back to library*), separated from the title and the Edit / Play switch.
- **Table colours.** Sixteen swatches from near black to white (including parchment, off-white and light grey). On light tables the Edit-mode grid draws dark lines (`isLightColor` in `canvas/colors.ts`).

## ADR-0028: timers, figure tokens, card-list copies controls, picking only on the table

**Context:** real-time games and timed turns need a clock on the table. Tokens only came as flat geometric shapes, while many games use pawns, meeples, cubes and discs. Setting copies one card at a time was slow for large imported decks (e.g. 50 images × 3), the native number spinners only appeared on hover and only applied on blur, and in a narrow properties panel the name and face-text fields were squeezed to nothing. Automation steps offered both table picking and an *Add from list…* menu, which was redundant. The image token-stack outline looked like a holder.

**Decision:**

- **Timer object** (`kind: 'timer'`: `label`, `mode` `countdown | stopwatch`, `duration` seconds, `color`, `textColor`, `sound`, plus the run state `elapsedMs` and `startedAt?`). The run state is part of the saved game, so a running timer survives reloads, and **start / pause / reset are commands** (`StartTimer` / `PauseTimer` carry the time `at`, decided outside the reducer; `ResetTimer`), undoable like dice rolls. `domain/timer.ts` derives the shown time (`timerElapsed`, `timerText`: countdowns round up so 0:00 means done; stopwatches round down) and the toggle (`timerToggleCommand`: a finished countdown restarts). The visual ticks only while running, flashes red at 0:00 and beeps once per run (WebAudio, `objects/beep.ts`; deduplicated by `id:startedAt` so the drag shadow doesn't beep twice). On-canvas ▶ / ❚❚ and ↺ are `ui-button`s like the counter's −/+.
- **Figure tokens.** `TOKEN_SHAPES` adds diamond, heart, pawn, meeple, cube and cylinder, drawn as SVG paths in a 100 × 100 box scaled to the token (`TOKEN_PATHS`; cube and cylinder add a shaded face). The palette gets *Pawn* and *Meeple* tiles (`PaletteItem.tokenShape`).
- **Copies controls.** Each row has − / + buttons (and ↑ / ↓ keys) that apply at once; typed numbers still commit on Enter / blur. *Set copies for all cards…* (`setAllCardCopies`, a button below the card list) sets every row at once. The face-text field is hidden for cards with a face image (text is never drawn on them), and the row layout is compact enough for a narrow panel (wrapping only if it still overflows).
- **Picking only on the table.** Step object lists and destinations are chosen with *Pick on table* (click / Shift+drag); the *Add from list…* menus are gone.
- **Move steps always read *Move…*** in their summary (*Move top 1 card of Deck to each of A, B*; *Move Deck to A, B in turn*), matching the step's name.
- **Quieter but visible holders:** `DEFAULT_HOLDER_STROKE_OPACITY` is 0.3. **Image token stacks** show only the top token and the count badge (no outline, no peeking copies).

## ADR-0029: timer automation step, full screen, long-press card zoom, closable tool options, CI workflow

**Context:** timers could only be run by hand, although a turn button is the natural place to start one. Phones and tablets lose browser chrome space, and the only way to fill the screen was the browser's own menu. On touch screens there is no hover, so cards from a deck with *Zoom on hover* could never be seen enlarged; a long-press always opened the menu. The pen / eraser / text options panel could only be hidden by switching tools. Nothing ran the test suites outside a developer's machine.

**Decision:**

- **Timer step** (`TimerStep`, `mode` `start | pause | toggle | reset | restart`, only timers can be picked). `planButton` takes the time as a parameter (`now`, default `Date.now()`), like the random source, so plans stay deterministic and testable. `start` leaves a running timer alone but begins a new countdown when the running one has run out; `restart` always resets first.
- **Full screen** button in the tool column below *Fit everything*, with the corner-bracket icon (and inward brackets while active, following `fullscreenchange`, so Esc / F11 keep it in sync). *Fit everything* gets a "frame around content" icon; *Hide interface* uses the eye-off icon so no two controls share an icon. Hidden where the Fullscreen API isn't available (iPhone Safari).
- **Long-press zoom.** A long-press on a loose card whose effective hover zoom (its own or its deck's) isn't off shows the enlarged preview at once and keeps it while the finger is down, instead of opening the menu; lifting the finger hides it and the tap is suppressed. Everything the card menu offers is also on the action bar a tap opens, so nothing becomes unreachable. *Amended:* holding a card in a holder (the card under the finger, `cardIndexAt`) or a pile (its top card) works the same when that card's effective zoom is on (`pressPreviewOf` in `rules.ts`; the held card is `pressPreviewCardId`); the menu with *Pick card(s)…* etc. stays one tap away in the action bar's ⋯, and holding the empty part of a holder, or one without zoom, still opens the menu.
- **Tool options** have a close button; clicking the active tool again (or choosing another tool) shows them again. Not saved: a fresh visit shows the options.
- **CI**: `.github/workflows/tests.yml`, `workflow_dispatch` only for now. One job runs typecheck, lint, the Prettier check, unit tests and the build; a matrix job runs the e2e tests per browser (Chromium, Firefox) and uploads `test-results/` traces when they fail.

## ADR-0030: Pick card(s), the Pick cards step, menu sorting, shuffle animation

**Context:** *Pick a card…* took one card at a time and only showed fronts, although decks can give every card its own back. Automations could move cards only from the top or bottom, never cards a player chooses. Sorting existed only as an automation step, and a shuffle changed nothing visible on a stacked holder.

**Decision:**

- **Pick card(s).** The face picker (`PickRequest.multiple`, `pickManyDialog`) selects several items (click toggles, `aria-pressed`, ✓ badge) and confirms with *Take N cards*; `pickDialog` stays single-click for die faces. Cards carry their resolved back (`cardPickItems` in `actions.ts`), so a *Fronts / Backs* switch shows either side. Several picked cards come out as one pile in holder order (`DrawCards.cardIds`, `drawPickedCardsCommand`); the selection order doesn't matter, so the badge is a ✓, not a number.
- **Pick cards step** (`PickStep`: holders / piles in `objectIds`, destinations in `targetIds` like a Move step, `orientation`). Planning stays pure and synchronous: `planButtonRun(state, button, random, now, picks)` stops at the first holder without a choice and returns it (`PendingPick`, keyed `pickKey(stepId, holderId)`); `runButton` (now async) shows the dialog for the holder as the earlier steps left it, then plans again from the start with the choice added. It reuses one random seed (`seededSource`) and one `now` for the whole run, so a shuffle before the pick gives the same order every time and the dialog matches the result. Cancel stops the run; nothing is dispatched until the end, so it is still one undo step. `planButton` skips picks without a choice. The chosen cards go to one destination (holders / bags take them so the higher card stays on top), are dealt to several in turn, or without a destination come out next to the holder (one card, or one pile).
- **Sort** in the holder / pile menu (Play and Edit mode): one *Sort* entry whose options (original deck order, card name, and `SortBy` `reverse`, also in the Sort step) open right below it when clicked. Menu actions can carry `children` (`ObjectAction.children`): the right-click menu shows them as an indented group under the entry (`aria-expanded`) instead of running the entry; the action bar never shows such entries.
- **Shuffle animation.** `tableStore.dispatch` records which holders / piles / bags a command shuffled (`shuffledBy`, also inside batches) in the transient `shuffled { ids, seq }`; `ObjectNode` plays a ~450 ms riffle with a `Konva.Animation` (alternate `deck-card` nodes swing left and right; a bag wobbles as a whole) and restores the nodes' attributes afterwards. Undo / redo don't animate; `prefers-reduced-motion` turns it off.
- **Card images are decoded ahead.** A stacked holder draws only its top card, so a shuffle used to bring up a card whose image had never been loaded, and the default back design showed until it decoded. `DeckVisual` now preloads the side every card lies on (plus the other side of the top and bottom cards, for flips), and a card image that is still loading draws as a plain grey card (`LOADING_FILL`), never as the default back. A stack's edge under a card with a back image is neutral grey instead of the (unseen) back colour.
- *Amended:* **Cards chosen with the step.** A Pick step's `choose` is `edit` (new steps) or `run` (missing = `run`, so earlier steps keep asking). With `edit` the cards are set up in the automations panel (*Choose cards…* per listed holder → `chooseStepCards` → the same `pickManyDialog`, opened with `selectedIds` and `allowEmpty` so the choice can be changed or cleared) and stored as card definition ids per holder (`PickStep.cards`, `withPickCards`; removing a holder from the step drops its entry, `withPickHolders`). Definition ids are stable while a card is drawn and returned, so a holder offers its whole definition (`pickableCards`), not just the cards in it now. At run time `planPick` takes those that are still in the holder at that point (in holder order) and never stops for a dialog; others are skipped, so a set-up button puts a Recall step first. This makes one-click scenario set-ups possible (recall, take the scenario's cards, shuffle the rest, deal).
