import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { CheckboxField, ColorField, NumberField, SelectField, TextField } from '../components/fields';
import { focusObject, runButton } from '../canvas/actions';
import type { ObjectPatch } from '../domain/commands';
import { buttonMaxFontSize, createStep, describeStep, MAX_STEPS, STEP_LABELS, STEP_TYPES, type PickField } from '../domain/buttons';
import { displayName, kindLabel } from '../domain/objects';
import type { ButtonObject, ButtonStep, MoveStep, ObjectId, StepType, TabletopObject } from '../domain/types';
import { useTableStore } from '../state/tableStore';

type Update = (patch: ObjectPatch, coalesceKey?: string) => void;

const STEP_ICONS: Record<StepType, IconName> = {
  move: 'move',
  recall: 'reset',
  rotate: 'rotate',
  flip: 'flip',
  shuffle: 'shuffle',
  sort: 'sort',
  roll: 'dice',
  counter: 'counter',
  check: 'checkbox',
  timer: 'timer',
};

const STEP_HINTS: Record<StepType, string> = {
  move: 'Moves objects onto a destination. A holder, pile or bag gives up its cards or pieces (the container itself stays); pieces lying on a listed holder move too. A bag destination takes cards, piles, tokens, dice and the like in. A bag gives up its top or bottom pieces: add a Shuffle step first to draw at random.',
  recall:
    'Sends things back where they came from: cards to their holder, tokens to the stack they were taken from, pieces to their bag. A holder with its own card list gathers all its cards back (like "Gather & reset"); a token stack gathers its tokens; a bag takes back everything that came out of it.',
  rotate: 'Rotates objects about their centre.',
  flip: 'Flips cards. A holder or pile turns its cards over as a whole; loose cards lying on a listed holder flip too. Random turns each card (or holder) over or not at random.',
  shuffle: 'Shuffles the cards in holders and piles, and the pieces in bags.',
  sort: 'Orders the cards in holders and piles.',
  roll: 'Rolls dice (a holder stands for the dice lying on it).',
  counter: 'Changes counters, within their minimum and maximum (a holder stands for the counters lying on it).',
  check: 'Checks, unchecks or toggles checkboxes. A board or holder stands for every checkbox lying on it (e.g. to clear a sheet).',
  timer:
    'Starts, pauses, resets or restarts timers (e.g. start a turn timer when the turn begins). Start also begins a new countdown when one ran out.',
};

const objectLabel = (o: TabletopObject) => (o.name.trim() ? `${o.name} (${kindLabel(o)})` : kindLabel(o));

/** Toggles pick mode for one step field: clicks on the table then choose objects for it. */
function PickToggle({ buttonId, stepId, field }: { buttonId: ObjectId; stepId: string; field: PickField }) {
  const active = useTableStore((s) => s.picking?.buttonId === buttonId && s.picking.stepId === stepId && s.picking.field === field);
  const label = field === 'target' ? 'Pick destinations on table' : 'Pick on table';
  return (
    <button
      type="button"
      className={`btn btn-small ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      title={
        field === 'target'
          ? 'Click destinations on the table; click again to remove one'
          : 'Click objects on the table; Shift+drag to box-select several'
      }
      onClick={() => useTableStore.getState().setPicking(active ? null : { buttonId, stepId, field })}
    >
      <Icon name="select" size={14} /> {active ? 'Done picking' : label}
    </button>
  );
}

function Chip({ id, objects, onRemove }: { id: ObjectId; objects: TabletopObject[]; onRemove: () => void }) {
  const o = objects.find((x) => x.id === id);
  const name = o ? displayName(o) : 'missing object';
  return (
    <li className={`pick-chip ${o ? '' : 'is-missing'}`}>
      {o ? (
        <button
          type="button"
          className="pick-chip-name"
          title={`${objectLabel(o)}: click to select it and show it on the table`}
          onClick={() => focusObject(o.id)}
        >
          {name}
        </button>
      ) : (
        <span className="pick-chip-name">{name}</span>
      )}
      <button type="button" className="pick-remove" aria-label={`Remove ${name}`} onClick={onRemove}>
        <Icon name="close" size={12} />
      </button>
    </li>
  );
}

/** Chosen objects as removable chips and a "pick on table" toggle. */
function ObjectPicker({
  label,
  ids,
  allObjects,
  pick,
  onChange,
  source,
}: {
  label: string;
  ids: ObjectId[];
  allObjects: TabletopObject[];
  pick: { buttonId: ObjectId; stepId: string };
  onChange: (ids: ObjectId[]) => void;
  /** A move step's "what to move" list, styled apart from its destination. */
  source?: boolean;
}) {
  return (
    <div className={`field ${source ? 'pick-source' : ''}`}>
      <span className={source ? 'pick-heading' : undefined}>
        {source && <Icon name="select" size={14} />} {label}
      </span>
      {ids.length > 0 && (
        <ul className="pick-list" aria-label={label}>
          {ids.map((id) => (
            <Chip key={id} id={id} objects={allObjects} onRemove={() => onChange(ids.filter((x) => x !== id))} />
          ))}
        </ul>
      )}
      <div className="pick-row">
        <PickToggle {...pick} field="objects" />
      </div>
    </div>
  );
}

/** A move step's destinations: one or more objects, picked on the table. */
function TargetPicker({
  step,
  allObjects,
  pick,
  onChange,
}: {
  step: MoveStep;
  allObjects: TabletopObject[];
  pick: { buttonId: ObjectId; stepId: string };
  onChange: (targetIds: ObjectId[]) => void;
}) {
  const ids = step.targetIds;
  return (
    <div className="field pick-target">
      <span className="pick-heading">
        <Icon name="move" size={14} /> Where to move it
      </span>
      {ids.length > 0 && (
        <ul className="pick-list" aria-label="Where to move it">
          {ids.map((id) => (
            <Chip key={id} id={id} objects={allObjects} onRemove={() => onChange(ids.filter((x) => x !== id))} />
          ))}
        </ul>
      )}
      <div className="pick-row">
        <PickToggle {...pick} field="target" />
      </div>
      {ids.length > 1 && (
        <p className="hint">Cards are dealt to these destinations in turn (the number below is how many each one gets).</p>
      )}
    </div>
  );
}

function StepFields({
  step,
  buttonId,
  objects,
  onChange,
}: {
  step: ButtonStep;
  buttonId: ObjectId;
  objects: TabletopObject[];
  onChange: (next: ButtonStep) => void;
}) {
  const pick = { buttonId, stepId: step.id };
  const picker = (
    <ObjectPicker
      label={step.type === 'move' ? 'What to move' : 'Objects'}
      source={step.type === 'move'}
      ids={step.objectIds}
      allObjects={objects}
      pick={pick}
      onChange={(objectIds) => onChange({ ...step, objectIds })}
    />
  );
  switch (step.type) {
    case 'move':
      return (
        <>
          {picker}
          <TargetPicker step={step} allObjects={objects} pick={pick} onChange={(targetIds) => onChange({ ...step, targetIds })} />
          <NumberField
            label={
              step.targetIds.length > 1
                ? 'Cards or pieces each destination gets from each holder / pile / bag (empty = deal them all)'
                : 'Cards or pieces taken from each holder / pile / bag (empty = all)'
            }
            value={step.count ?? null}
            min={1}
            max={5000}
            allowEmpty
            emptyLabel="all"
            onCommit={(count) => onChange({ ...step, count: count === null ? undefined : Math.round(count) })}
          />
          <SelectField
            label="Take from the"
            value={step.deckMode}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'bottom', label: 'Bottom' },
            ]}
            onChange={(deckMode) => onChange({ ...step, deckMode })}
          />
          <SelectField
            label="Face of moved cards"
            value={step.orientation}
            options={[
              { value: 'keep', label: 'As the holder gives them' },
              { value: 'faceUp', label: 'Face up' },
              { value: 'faceDown', label: 'Face down' },
            ]}
            onChange={(orientation) => onChange({ ...step, orientation })}
          />
        </>
      );
    case 'rotate':
      return (
        <>
          {picker}
          <SelectField
            label="Rotation"
            value={step.mode}
            options={[
              { value: 'by', label: 'Rotate by (clockwise)' },
              { value: 'to', label: 'Rotate to' },
            ]}
            onChange={(mode) => onChange({ ...step, mode })}
          />
          <NumberField label="Degrees" value={step.degrees} onCommit={(degrees) => onChange({ ...step, degrees: degrees ?? 0 })} />
          <p className="hint">A holder stays as it is: the cards in it and the pieces lying on it are turned.</p>
        </>
      );
    case 'flip':
      return (
        <>
          {picker}
          <SelectField
            label="Flip"
            value={step.mode}
            options={[
              { value: 'toggle', label: 'Toggle' },
              { value: 'faceUp', label: 'Face up' },
              { value: 'faceDown', label: 'Face down' },
              { value: 'random', label: 'Random' },
            ]}
            onChange={(mode) => onChange({ ...step, mode })}
          />
          <NumberField
            label="Cards to flip (empty = all)"
            value={step.count ?? null}
            min={1}
            max={5000}
            allowEmpty
            emptyLabel="all"
            onCommit={(count) => onChange({ ...step, count: count === null ? undefined : Math.round(count) })}
          />
          <p className="hint">
            With a number, only the first cards flip: the top ones of each holder or pile (turned over where they lie) and the first loose
            cards in the list.
          </p>
        </>
      );
    case 'sort':
      return (
        <>
          {picker}
          <SelectField
            label="Sort by"
            value={step.by}
            options={[
              { value: 'original', label: 'Original deck order' },
              { value: 'name', label: 'Card name' },
            ]}
            onChange={(by) => onChange({ ...step, by })}
          />
        </>
      );
    case 'counter':
      return (
        <>
          {picker}
          <SelectField
            label="Counter"
            value={step.mode}
            options={[
              { value: 'add', label: 'Add (negative to subtract)' },
              { value: 'set', label: 'Set to' },
            ]}
            onChange={(mode) => onChange({ ...step, mode })}
          />
          <NumberField label="Amount" value={step.amount} onCommit={(amount) => onChange({ ...step, amount: amount ?? 0 })} />
        </>
      );
    case 'check':
      return (
        <>
          {picker}
          <SelectField
            label="Checkboxes"
            value={step.mode}
            options={[
              { value: 'toggle', label: 'Toggle' },
              { value: 'check', label: 'Check' },
              { value: 'uncheck', label: 'Uncheck' },
            ]}
            onChange={(mode) => onChange({ ...step, mode })}
          />
        </>
      );
    case 'timer':
      return (
        <>
          {picker}
          <SelectField
            label="Timer"
            value={step.mode}
            options={[
              { value: 'start', label: 'Start' },
              { value: 'pause', label: 'Pause' },
              { value: 'toggle', label: 'Start or pause (toggle)' },
              { value: 'reset', label: 'Reset (stop at the start)' },
              { value: 'restart', label: 'Restart (reset and start)' },
            ]}
            onChange={(mode) => onChange({ ...step, mode })}
          />
        </>
      );
    case 'recall':
      return (
        <>
          {picker}
          <SelectField
            label="Card rotation in the holders"
            value={step.rotation ?? 'reset'}
            options={[
              { value: 'reset', label: 'Turn back to how they were set up' },
              { value: 'keep', label: 'Keep as they are' },
            ]}
            onChange={(rotation) => onChange({ ...step, rotation: rotation === 'reset' ? undefined : rotation })}
          />
          <SelectField
            label="Face of recalled cards"
            value={step.orientation ?? 'faceDown'}
            options={[
              { value: 'faceDown', label: 'Face down' },
              { value: 'faceUp', label: 'Face up' },
              { value: 'keep', label: 'As they come back' },
            ]}
            onChange={(orientation) => onChange({ ...step, orientation: orientation === 'faceDown' ? undefined : orientation })}
          />
          <CheckboxField
            label="Shuffle after recalling"
            checked={!!step.shuffle}
            onChange={(shuffle) => onChange({ ...step, shuffle: shuffle || undefined })}
          />
        </>
      );
    case 'shuffle':
    case 'roll':
      return picker;
  }
}

function StepsEditor({ o, update }: { o: ButtonObject; update: Update }) {
  const present = useTableStore((s) => s.history.present);
  const [open, setOpen] = useState<string | null>(null);
  // Pick mode belongs to this button's open step: it ends when that step closes or the editor goes away.
  useEffect(() => {
    const s = useTableStore.getState();
    if (s.picking?.buttonId === o.id && s.picking.stepId !== open) s.setPicking(null);
  }, [open, o.id]);
  useEffect(
    () => () => {
      const s = useTableStore.getState();
      if (s.picking?.buttonId === o.id) s.setPicking(null);
    },
    [o.id],
  );
  const steps = o.steps;
  const setSteps = (next: ButtonStep[]) => update({ steps: next });
  const replace = (next: ButtonStep) => setSteps(steps.map((s) => (s.id === next.id ? next : s)));
  const moveStep = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    [next[index], next[to]] = [next[to], next[index]];
    setSteps(next);
  };
  return (
    <section className="inspector-section">
      <h3>Steps</h3>
      {steps.length === 0 ? (
        <p className="hint">No steps yet. Add one below.</p>
      ) : (
        <ol className="step-list" aria-label="Button steps">
          {steps.map((step, i) => {
            const expanded = open === step.id;
            return (
              <li key={step.id} className={`step-item ${expanded ? 'is-open' : ''}`}>
                <div className="step-head">
                  <span className="card-def-index">{i + 1}</span>
                  <Icon name={STEP_ICONS[step.type]} size={14} />
                  <button
                    type="button"
                    className="step-summary"
                    aria-expanded={expanded}
                    title="Edit this step"
                    onClick={() => setOpen(expanded ? null : step.id)}
                  >
                    {describeStep(present, step)}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-icon"
                    aria-label={`Move step ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => moveStep(i, -1)}
                  >
                    <Icon name="front" size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-icon"
                    aria-label={`Move step ${i + 1} down`}
                    disabled={i === steps.length - 1}
                    onClick={() => moveStep(i, 1)}
                  >
                    <Icon name="backward" size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-icon"
                    aria-label={`Delete step ${i + 1}`}
                    onClick={() => {
                      setSteps(steps.filter((s) => s.id !== step.id));
                      if (expanded) setOpen(null);
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
                {expanded && (
                  <div className="step-body">
                    <p className="hint">{STEP_HINTS[step.type]}</p>
                    <StepFields step={step} buttonId={o.id} objects={present.objects} onChange={replace} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <h3>Add a step</h3>
      <div className="step-type-grid" role="group" aria-label="Add a step">
        {STEP_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className="step-type-btn"
            title={STEP_HINTS[t]}
            disabled={steps.length >= MAX_STEPS}
            onClick={() => {
              const step = createStep(t);
              setSteps([...steps, step]);
              setOpen(step.id);
            }}
          >
            <Icon name={STEP_ICONS[t]} size={16} />
            <span>{STEP_LABELS[t]}</span>
          </button>
        ))}
      </div>
      <div className="button-row">
        <button type="button" className="btn btn-small" disabled={steps.length === 0} onClick={() => runButton(o.id)}>
          <Icon name="play" size={14} /> Run (test)
        </button>
      </div>
      <p className="hint">Clicking the button in Play mode runs the steps from top to bottom, as a single undo step.</p>
    </section>
  );
}

/** Inspector fields of an automation button; its steps are edited in the automations panel. */
export function ButtonFields({ o, update }: { o: ButtonObject; update: Update }) {
  const n = o.steps.length;
  return (
    <>
      <section className="inspector-section">
        <h3>Automations</h3>
        <button type="button" className="btn automations-open" onClick={() => useTableStore.getState().openAutomations(o.id)}>
          <Icon name="bolt" size={16} /> Automations
          <span className="badge">{n === 0 ? 'no steps' : `${n} step${n === 1 ? '' : 's'}`}</span>
        </button>
      </section>
      <section className="inspector-section">
        <h3>Button</h3>
        <TextField label="Label" value={o.label} onCommit={(label) => update({ label })} />
        <CheckboxField
          label="Auto text size (fit the button)"
          checked={o.fontSize === undefined}
          onChange={(auto) => update({ fontSize: auto ? undefined : Math.round(buttonMaxFontSize(o)) })}
        />
        {o.fontSize !== undefined && (
          <NumberField
            label="Text size"
            value={o.fontSize}
            min={6}
            max={200}
            onCommit={(fontSize) => update({ fontSize: fontSize ?? 18 })}
          />
        )}
        <p className="hint">The label always shrinks to fit when the button is too small for it.</p>
        <ColorField label="Colour" value={o.color} onChange={(color) => update({ color }, `color:${o.id}`)} />
        <ColorField label="Text colour" value={o.textColor} onChange={(textColor) => update({ textColor }, `text:${o.id}`)} />
      </section>
    </>
  );
}

/** Edit-mode drawer with a button's automation steps (replaces the properties panel while open). */
export function AutomationPanel() {
  const id = useTableStore((s) => s.automationButtonId);
  const button = useTableStore((s) => s.history.present.objects.find((o) => o.id === s.automationButtonId));
  const missing = !!id && button?.kind !== 'button';
  useEffect(() => {
    // The button went away (deleted, undone): close the panel.
    if (missing) useTableStore.getState().openAutomations(null);
  }, [missing]);
  if (!button || button.kind !== 'button') return null;
  const update: Update = (patch, coalesceKey) =>
    useTableStore.getState().dispatch({ type: 'UpdateObject', id: button.id, patch }, { coalesceKey });
  const close = () => useTableStore.getState().openAutomations(null);
  const backToProperties = () => {
    const s = useTableStore.getState();
    s.openAutomations(null);
    s.select(button.id);
    s.setUi({ inspectorOpen: true });
  };
  return (
    <aside className="inspector-drawer automation-drawer" aria-label="Automations">
      <button type="button" className="hud-btn drawer-close" aria-label="Close automations panel" title="Close (Esc)" onClick={close}>
        <Icon name="close" size={16} />
      </button>
      <div className="inspector">
        <div className="inspector-heading">
          <h2 title={button.name}>
            <Icon name="bolt" size={16} /> Automations · {button.label || button.name}
          </h2>
        </div>
        <button type="button" className="btn btn-small btn-link" onClick={backToProperties}>
          ← Button properties
        </button>
        <StepsEditor o={button} update={update} />
      </div>
    </aside>
  );
}

/** Shown over the table while objects are picked for a button step. */
export function PickBanner() {
  const picking = useTableStore((s) => s.picking);
  const button = useTableStore((s) => s.history.present.objects.find((o) => o.id === s.picking?.buttonId));
  const index = button?.kind === 'button' ? button.steps.findIndex((st) => st.id === picking?.stepId) : -1;
  const missing = !!picking && index < 0;
  useEffect(() => {
    // The step or button went away (undo, delete): leave pick mode.
    if (missing) useTableStore.getState().setPicking(null);
  }, [missing]);
  if (!picking || button?.kind !== 'button' || index < 0) return null;
  const step = button.steps[index];
  const what = `step ${index + 1} (${STEP_LABELS[step.type]}) of "${button.label || button.name}"`;
  return (
    <div className="pick-banner" role="status" data-testid="pick-banner">
      <Icon name="select" size={16} />
      <span>
        {picking.field === 'target'
          ? `Click destinations for ${what}; click one again to remove it. Shift+drag to select several.`
          : `Click objects to add or remove them for ${what}. Shift+drag to select several.`}
      </span>
      <button type="button" className="btn btn-small" onClick={() => useTableStore.getState().setPicking(null)}>
        Done (Esc)
      </button>
    </div>
  );
}
