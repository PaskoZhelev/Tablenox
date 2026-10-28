import { memo, useState } from 'react';
import { Icon } from '../components/Icon';
import { CheckboxField, ColorField, FileButton, ImageField, NumberField, OpacityField, SelectField, TextField } from '../components/fields';
import { IMAGE_ACCEPT, uploadImages } from '../components/upload';
import { AssetThumb } from '../components/AssetThumb';
import {
  deleteObject,
  deleteObjects,
  drawFromBag,
  duplicateObject,
  duplicateObjects,
  focusObject,
  pickDieFace,
  recallToBag,
  resetDeck,
  resetTimer,
  returnPileToHolders,
  rollDie,
  setHoverRotate,
  setHoverZoom,
  shuffleBag,
  shuffleDeck,
  takeFromBag,
  toggleLockMany,
  toggleTimer,
} from '../canvas/actions';
import type { ObjectPatch, ZOrderDirection } from '../domain/commands';
import { numberedDeck, standardDeck } from '../domain/cards';
import {
  bagCount,
  CARD_SIZE,
  cardSizeOf,
  createCardDef,
  createDieFace,
  DEFAULT_HOLDER_COLOR,
  DEFAULT_HOLDER_FILL_OPACITY,
  DEFAULT_HOLDER_STROKE_OPACITY,
  dieFaceLabel,
  displayName,
  fixedInPlay,
  hasPlayMovable,
  kindLabel,
  cardGroups,
  MAX_CARD_COPIES,
  moveCardGroup,
  setAllCardCopies,
  setCardCopies,
  sortByZ,
  tokenCount,
  withFrontAsBack,
} from '../domain/objects';
import {
  effectiveHoverZoom,
  effectiveRotations,
  HOVER_ZOOM_LABELS,
  homeDeckOf,
  hoverRotateChoiceOf,
  hoverRotateChoices,
  hoverRotateFromChoice,
  hoverZoomInheritLabel,
  inheritsHoverZoom,
  inheritsRotations,
  pileHasHome,
  pileHolders,
  ROTATION_CHOICES,
} from '../domain/rules';
import {
  DIE_SIDES,
  HOVER_ZOOM_SIZES,
  MAX_TOKEN_STACK,
  MAX_TIMER_SECONDS,
  TOKEN_SHAPES,
  type BagItem,
  type BagObject,
  type CardDef,
  type DeckObject,
  type DieFace,
  type DieObject,
  type HoverZoom,
  type TabletopObject,
} from '../domain/types';
import { useTableStore } from '../state/tableStore';
import { confirmDialog, promptDialog } from '../state/uiStore';
import { loadAssetImage } from './useAssetImage';
import { ButtonFields } from './ButtonEditor';

type Update = (patch: ObjectPatch, coalesceKey?: string) => void;

function useUpdate(id: string): Update {
  return (patch, coalesceKey) => useTableStore.getState().dispatch({ type: 'UpdateObject', id, patch }, { coalesceKey });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** Which angles the Rotate action / `R` steps through (dice roll with `R`, so they have none). */
function RotationAnglesField({ o, update }: { o: TabletopObject; update: Update }) {
  const table = useTableStore((s) => s.history.present);
  const angles = effectiveRotations(table, o);
  const inherited = o.rotations === undefined && inheritsRotations(o);
  const toggle = (deg: number) => {
    const next = angles.includes(deg) ? angles.filter((a) => a !== deg) : [...angles, deg].sort((a, b) => a - b);
    if (next.length === 0) return;
    update({ rotations: next });
  };
  return (
    <div className="field">
      <span id={`rot-${o.id}`}>Rotation angles (Rotate / R)</span>
      <div className="button-row angle-row" role="group" aria-labelledby={`rot-${o.id}`}>
        {ROTATION_CHOICES.map((deg) => {
          const on = angles.includes(deg);
          return (
            <button
              key={deg}
              type="button"
              className={`btn btn-small ${on ? 'is-active' : ''}`}
              aria-pressed={on}
              aria-label={`Allow ${deg}°`}
              disabled={on && angles.length === 1}
              onClick={() => toggle(deg)}
            >
              {deg}°
            </button>
          );
        })}
      </div>
      {inherited && <p className="hint">Same as its deck. Change an angle to give it its own.</p>}
      {o.rotations !== undefined && inheritsRotations(o) && (
        <button type="button" className="btn btn-small btn-link" onClick={() => update({ rotations: undefined })}>
          Use the deck's angles
        </button>
      )}
      {angles.length === 1 && <p className="hint">Only one angle: it can't be rotated with Rotate / R.</p>}
    </div>
  );
}

/** The look of a holder's zone: fill and outline. */
function HolderLookFields({ o, update }: { o: DeckObject; update: Update }) {
  return (
    <>
      <ColorField label="Holder colour" value={o.color ?? DEFAULT_HOLDER_COLOR} onChange={(color) => update({ color }, `color:${o.id}`)} />
      <OpacityField
        label="Holder opacity"
        value={o.fillOpacity ?? DEFAULT_HOLDER_FILL_OPACITY}
        onChange={(fillOpacity) => update({ fillOpacity }, `fillOpacity:${o.id}`)}
      />
      <ColorField
        label="Stroke colour"
        value={o.strokeColor ?? o.color ?? DEFAULT_HOLDER_COLOR}
        onChange={(strokeColor) => update({ strokeColor }, `strokeColor:${o.id}`)}
      />
      <OpacityField
        label="Stroke opacity"
        value={o.strokeOpacity ?? DEFAULT_HOLDER_STROKE_OPACITY}
        onChange={(strokeOpacity) => update({ strokeOpacity }, `strokeOpacity:${o.id}`)}
      />
      <SelectField
        label="Stroke style"
        value={o.strokeStyle ?? 'dashed'}
        options={[
          { value: 'dashed', label: 'Dashed' },
          { value: 'solid', label: 'Solid' },
        ]}
        onChange={(strokeStyle) => update({ strokeStyle })}
      />
    </>
  );
}

function CommonFields({ o, update }: { o: TabletopObject; update: Update }) {
  const dispatch = useTableStore((s) => s.dispatch);
  const table = useTableStore((s) => s.history.present);
  const z = (direction: ZOrderDirection) => dispatch({ type: 'SetZIndex', id: o.id, direction });
  const transform = (patch: Partial<{ x: number; y: number; width: number; height: number; rotation: number }>) =>
    dispatch({
      type: 'TransformObject',
      id: o.id,
      position: { x: patch.x ?? o.position.x, y: patch.y ?? o.position.y },
      width: patch.width ?? o.width,
      height: patch.height ?? o.height,
      rotation: patch.rotation ?? o.rotation,
    });
  return (
    <Section title="Object">
      <TextField label="Name" value={o.name} onCommit={(name) => update({ name })} />
      <div className="field-grid">
        <NumberField label="X" value={o.position.x} onCommit={(x) => transform({ x: x ?? 0 })} />
        <NumberField label="Y" value={o.position.y} onCommit={(y) => transform({ y: y ?? 0 })} />
        <NumberField label="Width" value={o.width} min={4} onCommit={(width) => transform({ width: width ?? o.width })} />
        <NumberField label="Height" value={o.height} min={4} onCommit={(height) => transform({ height: height ?? o.height })} />
        <NumberField label="Rotation°" value={o.rotation} onCommit={(rotation) => transform({ rotation: rotation ?? 0 })} />
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn btn-small"
          title="Swap width and height (keeps the centre)"
          onClick={() =>
            transform({
              x: Math.round(o.position.x + (o.width - o.height) / 2),
              y: Math.round(o.position.y + (o.height - o.width) / 2),
              width: o.height,
              height: o.width,
            })
          }
        >
          <Icon name="swap" size={14} /> Swap width / height
        </button>
      </div>
      {o.kind !== 'die' && <RotationAnglesField o={o} update={update} />}
      {o.kind === 'deck' && !o.isPile && <HolderLookFields o={o} update={update} />}
      <div className="button-row">
        <button
          type="button"
          className={`btn btn-small ${o.locked ? 'is-active' : ''}`}
          aria-pressed={o.locked}
          onClick={() => dispatch({ type: 'ToggleLock', id: o.id })}
        >
          <Icon name={o.locked ? 'lock' : 'unlock'} size={14} /> {o.locked ? 'Locked' : 'Unlocked'}
        </button>
        <button
          type="button"
          className={`btn btn-small ${!o.visible ? 'is-active' : ''}`}
          aria-pressed={!o.visible}
          onClick={() => update({ visible: !o.visible })}
        >
          <Icon name={o.visible ? 'eye' : 'eyeOff'} size={14} /> {o.visible ? 'Visible' : 'Hidden'}
        </button>
      </div>
      {hasPlayMovable(o) && (
        <CheckboxField label="Movable in Play mode" checked={!!o.playMovable} onChange={(playMovable) => update({ playMovable })} />
      )}
      {o.locked ? (
        <p className="hint">Locked objects can't be dragged in Edit or Play mode. Dragging them pans the view.</p>
      ) : (
        fixedInPlay(o) && <p className="hint">Moves in Edit mode only; in Play mode dragging it pans the view.</p>
      )}
      {
        <SelectField
          label="Zoom on hover"
          value={o.hoverZoom ?? ''}
          options={[
            { value: '', label: hoverZoomInheritLabel(o) },
            ...HOVER_ZOOM_SIZES.filter((z) => z !== 'off' || inheritsHoverZoom(o)).map((z) => ({ value: z, label: HOVER_ZOOM_LABELS[z] })),
          ]}
          onChange={(v) => setHoverZoom(o.id, (v || undefined) as HoverZoom | undefined)}
        />
      }
      {effectiveHoverZoom(table, o) !== 'off' && (
        <SelectField
          label="Zoomed view"
          value={hoverRotateChoiceOf(o)}
          options={hoverRotateChoices(o)}
          onChange={(v) => setHoverRotate(o.id, hoverRotateFromChoice(v))}
        />
      )}
      <div className="button-row">
        <button type="button" className="btn btn-small" onClick={() => z('front')} title="Bring to front">
          <Icon name="front" size={14} /> Front
        </button>
        <button type="button" className="btn btn-small" onClick={() => z('forward')} title="Bring forward">
          Forward
        </button>
        <button type="button" className="btn btn-small" onClick={() => z('backward')} title="Send backward">
          Backward
        </button>
        <button type="button" className="btn btn-small" onClick={() => z('back')} title="Send to back">
          <Icon name="backward" size={14} /> Back
        </button>
      </div>
      <div className="button-row">
        <button type="button" className="btn btn-small" onClick={() => duplicateObject(o.id)}>
          <Icon name="copy" size={14} /> Duplicate
        </button>
        <button type="button" className="btn btn-small btn-danger" onClick={() => deleteObject(o.id)}>
          <Icon name="trash" size={14} /> Delete
        </button>
      </div>
    </Section>
  );
}

async function fitToImage(o: TabletopObject, assetId: string | undefined, update: Update) {
  if (!assetId) return;
  try {
    const img = await loadAssetImage(assetId);
    const height = Math.round((o.width * img.naturalHeight) / img.naturalWidth);
    update({ height });
  } catch {
    // ignore
  }
}

/**
 * Number of copies of a card-list row: − / + (and the ↑ / ↓ keys) change it at once; typed numbers commit on Enter /
 * leaving the field, so typing "12" doesn't pass through 1.
 */
function CopiesInput({ value, label, onCommit }: { value: number; label: string; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const set = (n: number) => {
    const next = Math.max(1, Math.min(MAX_CARD_COPIES, Math.round(n)));
    if (next !== value) onCommit(next);
  };
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() !== '' && Number.isFinite(n) && n >= 1) set(n);
  };
  return (
    <span className="card-def-copies" title="Number of copies of this card in the deck">
      <button
        type="button"
        className="btn btn-small btn-icon"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={value <= 1}
        onClick={() => set(value - 1)}
      >
        <Icon name="minus" size={12} />
      </button>
      <input
        inputMode="numeric"
        aria-label={label}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setDraft(null);
            set(value + (e.key === 'ArrowUp' ? 1 : -1));
          }
        }}
      />
      <button
        type="button"
        className="btn btn-small btn-icon"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= MAX_CARD_COPIES}
        onClick={() => set(value + 1)}
      >
        <Icon name="plus" size={12} />
      </button>
    </span>
  );
}

const CardDefRow = memo(function CardDefRow({
  def,
  index,
  count,
  copies,
  individualBacks,
  deckBackColor,
  onChange,
  onCopies,
  onMove,
  onRemove,
}: {
  /** The row's card (all its copies look the same). */
  def: CardDef;
  index: number;
  /** Number of rows in the list. */
  count: number;
  copies: number;
  individualBacks: boolean;
  deckBackColor: string;
  onChange: (patch: Partial<CardDef>) => void;
  onCopies: (n: number) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <li className="card-def-row">
      <span className="card-def-index">{index + 1}</span>
      <span className="card-def-move">
        <button
          type="button"
          className="btn btn-small btn-icon"
          aria-label={`Move card ${index + 1} up`}
          title="Move up (towards the top)"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <Icon name="chevronUp" size={12} />
        </button>
        <button
          type="button"
          className="btn btn-small btn-icon"
          aria-label={`Move card ${index + 1} down`}
          title="Move down"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <Icon name="chevronDown" size={12} />
        </button>
      </span>
      <input
        aria-label={`Card ${index + 1} name`}
        className="card-def-name"
        title="Card name (shown when picking a card, used by Sort by name)"
        placeholder="name"
        value={def.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      {/* Text is only drawn on cards without a face image. */}
      {!def.faceAssetId && (
        <input
          aria-label={`Card ${index + 1} face text`}
          className="card-def-text"
          title="Text printed on the card"
          value={def.faceText}
          placeholder="text"
          onChange={(e) => onChange({ faceText: e.target.value })}
        />
      )}
      <FileButton
        label={def.faceAssetId ? '✓' : ''}
        ariaLabel={`${def.faceAssetId ? 'Replace' : 'Upload'} face image for card ${index + 1}`}
        icon="image"
        accept={IMAGE_ACCEPT}
        className={`btn btn-small btn-icon ${def.faceAssetId ? 'is-active has-thumb' : ''}`}
        content={def.faceAssetId ? <AssetThumb assetId={def.faceAssetId} size={26} label={`Face of card ${index + 1}`} /> : undefined}
        onFiles={async (files) => {
          const [a] = await uploadImages([files[0]]);
          if (a) onChange({ faceAssetId: a.id });
        }}
      />
      {individualBacks && (
        <>
          <FileButton
            label={def.backAssetId ? '✓' : ''}
            ariaLabel={`${def.backAssetId ? 'Replace' : 'Upload'} back image for card ${index + 1}`}
            icon="card"
            accept={IMAGE_ACCEPT}
            className={`btn btn-small btn-icon ${def.backAssetId ? 'is-active has-thumb' : ''}`}
            content={def.backAssetId ? <AssetThumb assetId={def.backAssetId} size={26} label={`Back of card ${index + 1}`} /> : undefined}
            onFiles={async (files) => {
              const [a] = await uploadImages([files[0]]);
              if (a) onChange({ backAssetId: a.id });
            }}
          />
          <input
            type="color"
            className="card-def-color"
            aria-label={`Back colour for card ${index + 1}`}
            value={/^#[0-9a-f]{6}$/i.test(def.backColor ?? deckBackColor) ? (def.backColor ?? deckBackColor) : '#000000'}
            onChange={(e) => onChange({ backColor: e.target.value })}
          />
        </>
      )}
      <CopiesInput value={copies} label={`Copies of card ${index + 1}`} onCommit={onCopies} />
      <button
        type="button"
        className="btn btn-small btn-icon"
        aria-label={copies > 1 ? `Remove card ${index + 1} (all ${copies} copies)` : `Remove card ${index + 1}`}
        onClick={onRemove}
      >
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
});

/** `settings`: the cards' look and how they come out; `list`: the card list and its tools. */
function DeckEditor({ o, update, part }: { o: DeckObject; update: Update; part: 'settings' | 'list' }) {
  const rows = cardGroups(o.initialCards);
  const [showList, setShowList] = useState(rows.length <= 20);
  const setCards = (cards: CardDef[], key?: string) => update({ cards, initialCards: cards }, key);
  /** Edits every copy in the row of card `id`. */
  const editCard = (id: string, patch: Partial<CardDef>) => {
    const ids = new Set(rows.find((g) => g.some((c) => c.id === id))?.map((c) => c.id) ?? [id]);
    update(
      {
        cards: o.cards.map((c) => (ids.has(c.id) ? { ...c, ...patch } : c)),
        initialCards: o.initialCards.map((c) => (ids.has(c.id) ? { ...c, ...patch } : c)),
      },
      `card:${id}:${Object.keys(patch).join()}`,
    );
  };
  /** Removes the row of card `id` (all its copies). */
  const removeCard = (id: string) => {
    const ids = new Set(rows.find((g) => g.some((c) => c.id === id))?.map((c) => c.id) ?? [id]);
    update({ cards: o.cards.filter((c) => !ids.has(c.id)), initialCards: o.initialCards.filter((c) => !ids.has(c.id)) });
  };
  const outOfDeck = o.initialCards.length - o.cards.length;
  const individual = !!o.individualBacks;
  const clearBacks = ({ backAssetId: _a, backColor: _c, ...rest }: CardDef): CardDef => rest;
  const setIndividualBacks = async (on: boolean) => {
    if (on) return update({ individualBacks: true });
    const hasOverrides = [...o.cards, ...o.initialCards].some((c) => c.backAssetId || c.backColor);
    if (
      hasOverrides &&
      !(await confirmDialog({
        title: 'Use one back for all cards?',
        message: 'The individual card backs of this deck will be removed.',
        confirmLabel: 'Remove backs',
        danger: true,
      }))
    )
      return;
    update({ individualBacks: false, cards: o.cards.map(clearBacks), initialCards: o.initialCards.map(clearBacks) });
  };

  if (part === 'settings') {
    return (
      <Section title={`Cards (${o.cards.length} in the holder)`}>
        <div className="field-grid">
          <NumberField
            label="Card width"
            value={cardSizeOf(o).width}
            min={10}
            max={2000}
            onCommit={(cardWidth) => update({ cardWidth: cardWidth ?? CARD_SIZE.width })}
          />
          <NumberField
            label="Card height"
            value={cardSizeOf(o).height}
            min={10}
            max={2000}
            onCommit={(cardHeight) => update({ cardHeight: cardHeight ?? CARD_SIZE.height })}
          />
        </div>
        <div className="button-row">
          <button
            type="button"
            className="btn btn-small"
            title="Swap card width and height"
            onClick={() => {
              const size = cardSizeOf(o);
              update({ cardWidth: size.height, cardHeight: size.width });
            }}
          >
            <Icon name="swap" size={14} /> Swap card width / height
          </button>
        </div>
        <DrawSideField o={o} update={update} />
        <SelectField
          label="Cards come in"
          value={o.putSide ?? 'keep'}
          options={[
            { value: 'keep', label: 'As they are put in' },
            { value: 'faceUp', label: 'Always face up' },
            { value: 'faceDown', label: 'Always face down' },
          ]}
          onChange={(putSide) => update({ putSide: putSide === 'keep' ? undefined : putSide })}
        />
        <div className="button-row">
          <button type="button" className="btn btn-small" disabled={o.cards.length < 2} onClick={() => shuffleDeck(o.id)}>
            <Icon name="shuffle" size={14} /> Shuffle
          </button>
          {o.initialCards.length > 0 && (
            <button type="button" className="btn btn-small" onClick={() => resetDeck(o.id)}>
              <Icon name="reset" size={14} /> Gather &amp; reset
            </button>
          )}
        </div>
      </Section>
    );
  }

  return (
    <Section title={`Card list (${o.initialCards.length} cards${rows.length < o.initialCards.length ? `, ${rows.length} different` : ''})`}>
      {outOfDeck > 0 && <p className="hint">{outOfDeck} card(s) are currently out of the holder. "Gather &amp; reset" brings them back.</p>}
      <div className="inspector-subsection" role="group" aria-label="Fronts">
        <h4>Fronts</h4>
        <div className="button-row">
          <FileButton
            label="Add cards from images"
            icon="image"
            multiple
            accept={IMAGE_ACCEPT}
            className="btn btn-small"
            testId="deck-add-images"
            onFiles={async (files) => {
              const assets = await uploadImages(files);
              const defs = assets.map((a) => createCardDef({ name: a.name, faceAssetId: a.id, faceText: '' }));
              if (defs.length) update({ cards: [...o.cards, ...defs], initialCards: [...o.initialCards, ...defs] });
            }}
          />
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              const n = o.initialCards.length + 1;
              const def = createCardDef({ name: `Card ${n}`, faceText: String(n) });
              update({ cards: [...o.cards, def], initialCards: [...o.initialCards, def] });
            }}
          >
            <Icon name="plus" size={14} /> Blank card
          </button>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => {
              if (
                o.initialCards.length &&
                !(await confirmDialog({
                  title: 'Replace deck contents?',
                  message: 'All cards in this deck will be replaced by a standard 52-card deck.',
                  confirmLabel: 'Replace',
                }))
              )
                return;
              setCards(standardDeck());
            }}
          >
            Standard 52
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => {
              const v = await promptDialog({
                title: 'Numbered cards',
                label: 'Range (e.g. 1-20 or 1-10x2 for two copies)',
                defaultValue: '1-10',
              });
              const m = v && /^\s*(-?\d+)\s*-\s*(-?\d+)\s*(?:x\s*(\d+))?\s*$/i.exec(v);
              if (!m) return;
              const defs = numberedDeck(Number(m[1]), Number(m[2]), Math.min(10, Number(m[3] ?? 1))).slice(0, 1000);
              update({ cards: [...o.cards, ...defs], initialCards: [...o.initialCards, ...defs] });
            }}
          >
            Numbered…
          </button>
          <button
            type="button"
            className="btn btn-small btn-danger"
            disabled={o.initialCards.length === 0}
            onClick={async () => {
              if (await confirmDialog({ title: 'Remove all cards?', confirmLabel: 'Remove all', danger: true })) setCards([]);
            }}
          >
            Clear
          </button>
        </div>
        <button type="button" className="btn btn-small btn-link" onClick={() => setShowList((v) => !v)} aria-expanded={showList}>
          {showList ? 'Hide card list' : 'Show card list'}
        </button>
        {showList && (
          <ol className="card-def-list">
            {rows.map((g, i) => (
              <CardDefRow
                key={g[0].id}
                def={g[0]}
                index={i}
                count={rows.length}
                copies={g.length}
                individualBacks={individual}
                deckBackColor={o.backColor}
                onChange={(p) => editCard(g[0].id, p)}
                onCopies={(n) => {
                  const next = setCardCopies(o, g[0].id, n);
                  if (next) update(next);
                }}
                onMove={(delta) => {
                  const moved = moveCardGroup(o, g[0].id, delta);
                  if (moved) update(moved);
                }}
                onRemove={() => removeCard(g[0].id)}
              />
            ))}
          </ol>
        )}
        {showList && rows.length > 0 && (
          <div className="button-row">
            <button
              type="button"
              className="btn btn-small"
              title="Give every card in the list the same number of copies"
              onClick={async () => {
                const v = await promptDialog({
                  title: 'Same number of copies for every card',
                  label: `How many copies of each of the ${rows.length} cards in the list? (1–${MAX_CARD_COPIES})`,
                  defaultValue: String(rows[0]?.length ?? 1),
                });
                const n = v === null ? NaN : Math.round(Number(v));
                if (!Number.isFinite(n) || n < 1) return;
                const next = setAllCardCopies(o, Math.min(MAX_CARD_COPIES, n));
                if (next) update(next);
              }}
            >
              Set copies for all cards…
            </button>
          </div>
        )}
        {showList && rows.length > 0 && (
          <p className="hint">
            The number with − / + is how many copies of a card are in the deck (e.g. 12 of one image, 10 of another);{' '}
            <em>Set copies for all cards…</em> applies one number to every card. Face text is only shown on cards without an image.
          </p>
        )}
      </div>
      <div className="inspector-subsection" role="group" aria-label="Backs">
        <h4>Backs</h4>
        <ColorField label="Card back colour" value={o.backColor} onChange={(backColor) => update({ backColor }, `back:${o.id}`)} />
        <ImageField label="Card back image" assetId={o.backAssetId} onChange={(backAssetId) => update({ backAssetId })} />
        <CheckboxField label="Different back for every card" checked={individual} onChange={(on) => void setIndividualBacks(on)} />
        {individual && (
          <>
            <div className="button-row">
              <FileButton
                label="Set backs from images"
                icon="image"
                multiple
                accept={IMAGE_ACCEPT}
                className="btn btn-small"
                testId="deck-set-backs"
                onFiles={async (files) => {
                  // One image per row of the list (every copy of a card gets the same back).
                  const assets = await uploadImages(files);
                  const byId = new Map(rows.flatMap((g, i) => g.map((c) => [c.id, assets[i]?.id] as const)));
                  const apply = (c: CardDef): CardDef => {
                    const backAssetId = byId.get(c.id);
                    return backAssetId ? { ...c, backAssetId } : c;
                  };
                  if (assets.length) update({ cards: o.cards.map(apply), initialCards: o.initialCards.map(apply) });
                }}
              />
            </div>
            <p className="hint">
              Images are assigned to the rows of the card list in order (all copies of a card share it). Use the back buttons in the card
              list for single rows.
            </p>
          </>
        )}
        <div className="button-row">
          <button
            type="button"
            className="btn btn-small"
            disabled={o.initialCards.length === 0 && o.cards.length === 0}
            title="Every card gets its front (image and colour) as its back too"
            onClick={() =>
              update({ individualBacks: true, cards: o.cards.map(withFrontAsBack), initialCards: o.initialCards.map(withFrontAsBack) })
            }
          >
            <Icon name="flip" size={14} /> Use fronts as backs
          </button>
        </div>
      </div>
    </Section>
  );
}

/** How a card comes out of a holder or pile. */
function DrawSideField({ o, update }: { o: DeckObject; update: Update }) {
  return (
    <SelectField
      label="Cards come out"
      value={o.drawSide}
      options={[
        { value: 'keep', label: 'As they lie in the holder' },
        { value: 'faceUp', label: 'Always face up' },
        { value: 'faceDown', label: 'Always face down' },
      ]}
      onChange={(drawSide) => update({ drawSide })}
    />
  );
}

function DieEditor({ o, update }: { o: DieObject; update: Update }) {
  const faces = o.faces ?? [];
  const custom = faces.length > 0;
  const setFaces = (next: DieFace[]) => update({ faces: next, value: Math.min(o.value, Math.max(1, next.length || o.sides)) });
  const editFace = (id: string, patch: Partial<DieFace>) =>
    update({ faces: faces.map((f) => (f.id === id ? { ...f, ...patch } : f)) }, `face:${id}:${Object.keys(patch).join()}`);
  return (
    <Section title="Die">
      <SelectField
        label="Type"
        value={custom ? 'custom' : 'standard'}
        options={[
          { value: 'standard', label: 'Standard (numbers / pips)' },
          { value: 'custom', label: 'Custom faces (images / labels)' },
        ]}
        onChange={(type) => {
          if (type === 'custom' && !custom) {
            setFaces(Array.from({ length: o.sides }, (_, i) => createDieFace({ label: String(i + 1) })));
          } else if (type === 'standard' && custom) {
            update({ faces: [], value: Math.min(o.value, o.sides) });
          }
        }}
      />
      {!custom && (
        <SelectField
          label="Sides"
          value={o.sides}
          options={DIE_SIDES.map((s) => ({ value: s, label: `d${s}` }))}
          onChange={(sides) => update({ sides, value: Math.min(o.value, sides) })}
        />
      )}
      <div className="field">
        <span>Face shown</span>
        <button type="button" className="btn btn-small" onClick={() => void pickDieFace(o.id)}>
          <Icon name="dice" size={14} /> {dieFaceLabel(o, o.value)} · Choose…
        </button>
      </div>
      {custom && (
        <>
          <ol className="card-def-list" aria-label="Die faces">
            {faces.map((f, i) => (
              <li key={f.id} className="card-def-row">
                <span className="card-def-index">{i + 1}</span>
                <input
                  aria-label={`Face ${i + 1} label`}
                  value={f.label}
                  placeholder="label"
                  onChange={(e) => editFace(f.id, { label: e.target.value })}
                />
                <FileButton
                  label={f.assetId ? '✓' : ''}
                  ariaLabel={`${f.assetId ? 'Replace' : 'Upload'} image for face ${i + 1}`}
                  icon="image"
                  accept={IMAGE_ACCEPT}
                  className={`btn btn-small btn-icon ${f.assetId ? 'is-active has-thumb' : ''}`}
                  content={f.assetId ? <AssetThumb assetId={f.assetId} size={26} label={`Image of face ${i + 1}`} /> : undefined}
                  onFiles={async (files) => {
                    const [a] = await uploadImages([files[0]]);
                    if (a) editFace(f.id, { assetId: a.id });
                  }}
                />
                {f.assetId && (
                  <button
                    type="button"
                    className="btn btn-small btn-icon"
                    aria-label={`Remove image from face ${i + 1}`}
                    onClick={() => editFace(f.id, { assetId: undefined })}
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-small btn-icon"
                  aria-label={`Remove face ${i + 1}`}
                  disabled={faces.length <= 2}
                  onClick={() => setFaces(faces.filter((x) => x.id !== f.id))}
                >
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ol>
          <div className="button-row">
            <button
              type="button"
              className="btn btn-small"
              disabled={faces.length >= 100}
              onClick={() => setFaces([...faces, createDieFace({ label: String(faces.length + 1) })])}
            >
              <Icon name="plus" size={14} /> Add face
            </button>
            <FileButton
              label="Add faces from images"
              icon="image"
              multiple
              accept={IMAGE_ACCEPT}
              className="btn btn-small"
              testId="die-add-images"
              onFiles={async (files) => {
                const assets = await uploadImages(files);
                if (assets.length)
                  setFaces([...faces, ...assets.map((a) => createDieFace({ label: a.name, assetId: a.id }))].slice(0, 100));
              }}
            />
          </div>
        </>
      )}
      <ColorField label="Colour" value={o.color} onChange={(color) => update({ color }, `color:${o.id}`)} />
      <ColorField
        label={custom ? 'Label colour' : 'Pip / number colour'}
        value={o.pipColor}
        onChange={(pipColor) => update({ pipColor }, `pip:${o.id}`)}
      />
      <button type="button" className="btn btn-small" onClick={() => rollDie(o.id)}>
        <Icon name="dice" size={14} /> Roll
      </button>
    </Section>
  );
}

/** "Go to" buttons for the holders a card or pile belongs to (selects the holder and brings it into view). */
function HolderLinks({ holders, empty }: { holders: DeckObject[]; empty: string }) {
  if (holders.length === 0) return <p className="hint">{empty}</p>;
  return (
    <div className="field">
      <span>{holders.length === 1 ? 'Holder' : 'Holders'}</span>
      <div className="button-row">
        {holders.map((h) => (
          <button key={h.id} type="button" className="btn btn-small" title="Select this holder" onClick={() => focusObject(h.id)}>
            <Icon name="deck" size={14} /> Go to {displayName(h)}
          </button>
        ))}
      </div>
    </div>
  );
}

const MAX_LISTED_BAG_ITEMS = 200;

/** A holder's card rotation as stored: whole degrees in 0–359, upright stored as missing. */
function setCardRotation(deg: number): number | undefined {
  const d = ((Math.round(deg) % 360) + 360) % 360 || 0;
  return d === 0 ? undefined : d;
}

function bagItemLabel(i: BagItem): string {
  const name = displayName(i);
  if (i.kind === 'deck') return `${name} (${i.cards.length} card${i.cards.length === 1 ? '' : 's'})`;
  if (i.kind === 'token' && tokenCount(i) > 1) return `${name} ×${tokenCount(i)}`;
  return name;
}

function BagEditor({ o, update }: { o: BagObject; update: Update }) {
  const out = useTableStore((s) => s.history.present.objects.filter((x) => x.bagId === o.id).length);
  return (
    <Section title={`Bag (${bagCount(o)} pieces)`}>
      <ColorField label="Bag colour" value={o.color} onChange={(color) => update({ color }, `color:${o.id}`)} />
      <div className="button-row">
        <button type="button" className="btn btn-small" disabled={o.items.length < 2} onClick={() => shuffleBag(o.id)}>
          <Icon name="shuffle" size={14} /> Shuffle
        </button>
        <button type="button" className="btn btn-small" disabled={out === 0} onClick={() => recallToBag(o.id)}>
          <Icon name="reset" size={14} /> Recall everything
        </button>
        <button type="button" className="btn btn-small" disabled={o.items.length === 0} onClick={() => drawFromBag(o.id)}>
          <Icon name="draw" size={14} /> Draw one
        </button>
      </div>
      {o.items.length === 0 ? (
        <p className="hint">The bag is empty.</p>
      ) : (
        <>
          <ol className="card-def-list" aria-label="Bag contents (top first)">
            {o.items.slice(0, MAX_LISTED_BAG_ITEMS).map((i, n) => (
              <li key={i.id} className="card-def-row">
                <span className="card-def-index">{n + 1}</span>
                <span className="object-list-name" title={bagItemLabel(i)}>
                  {bagItemLabel(i)}
                </span>
                <span className="object-list-kind">{kindLabel(i)}</span>
                <button
                  type="button"
                  className="btn btn-small btn-icon"
                  aria-label={`Take ${bagItemLabel(i)} out of the bag`}
                  title="Take out next to the bag"
                  onClick={() => takeFromBag(o.id, i.id)}
                >
                  <Icon name="draw" size={14} />
                </button>
              </li>
            ))}
          </ol>
          {o.items.length > MAX_LISTED_BAG_ITEMS && <p className="hint">Showing the first {MAX_LISTED_BAG_ITEMS} entries.</p>}
        </>
      )}
      <p className="hint">
        Drop cards, piles, tokens, dice and other pieces on the bag to put them in. In Play mode, drag from the bag (or use its menu) to
        draw a random piece; <em>Recall</em> brings back everything that came out of it. Move steps in automations can fill or empty a bag.
      </p>
    </Section>
  );
}

function KindFields({ o, update }: { o: TabletopObject; update: Update }) {
  const table = useTableStore((s) => s.history.present);
  switch (o.kind) {
    case 'board':
      return (
        <Section title="Board / sheet">
          <ImageField label="Image" assetId={o.assetId} testId="board-image-input" onChange={(assetId) => update({ assetId })} />
          {o.assetId && (
            <button type="button" className="btn btn-small" onClick={() => fitToImage(o, o.assetId, update)}>
              Match image aspect ratio
            </button>
          )}
          <ColorField label="Background" value={o.fill} onChange={(fill) => update({ fill }, `fill:${o.id}`)} />
          <p className="hint">Boards stay put in Play mode (so you can draw on them) unless you make them movable there below.</p>
        </Section>
      );
    case 'image':
      return (
        <Section title="Image">
          <ImageField label="Image" assetId={o.assetId} onChange={(assetId) => update({ assetId })} />
          {o.assetId && (
            <button type="button" className="btn btn-small" onClick={() => fitToImage(o, o.assetId, update)}>
              Match image aspect ratio
            </button>
          )}
        </Section>
      );
    case 'card':
      return (
        <Section title="Card">
          <HolderLinks holders={[homeDeckOf(table, o)].filter((h): h is DeckObject => !!h)} empty="This card doesn't belong to a holder." />
          <CheckboxField label="Face up" checked={o.faceUp} onChange={(faceUp) => update({ faceUp })} />
          <TextField label="Face text" value={o.faceText} onCommit={(faceText) => update({ faceText })} />
          <ColorField label="Face colour" value={o.faceColor} onChange={(faceColor) => update({ faceColor }, `face:${o.id}`)} />
          <ImageField label="Face image" assetId={o.faceAssetId} onChange={(faceAssetId) => update({ faceAssetId })} />
          <ColorField label="Back colour" value={o.backColor} onChange={(backColor) => update({ backColor }, `back:${o.id}`)} />
          <ImageField label="Back image" assetId={o.backAssetId} onChange={(backAssetId) => update({ backAssetId })} />
          <p className="hint">Drop a card onto a holder to put it in (in Edit mode it joins that holder's card list).</p>
        </Section>
      );
    case 'deck':
      if (o.isPile) {
        return (
          <Section title={`Pile (${o.cards.length} cards)`}>
            <HolderLinks holders={pileHolders(table, o)} empty="None of these cards belongs to a holder." />
            <DrawSideField o={o} update={update} />
            <div className="button-row">
              <button type="button" className="btn btn-small" disabled={o.cards.length < 2} onClick={() => shuffleDeck(o.id)}>
                <Icon name="shuffle" size={14} /> Shuffle
              </button>
              <button type="button" className="btn btn-small" disabled={!pileHasHome(table, o)} onClick={() => returnPileToHolders(o.id)}>
                <Icon name="reset" size={14} /> Return cards to holders
              </button>
            </div>
            <p className="hint">
              Piles are created by dropping a card onto another card and disappear when empty. Their cards keep the size and back of the
              deck they belong to.
            </p>
          </Section>
        );
      }
      return (
        <>
          <DeckEditor o={o} update={update} part="list" />
          <Section title="Holder">
            <TextField label="Label" value={o.label ?? ''} placeholder="No label" onCommit={(label) => update({ label })} />
            <SelectField
              label="Label position"
              value={o.labelPosition ?? 'above'}
              options={[
                { value: 'above', label: 'Above the holder' },
                { value: 'below', label: 'Below the holder' },
              ]}
              onChange={(labelPosition) => update({ labelPosition })}
            />
            <SelectField
              label="Card layout"
              value={o.layout ?? 'stack'}
              options={[
                { value: 'stack', label: 'Stack (drag takes the top card)' },
                { value: 'spread', label: 'Spread (cards side by side, drag any card)' },
              ]}
              onChange={(layout) => update({ layout })}
            />
            <NumberField
              label="Card rotation in the holder (°)"
              value={o.cardRotation ?? 0}
              onCommit={(deg) => update({ cardRotation: setCardRotation(deg ?? 0) })}
            />
            <div className="button-row" role="group" aria-label="Card rotation presets">
              {[0, 90, 180, 270].map((deg) => (
                <button
                  key={deg}
                  type="button"
                  className={`btn btn-small ${(o.cardRotation ?? 0) === deg ? 'is-active' : ''}`}
                  aria-pressed={(o.cardRotation ?? 0) === deg}
                  onClick={() => update({ cardRotation: setCardRotation(deg) })}
                >
                  {deg}°
                </button>
              ))}
            </div>
            <CheckboxField
              label="Rotate objects to match holder"
              checked={!!o.alignRotation}
              onChange={(alignRotation) => update({ alignRotation })}
            />
            <p className="hint">
              Cards dropped on a holder go into it. A holder with its own card list (above) is a deck. A spread runs along the holder's
              longer side: left to right when it is wider than tall, top to bottom otherwise.
            </p>
          </Section>
          <DeckEditor o={o} update={update} part="settings" />
        </>
      );
    case 'bag':
      return <BagEditor o={o} update={update} />;
    case 'checkbox':
      return (
        <Section title="Checkbox">
          <CheckboxField label="Checked" checked={o.checked} onChange={(checked) => update({ checked })} />
          <SelectField
            label="Mark"
            value={o.mark}
            options={[
              { value: 'check', label: 'Checkmark ✓' },
              { value: 'cross', label: 'Cross ✗' },
              { value: 'dot', label: 'Dot ●' },
              { value: 'fill', label: 'Filled box' },
            ]}
            onChange={(mark) => update({ mark })}
          />
          <SelectField
            label="Box"
            value={o.boxShape}
            options={[
              { value: 'square', label: 'Square' },
              { value: 'circle', label: 'Circle' },
              { value: 'none', label: 'None (mark only, e.g. on a sheet)' },
            ]}
            onChange={(boxShape) => update({ boxShape })}
          />
          <ColorField label="Mark colour" value={o.color} onChange={(color) => update({ color }, `color:${o.id}`)} />
          {o.boxShape !== 'none' && (
            <ColorField label="Box colour" value={o.boxColor} onChange={(boxColor) => update({ boxColor }, `boxColor:${o.id}`)} />
          )}
          <CheckboxField
            label="Box background"
            checked={o.boxFill !== null}
            onChange={(on) => update({ boxFill: on ? '#ffffff' : null })}
          />
          {o.boxFill !== null && (
            <ColorField label="Background colour" value={o.boxFill} onChange={(boxFill) => update({ boxFill }, `boxFill:${o.id}`)} />
          )}
          <p className="hint">
            In Play mode a click checks or unchecks it (it doesn't move there). Double-click it here to set how it starts. A{' '}
            <em>Check boxes</em> automation step can check, uncheck or toggle it, or every checkbox on a board.
          </p>
        </Section>
      );
    case 'token':
      return (
        <Section title="Token">
          <SelectField
            label="Shape"
            value={o.shape}
            options={TOKEN_SHAPES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
            onChange={(shape) => update({ shape })}
          />
          <ColorField label="Colour" value={o.color} onChange={(color) => update({ color }, `color:${o.id}`)} />
          <ImageField label="Image (optional)" assetId={o.assetId} onChange={(assetId) => update({ assetId })} />
          <NumberField
            label="Tokens in stack"
            value={tokenCount(o)}
            min={1}
            max={MAX_TOKEN_STACK}
            onCommit={(n) => update({ count: n === null || n <= 1 ? undefined : Math.round(n) })}
          />
          <p className="hint">
            More than one makes a stack with a count badge. In Play mode, dragging the stack takes one token off; drag the badge (or
            Shift+drag) to move the whole stack. Dropping a token on an identical one stacks it. <em>Recall</em> (menu, or an automation
            step) puts tokens back on the stack they were taken from.
          </p>
        </Section>
      );
    case 'counter':
      return (
        <Section title="Counter">
          <TextField label="Label" value={o.label} onCommit={(label) => update({ label })} />
          <div className="field-grid">
            <NumberField label="Value" value={o.value} onCommit={(value) => update({ value: value ?? 0 })} />
            <NumberField label="Step" value={o.step} min={0.0001} onCommit={(step) => update({ step: step ?? 1 })} />
            <NumberField label="Minimum" value={o.min} allowEmpty onCommit={(min) => update({ min })} />
            <NumberField label="Maximum" value={o.max} allowEmpty onCommit={(max) => update({ max })} />
          </div>
          <ColorField label="Colour" value={o.color} onChange={(color) => update({ color }, `color:${o.id}`)} />
        </Section>
      );
    case 'die':
      return <DieEditor o={o} update={update} />;
    case 'timer': {
      const minutes = Math.floor(o.duration / 60);
      const seconds = o.duration % 60;
      const setDuration = (m: number, s: number) =>
        update({ duration: Math.max(0, Math.min(MAX_TIMER_SECONDS, Math.round(m) * 60 + Math.round(s))) });
      return (
        <Section title="Timer">
          <TextField label="Label" value={o.label} onCommit={(label) => update({ label })} />
          <SelectField
            label="Type"
            value={o.mode}
            options={[
              { value: 'countdown', label: 'Countdown' },
              { value: 'stopwatch', label: 'Stopwatch (counts up)' },
            ]}
            onChange={(mode) => update({ mode })}
          />
          {o.mode === 'countdown' && (
            <>
              <div className="field-grid">
                <NumberField label="Minutes" value={minutes} min={0} max={5999} onCommit={(m) => setDuration(m ?? 0, seconds)} />
                <NumberField label="Seconds" value={seconds} min={0} max={59} onCommit={(s) => setDuration(minutes, s ?? 0)} />
              </div>
              <CheckboxField label="Beep when it runs out" checked={o.sound} onChange={(sound) => update({ sound })} />
            </>
          )}
          <ColorField label="Colour" value={o.color} onChange={(color) => update({ color }, `color:${o.id}`)} />
          <ColorField label="Text colour" value={o.textColor} onChange={(textColor) => update({ textColor }, `text:${o.id}`)} />
          <div className="button-row">
            <button type="button" className="btn btn-small" onClick={() => toggleTimer(o.id)}>
              <Icon name={o.startedAt === undefined ? 'play' : 'pause'} size={14} /> {o.startedAt === undefined ? 'Start' : 'Pause'}
            </button>
            <button type="button" className="btn btn-small" onClick={() => resetTimer(o.id)}>
              <Icon name="reset" size={14} /> Reset
            </button>
          </div>
          <p className="hint">
            Use the ▶ / ❚❚ and ↺ buttons on the timer (in Edit and Play mode) to start, pause and reset it. A countdown flashes red at 0:00;
            starting it again begins a new countdown. A running timer keeps counting while the game is closed.
          </p>
        </Section>
      );
    }
    case 'button':
      return <ButtonFields o={o} update={update} />;
    case 'label':
      return (
        <Section title="Text label">
          <TextField label="Text" value={o.text} multiline maxLength={10000} onCommit={(text) => update({ text })} />
          <NumberField
            label="Font size"
            value={o.fontSize}
            min={4}
            max={400}
            onCommit={(fontSize) => update({ fontSize: fontSize ?? 24 })}
          />
          <ColorField label="Text colour" value={o.color} onChange={(color) => update({ color }, `color:${o.id}`)} />
          <CheckboxField
            label="Background"
            checked={o.background !== null}
            onChange={(on) => update({ background: on ? '#ffffff' : null })}
          />
          {o.background !== null && (
            <ColorField label="Background colour" value={o.background} onChange={(background) => update({ background }, `bg:${o.id}`)} />
          )}
          <SelectField
            label="Alignment"
            value={o.align}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(align) => update({ align })}
          />
        </Section>
      );
  }
}

/** The image that best identifies an object in a list (its picture, a card's face, a deck's back). */
function mainImageOf(o: TabletopObject): string | undefined {
  switch (o.kind) {
    case 'board':
    case 'image':
    case 'token':
      return o.assetId;
    case 'card':
      return o.faceAssetId;
    case 'deck':
      return o.backAssetId;
    default:
      return undefined;
  }
}

export function ObjectList() {
  const objects = useTableStore((s) => s.history.present.objects);
  const selectedIds = useTableStore((s) => s.selectedIds);
  const sorted = sortByZ(objects).reverse();
  if (sorted.length === 0) return <p className="hint">The table is empty. Add objects from the palette on the left.</p>;
  return (
    <ul className="object-list" aria-label="Objects (top first)">
      {sorted.map((o) => {
        const isSelected = selectedIds.includes(o.id);
        return (
          <li key={o.id}>
            <button
              type="button"
              className={`object-list-item ${isSelected ? 'is-selected' : ''}`}
              aria-pressed={isSelected}
              title="Ctrl/Shift+click to select several"
              onClick={(e) => {
                const s = useTableStore.getState();
                if (s.mode === 'edit' && (e.ctrlKey || e.metaKey || e.shiftKey)) s.toggleSelected(o.id);
                else s.select(o.id);
              }}
            >
              <span className="object-list-name">{displayName(o)}</span>
              {mainImageOf(o) && <AssetThumb assetId={mainImageOf(o)!} size={20} label={`${displayName(o)} image`} />}
              <span className="object-list-kind">{kindLabel(o)}</span>
              {o.locked && <Icon name="lock" size={12} aria-label="locked" />}
              {!o.visible && <Icon name="eyeOff" size={12} aria-label="hidden" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Inspector content for an Edit-mode multi-selection. */
function MultiSelection({ ids }: { ids: string[] }) {
  const objects = useTableStore((s) => s.history.present.objects);
  const members = objects.filter((o) => ids.includes(o.id));
  const allLocked = members.every((o) => o.locked);
  return (
    <div className="inspector">
      <div className="inspector-heading">
        <h2>{ids.length} objects selected</h2>
        <button type="button" className="btn btn-small" onClick={() => useTableStore.getState().select(null)}>
          Done
        </button>
      </div>
      <Section title="Selection">
        <div className="button-row">
          <button type="button" className="btn btn-small" onClick={() => duplicateObjects(ids)}>
            <Icon name="copy" size={14} /> Duplicate all
          </button>
          <button type="button" className={`btn btn-small ${allLocked ? 'is-active' : ''}`} onClick={() => toggleLockMany(ids)}>
            <Icon name={allLocked ? 'lock' : 'unlock'} size={14} /> {allLocked ? 'Unlock all' : 'Lock all'}
          </button>
          <button type="button" className="btn btn-small btn-danger" onClick={() => deleteObjects(ids)}>
            <Icon name="trash" size={14} /> Delete all
          </button>
        </div>
        <p className="hint">Ctrl/Shift+click objects to add or remove them. Drag any selected object to move them all.</p>
      </Section>
      <Section title="Objects">
        <ObjectList />
      </Section>
    </div>
  );
}

export function Inspector() {
  const selected = useTableStore((s) => s.history.present.objects.find((o) => o.id === s.selectedId));
  const selectedIds = useTableStore((s) => s.selectedIds);
  const update = useUpdate(selected?.id ?? '');
  if (selectedIds.length > 1) return <MultiSelection ids={selectedIds} />;
  if (!selected) {
    return (
      <div className="inspector">
        <Section title="Objects">
          <ObjectList />
        </Section>
      </div>
    );
  }
  return (
    <div className="inspector" key={selected.id}>
      <div className="inspector-heading">
        <h2>{kindLabel(selected)}</h2>
        <button type="button" className="btn btn-small" onClick={() => useTableStore.getState().select(null)}>
          Done
        </button>
      </div>
      <KindFields o={selected} update={update} />
      <CommonFields o={selected} update={update} />
    </div>
  );
}
