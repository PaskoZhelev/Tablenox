import { useEffect, useRef } from 'react';

const ROWS: [string, string][] = [
  ['Drag', 'Move a card, token, die… (locked objects, and boards / holders in Play mode, pan the view instead)'],
  ['Drag onto a card / holder', 'A card joins the holder, or makes a pile with the card; the target fades while you hover'],
  ['Drag a pile onto a holder / pile / card', 'Put all its cards on top (on a loose card: the card goes to the bottom of the pile)'],
  ['Shift + drop', 'Place freely, without stacking, snapping into a holder or slot, or snapping to the grid'],
  ['Drag from a holder', 'Take its top card (stacked) or the card you grab (spread out) (Play mode)'],
  [
    'Right-click a holder',
    'Draw several cards from the top or bottom (as one pile) · pick card(s) by their front or back · sort (original order, by name, reverse) · flip all cards · gather & reset; in Edit mode also stack / spread out and how cards come out (as they lie / face up / face down)',
  ],
  ['Drag the holder’s count badge', 'Lift its whole stack out as a pile; the holder stays put (Play mode)'],
  ['Drag a token stack', 'Take one token off it; drag its badge (or Shift + drag) to move the whole stack (Play mode)'],
  ['Drop a token on an identical one', 'Stack them (the count badge adds up)'],
  [
    'Right-click a token / pile / card / bag',
    'Recall all tokens (stack) or return to stack · return a pile’s cards, or a card, to its holder · draw from, shuffle and recall to a bag (Play mode)',
  ],
  ['Drag from a bag', 'Draw a random piece out of it (Play mode); drop a card, pile, token, die… on a bag to put it in'],
  ['Double-click', "Flip card · roll die · turn over a holder's top card (in a spread: the clicked card)"],
  ['Click a button', 'Run an automation button (Play mode): it sinks while held; buttons don’t move or show an action bar there'],
  ['Click a checkbox', 'Check / uncheck it (Play mode); double-click in Edit mode sets how it starts'],
  ['A · drag a palette tile onto the table', 'Open the object palette (Edit mode) · add the object where you drop it'],
  ['Pick on table (automation step)', 'Click objects to add / remove them · Shift + drag to add several · Esc / Done picking to finish'],
  ['Click', 'Select and show the quick action bar'],
  ['Ctrl / Shift + click', 'Add to or remove from the selection (Edit mode)'],
  [
    'Shift + drag table · drag with camera locked',
    'Selection box; drag any selected object to move them all (in Play mode it only picks pieces you can move)',
  ],
  [
    'Right-click',
    'Actions for an object: in Play mode only what you do in a game; in Edit mode also setup (lock, zoom on hover, order, delete…)',
  ],
  [
    'Right-click a selection',
    'Play mode: form a pile, flip cards, return cards to their holders, roll dice · Edit mode also: duplicate, lock, delete, align (left / centres / right / top / middles / bottom) and distribute (3+ objects; also in the properties panel)',
  ],
  ['Wheel', 'Zoom around the cursor'],
  ['Drag empty table / Space + drag', 'Pan'],
  ['V H P M E T', 'Select, Pan, Pen, Stamp, Eraser, Text tool'],
  [
    'Pen · Stamp · Text on a sheet',
    'Marks made on a board or image belong to it: they move, turn and resize with it and go when it is deleted; elsewhere they stay on the table',
  ],
  [
    'M · click',
    'Stamp a tick, cross, circle, dot, slash or star where you click (shape, colour and size, also a custom size, in the tool options)',
  ],
  ['P · Straight line', 'Pen tool option: each drag draws a straight line from where you press to where you let go'],
  ['Drag a text mark · double-click it', 'Move it (onto a sheet or off it) · edit it'],
  [
    'F / S / R / L',
    'Flip card or holder · shuffle holder or bag · roll die or rotate to the next allowed angle (Shift+R back) · lock / unlock (Edit mode)',
  ],
  ['Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y', 'Undo / redo'],
  ['+ − 0 Shift+F', 'Zoom in, out, 100%, fit'],
  ['U', 'Hide / show the interface'],
  ['C', 'Lock camera: dragging the table never pans (wheel, Pan tool and Space still work)'],
  ['I', 'Properties panel (Edit mode)'],
  ['G', 'Snap to grid on / off (Edit mode): dragged, resized and added objects line up with the grid; spacing in the More menu → Grid'],
  ['Arrow keys', 'Nudge the selection by 1 (Shift: 10; with Snap to grid: one grid step) (Edit mode)'],
  ['Delete · Ctrl+D · Ctrl+A', 'Delete · duplicate · select all (Edit mode; works on every selected object)'],
  [
    'Ctrl+C · Ctrl+V',
    'Copy the selection · paste the last copy in the middle of the view, in this game or another one, also in another tab (Edit mode; Paste is also in the More menu)',
  ],
  ['Esc', 'Stop picking · close the text editor, menu or palette · deselect · back to the Select tool'],
  ['?', 'This list'],
];

const TOUCH_ROWS: [string, string][] = [
  [
    'Touch: tap · double-tap',
    'Select and show the quick action bar (its ⋯ opens every action) · flip card, roll die, turn over a holder’s top card',
  ],
  [
    'Touch: long-press',
    'Open the actions menu for an object (like right-click); on a card with Zoom on hover (also in a holder or pile), show it enlarged while held',
  ],
  ['Touch: pinch · two-finger drag', 'Zoom · pan (one finger on the empty table pans too)'],
];

/** Touch screens list the touch gestures first. */
const TOUCH_FIRST = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal modal-wide help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h2 id="help-title">Controls &amp; shortcuts</h2>
        <p className="hint">Edit and Play work on the same saved game. Every change is saved automatically.</p>
        <div className="help-scroll">
          <table className="help-table">
            <tbody>
              {(TOUCH_FIRST ? [...TOUCH_ROWS, ...ROWS] : [...ROWS, ...TOUCH_ROWS]).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button ref={ref} type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
