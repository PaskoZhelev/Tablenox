# Tablenox

Tablenox is an offline-first, **solo** virtual tabletop for the browser. Build a game from board images, cards, holders (decks), tokens, counters and dice in **Edit mode**, then play it in **Play mode**. Zoom deep into a roll-and-write score sheet, write and erase marks, and pick up where you left off.

Each game is **one save**. Edit and Play mode work on the same document, and every change overwrites it automatically. Use **Duplicate** in the library if you want to keep an untouched copy of a setup.

No account, no server and no cloud. Everything is stored in your browser (IndexedDB).

## Features

- **Library**: create, play, edit, rename, duplicate, delete, export and import games. Each game shows a sharp thumbnail of its table and when it was created and last played (opened in Play mode). Includes a built-in sample roll-and-write game.
- **Game-first interface**: the table fills the window. The controls are a small floating top bar, one compact tool column (collapsible) and a properties panel that is hidden until you open it (Edit mode). Press `U` to hide everything.
- **Object actions where you need them**: selecting an object shows a small action bar next to it (flip, draw, shuffle, roll, set die value, counter −/+, lock…). Right-click any object, including locked ones, for its full menu. **Play mode only offers what you do in a game** (draw, shuffle, flip, roll, gather & reset…); setup actions (lock, zoom on hover, how a holder deals and shows its cards, stacking order, movable in Play mode, duplicate, delete) are in Edit mode, which also keeps the game actions for preparing the starting state.
- **Editor**: the green **Add** button (top bar), the green **+** at the top of the tool column or `A` opens the **object palette**: tiles for every object (cards: card, deck, holder; pieces: token, die, counter, checkbox, bag; table: board from image, blank board, image, text label, automation button). Click a tile to add the object in the middle of the view, or **drag the tile onto the table** to place it there. The palette floats next to the tool column and closes after adding (or with Esc / a click elsewhere); **pin** it to keep it open while you build. A properties panel edits every property. Drag, resize and rotate objects with handles; lock/visibility; z-order. Undo/redo, optional grid.
- **Holders & decks**: a **holder** is a zone the cards live in; a **deck** is simply a holder filled with cards (Add → *Deck* gives you one with a standard 52). Its cards are shown **stacked** (drag takes the top card) or **spread out** side by side (drag takes the card you grab; a card or pile dropped on a spread goes **where you drop it**, and a gap opens there while you drag); switch with *Spread cards out / Show cards stacked* in its menu (Edit mode) or the properties panel. **Double-click** a holder or pile to turn its top card over in place (in a spread, the card you double-click). *Draw cards from top / bottom…* puts several cards next to the holder as **one pile** (in the order they had). A spread runs along the holder's longer side: left to right in a wide holder, top to bottom in a tall one. *Card rotation in the holder* turns the cards it shows by any angle (presets 0° / 90° / 180° / 270°; e.g. 90° for a row of portrait cards lying on their side); they come out upright. An empty holder shows nothing but its outline (the fill is transparent and the outline 20% opaque by default; Edit mode always draws the outline clearly so holders stand out over the grid); an optional *Label* appears above or below it (*Label position*), and *Holder colour / opacity*, *Stroke colour / opacity* and *Stroke style* (dashed or solid) style the zone. **In Edit mode** a holder with its own card list (a deck) shows a small *Deck (X cards)* note below it, with the size of the deck (counting cards that are out of it). New holders (decks included) are just a little larger than their cards so the zone stays visible. Resizing a holder never resizes its cards (set *Card width / height* instead; *Swap card width / height* turns portrait cards into landscape ones, and *Swap width / height* in the *Object* section does the same for any object). Cards put into a holder keep the side they had. Each holder's *Cards come out* setting decides the side a card has when taken out: **as it lies** (default; a new deck lies face down), **always face up** or **always face down**; cycle it with *Draws as they lie / face up / face down* in the action bar or menu (Edit mode). In the properties panel the *Card list* (with its tools: add cards from images, blank card, standard 52, numbered, clear, and ▲ / ▼ on every card to move it up or down) comes first, then the *Holder* section styles the zone (label, layout, colours, opacity), and then the *Cards* section holds everything about the cards (back colour / image, individual backs, *Use fronts as backs* (every card gets its face image and colour as its back too), card size, *Cards come out*, shuffle, gather & reset). A pile only offers *Cards come out*, *Shuffle* and *Return cards to holders*: its cards keep the look of the deck they belong to. A pile's and a card's properties have a **Go to <holder>** button that selects the holder they belong to. In Play mode a card's menu has *Return to holder*, and a pile's menu *Return cards to their holders* (each card goes on top of the holder that owns it; cards without one stay in the pile). While you drag a card over a holder or another card, the target fades and gets a yellow outline; dropping puts the card into the holder, or makes a **pile** with the other card (a loose stack that disappears when empty). Hold **Shift** while dropping to place the card freely. In Play mode, drag a holder's black count badge (shown from 2 cards on) to lift its **whole stack** out as a pile (the holder stays where it is); drop the pile on any holder to put the cards in. Drag a pile onto a holder or another pile to put all its cards on top. "Gather & reset" brings a deck's cards back from the table, from piles and from other holders. Press `S` to shuffle the selected holder. Other pieces dropped on a holder take its rotation when *Rotate objects to match holder* is on.
- **Picked-up look** (Play mode): while you drag an object it tilts slightly, grows a little and casts a soft shadow; it settles back when dropped. In Edit mode objects move without the effect.
- **Token stacks**: set *Tokens in stack* on a token (e.g. 25 green circles, 10 red squares) to make a stack with a count badge. In Play mode, dragging the stack takes one token off it; drag the badge (or Shift+drag) to move the whole stack; *Take a token* / *Take several tokens…* put tokens next to it. Dropping a token on an identical one (same shape, colour, image and size) stacks it again (Shift+drop places it freely). Tokens remember the stack they were taken off: *Return to stack* (on a token taken off a stack) and *Recall all tokens* (on the stack itself) in the menu, or a *Recall objects* automation step, put them back.
- **Bags**: Add → *Bag* is a container for cards, piles, tokens, dice, counters, labels and images. New bags have no name (give them one in the properties panel to print it on the bag). Drop a piece on it to put it in (identical tokens share one entry); the pieces are hidden and counted by a badge. In Play mode, drag from the bag (or use *Draw a random piece* / *Draw several pieces…* in its menu) to draw at random (a token stack counts once per token and gives up one token at a time); *Shuffle* (`S`) mixes the order; *Recall everything to the bag* brings back everything that came out of it (pieces also have *Return to bag*). Bags stay put in Play mode like holders unless *Movable in Play mode* is on (then Shift+drag moves them); in Edit mode the bag's properties list its contents with a *Take out* button per entry. Automation: *Move objects* can put things **into** a bag or take the top / bottom pieces **out** of it (onto a holder, a pile or any object), *Shuffle* mixes a bag, *Recall objects* sends pieces back to their bag (or empties everything out of the bag with the bag itself). A holder's *Gather & reset* also pulls its cards out of bags.
- **Pick a card**: *Pick a card…* in a holder's or pile's menu shows every card's face (top card first, red suits in red); the card you click is placed next to the holder, like *Draw cards from top / bottom…*.
- **Image thumbnails**: in the properties panel every uploaded image shows a small preview: image fields (boards, images, tokens, card faces / backs, deck backs), each card in a deck's card list, custom die faces and the object list.
- **Dice & counters**: a single click only selects, so dice drag reliably. Double-click or press Roll to roll. To choose the shown face, click the face button in the action bar, the right-click menu or the properties panel: every face is shown (pips, labels or images, like *Pick a card…*) and the one you click is turned up. **Custom dice**: in the properties panel set *Type → Custom faces* and give each face an image and/or a label (or add several faces at once from images). Counters have −/+ and an editable value.
- **Checkboxes**: Add → *Checkbox*. In Play mode a click checks or unchecks it (it doesn't move and shows no action bar there); in Edit mode double-click it to set how it starts. Choose the mark (*checkmark*, *cross*, *dot* or *filled*), the box (*square*, *circle* or *none*, which shows only the mark, handy for ticking boxes printed on a sheet), the mark and box colours and an optional background.
- **Automation buttons**: Add → *Automation button*, then press **Automations** in its properties panel (or *Automations…* in its action bar) to open the automations panel, which holds only the steps. Add steps with the step-type buttons. In Play mode a click runs the steps from top to bottom as **one undo step**; the button sinks while you hold it. Its label size is automatic (fits the button) or set by you, and always shrinks to fit. Step types: *Move objects* (onto a holder, a pile or any object; a holder or pile gives up all its cards or N from the top/bottom, face up/down, and the holder itself stays where it is; several cards moved onto a non-holder object form a pile; with **several destinations** the cards are dealt one to each in turn, N each, or all of them when no number is set, e.g. one card to each of four holders), *Recall objects* (cards back to the holder they belong to, tokens to their stack, pieces to their bag; a deck gathers all its cards, a token stack its tokens, a bag everything that came out of it; options: *Card rotation in the holders* turns the cards back to how they were set up (default) or keeps the turn a *Rotate* step gave them, *Face of recalled cards* as they come back / face up / face down, and *Shuffle after recalling*), *Rotate* (by/to an angle; a holder itself never turns: the cards in it and the pieces lying on it do), *Flip*, *Shuffle*, *Sort* (original order or by name), *Roll dice*, *Change counter* (add/set) and *Check boxes* (check, uncheck or toggle; a board or holder stands for every checkbox on it, e.g. to clear a sheet). Steps can be reordered with the arrows, edited by clicking them and deleted. Move steps are split into *What to move* and *Where to move it* (colour-coded) plus *Face of moved cards*. Choose a step's objects **on the table**: press *Pick on table* (or *Pick destinations on table*), then click objects to add or remove them, or **Shift+drag** a box to add several. Press *Done picking* or Esc to finish. Click an object's name in a step to select and outline it on the table. A holder in a step's object list stands for its own cards plus the pieces lying on it, so *Flip* on a holder turns all its cards over. The *Add from list…* menu is still there as an alternative. *Run (test)* tries a button in Edit mode.
- **Zoom on hover** (per object): pick *Off / Small / Medium / Large / Extra large* in an object's right-click menu (Edit mode) or properties panel. Works for decks, cards, boards, images, tokens, dice, counters and labels. Cards follow their deck's setting unless they have their own, and holders and piles without their own setting follow the deck of the card shown. Face-down cards show their back; in a spread the card under the mouse is shown. Once an object zooms, *Zoomed view* chooses whether the enlarged view is **always upright** (default) or **turned like on the table** (the object's rotation, plus the card rotation of a holder); cards, holders and piles can follow their deck's choice.
- **Multi-select (Edit mode)**: Ctrl/Shift+click objects, Shift+drag a selection box on the table, or (with the camera locked) just drag on the table. Drag any selected object to move them all; duplicate, lock or delete them all from the action bar, right-click menu, properties panel or `Ctrl+D` / `L` / `Delete`. `Ctrl+A` selects everything.
- **Multi-select (Play mode)**: Shift+drag a selection box on the table (or just drag with the camera locked) to select every piece inside that you can move in Play mode (cards, piles, tokens and stacks, dice, counters, labels, images, and holders / bags / boards set to *Movable in Play mode*; locked objects, fixed boards and holders, buttons and checkboxes are left out). Drag any of them, even a pile or a token stack, to move them all as one undo step. A click elsewhere clears the selection.
- **Lock camera**: toggle it in the tool column (or press `C`) so that dragging the table never pans (in Edit mode it draws a selection box instead). The wheel, the Pan tool and Space+drag still move the view.
- **Table colour**: choose it in the top bar's ⋯ menu (grey by default). It is saved with each game.
- **Moving and locking**: boards and holders move freely in Edit mode but stay put in Play mode (dragging them pans the view), unless you tick *Movable in Play mode* in the properties panel or right-click menu. Lock any object so it can't be dragged in either mode (dragging a locked object pans the view). Lock or unlock in Edit mode via the action bar, the right-click menu or `L`.
- **Zoom & pan**: the mouse wheel zooms about the cursor (5%–400%, so big tables still fit on a phone screen). Drag empty table space, hold Space, middle-drag, or use the Pan tool to pan. Fit and 100% controls are included; *Fit everything* keeps the scene clear of the floating top bar and tool column.
- **Phones & tablets**: play with touch. Tap an object for its action bar (its ⋯ opens every action), double-tap to flip / roll, long-press for the full menu (like right-click), pinch to zoom and drag with two fingers to pan (one finger on the empty table pans too). Dragging cards, tokens and pieces, drawing with the pen and typing text all work with a finger. On narrow screens the top bar becomes one compact row (icon-only mode switch; the palette opens from the tool column's **+**), the tool column scrolls when the screen is short, panels open below the top bar, and touch screens get larger buttons.
- **Drawing & writing**: pen (colours, widths, highlighter), whole-stroke eraser, typed text annotations, all in world coordinates so they stay aligned at every zoom level.
- **Autosave**: debounced saves to IndexedDB with a small status icon. On failure your work stays in memory, and a banner offers Retry and Export.
- **Portable files**: `.tablenox.zip` archives contain a JSON manifest plus all images. Imports are validated and transactional.

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:5173
```

### Commands

| Command             | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Start the Vite dev server                                |
| `npm run build`     | Type-check and build static assets into `dist/`          |
| `npm run preview`   | Serve the production build locally                       |
| `npm run typecheck` | TypeScript project build (app, tests, e2e)               |
| `npm run lint`      | Lint with oxlint                                         |
| `npm test`          | Unit / component tests (Vitest)                          |
| `npm run test:e2e`  | End-to-end tests (Playwright, starts its own dev server) |
| `npm run format`    | Format with Prettier (`format:check` to verify)          |

Before the first E2E run, install the browsers: `npx playwright install chromium firefox`.

## Controls & keyboard shortcuts

| Input                            | Action                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| Drag                             | Move an object (locked objects, and boards/holders in Play mode, pan the view instead) |
| Drag a card onto a card / holder | Put it into the holder, or make a pile (target fades while hovering) |
| Drag a pile onto a holder / pile | Put all its cards on top                                      |
| `Shift` + drop                   | Place freely: no stacking, no holder rotation                 |
| Drag from a holder               | Take its top card (stacked) or the grabbed card (spread) (Play mode) |
| Drag a token stack               | Take one token off it; drag its badge or Shift+drag to move the whole stack (Play mode) |
| Drag a holder's count badge      | Lift its whole stack out as a pile; the holder stays (Play mode) |
| Drag from a bag                  | Draw a random piece out of it (Play mode); drop a piece on a bag to put it in |
| Double-click                     | Flip card · roll die · turn over a holder's top card (in a spread: the clicked card) |
| Right-click                      | Action menu for an object (Play mode: game actions only; Edit mode: also lock, zoom on hover, order, delete…) |
| `Ctrl/Shift` + click             | Add to / remove from the selection (Edit mode)                |
| `Shift` + drag table             | Selection box (plain drag when the camera is locked); in Play mode it selects the pieces you can move |
| `V` `H` `P` `E` `T`              | Select, Pan, Pen, Eraser, Text tool                           |
| `F`                              | Flip selected card, or all cards of the selected holder       |
| `S`                              | Shuffle selected holder or bag                                |
| `R` / `Shift+R`                  | Roll selected die / rotate selected piece 90°                 |
| `L`                              | Lock / unlock selected object(s) (Edit mode)                  |
| `U`                              | Hide / show the interface                                     |
| `C`                              | Lock camera on / off (dragging never pans)                    |
| `I`                              | Properties panel (Edit mode)                                  |
| `A`                              | Object palette (Edit mode)                                    |
| `?`                              | Controls & shortcuts dialog                                   |
| `Ctrl/Cmd+Z`                     | Undo                                                          |
| `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y` | Redo                                                          |
| `Delete` / `Backspace`           | Delete selected object(s) (Edit mode) |
| `Ctrl/Cmd+D`                     | Duplicate selected object(s) (Edit mode)                      |
| `Ctrl/Cmd+A`                     | Select all (Edit mode)                                        |
| Arrow keys (`Shift` = 10)        | Nudge selected object(s) (Edit mode)                          |
| `+` `-` `0` `Shift+F`            | Zoom in, zoom out, 100%, fit everything                       |
| `Space` + drag                   | Pan                                                           |
| `Esc`                            | Close menu / cancel text / deselect / back to Select tool     |
| Touch: tap · double-tap          | Select and show the action bar · flip card, roll die, turn over a holder's top card |
| Touch: long-press                | Action menu for an object (like right-click)                  |
| Touch: pinch · two-finger drag   | Zoom · pan                                                    |

Shortcuts are ignored while typing in an input.

## Browser storage caveats

- Data lives **only in this browser profile** (IndexedDB database `tablenox`). It is not synced.
- When you first open this version, older data (separate templates and play sessions) is merged automatically: each template becomes one game, keeping whichever is newer, the template or its most recent session.
- Clearing site data, using a private/incognito window, or browser storage eviction can delete your games. **Export regularly.**
- The library shows current storage usage and offers a "keep data" button that calls `navigator.storage.persist()`. Browsers may decline this.
- Images are limited to 10 MB each (PNG, JPEG, WebP; SVG is rejected). Imports are limited to 50 MB.

## Import / export format

An export is a ZIP file named `<title>.tablenox.zip`:

```
manifest.json
assets/<assetId>.png|jpg|webp
```

`manifest.json`:

```json
{
  "format": "tablenox",
  "schemaVersion": 1,
  "exportType": "game",
  "exportedAt": "2026-10-26T00:00:00.000Z",
  "data": { "...": "Game (see src/domain/types.ts)" },
  "assets": [{ "id": "…", "name": "sheet", "mimeType": "image/png", "sizeBytes": 12345, "path": "assets/….png" }]
}
```

Only files with the current schema version import (the app is still in testing, so there are no upgrades of older formats).

On import, Tablenox:

- rejects unsafe paths (anything other than `manifest.json` and `assets/<id>.<ext>`), archives with more than 2,000 entries, files larger than 10 MB, total uncompressed data over 200 MB (checked before inflating), unsupported schema versions, and images whose bytes don't match a PNG, JPEG or WebP signature;
- validates all game data with Zod (`src/domain/schema.ts`);
- assigns fresh IDs to the document and its assets, then writes everything in one IndexedDB transaction.

## Deploying to Cloudflare Pages

The app is a static site with no server code and no Cloudflare-specific APIs.

1. Push the repository to GitHub/GitLab.
2. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** and pick the repository.
3. Build settings: **Framework preset** `Vite` (or None), **Build command** `npm run build`, **Build output directory** `dist`, environment variable `NODE_VERSION=20` (or newer).
4. Deploy. Hash-based routing (`#/edit/…`, `#/play/…`) means no SPA redirect rules are needed.

Alternatively, deploy with Wrangler: `npm run build && npx wrangler pages deploy dist --project-name tablenox`.

## Project layout

```
src/
  app/            router, shell, error boundary
  components/     general UI widgets (dialogs, fields, icons)
  canvas/         Konva stage, camera interaction, transformer, shared actions
  objects/        per-object renderers and the inspector
  drawing/        annotation layer and text editor overlay
  domain/         types, Zod schemas, commands, rules, camera, randomness, history (pure TS)
  persistence/    Dexie database, repository, asset validation, autosave
  import-export/  ZIP manifest export/import with validation
  features/       library page and table screen (edit/play)
  state/          Zustand stores
  tests/          unit and component tests + fixtures
e2e/              Playwright end-to-end tests
docs/adr/         architecture decision records
```

The `domain/` folder has no React or Konva dependencies. All mutations go through named commands (`src/domain/commands.ts`), and their random outcomes (shuffle order, die value) are computed before dispatch, so reloading never re-rolls.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [docs/ACCEPTANCE_CHECKLIST.md](docs/ACCEPTANCE_CHECKLIST.md).
