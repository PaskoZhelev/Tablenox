import { memo, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Group, Rect } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { cardIndexAt, findHoverTarget, isSpread, spreadInsertIndex } from '../domain/rules';
import { isHolder } from '../domain/objects';
import type { Mode, TabletopObject } from '../domain/types';
import { currentTable, useTableStore } from '../state/tableStore';
import {
  dropObject,
  flipCard,
  flipDeckCard,
  incrementCounter,
  pickOnTable,
  resetTimer,
  rollDie,
  runButton,
  toggleCheckbox,
  toggleTimer,
} from '../canvas/actions';
import { registerPrimaryClick, resetDoubleClick } from '../canvas/doubleClick';
import { tapsSuppressed } from '../canvas/touch';
import { ObjectVisual } from './visuals';

const BACKGROUND_KINDS = new Set(['board', 'deck', 'bag']);

interface Props {
  object: TabletopObject;
  mode: Mode;
  draggable: boolean;
  /** A dragged card would be added to this object on release. */
  dropTarget: boolean;
  /** Chosen for the button step being picked on the table. */
  picked?: boolean;
  /** Shown from the automations panel: outlined even when locked (no Transformer). */
  focused?: boolean;
}

function centerOf(node: Konva.Node) {
  return { x: node.x(), y: node.y() };
}

/** True while `id` is part of a multi-selection (the Transformer then drags all members together). */
function inGroupSelection(id: string): boolean {
  const s = useTableStore.getState();
  return s.selectedIds.length > 1 && s.selectedIds.includes(id);
}

// All members of one group drag share a coalesce key, so the whole move is a single undo step.
let groupDragKey = '';
let groupDragSeq = 0;

/** "Picked up" look while dragging in Play mode: a slight clockwise tilt, a little larger, with a soft drop shadow. */
const LIFT = {
  rotation: 3,
  scale: 1.04,
  duration: 0.12,
  shadowX: 8,
  shadowY: 14,
  shadowOpacity: 0.5,
  shadowBlur: 10,
  /** Longest side of the blurred shadow bitmap, in pixels (keeps blurring cheap for large boards). */
  shadowResolution: 240,
};

function ObjectNodeImpl({ object: o, mode, draggable, dropTarget, picked, focused }: Props) {
  const liftRef = useRef<Konva.Group>(null);
  const shadowRef = useRef<Konva.Group>(null);
  const [lifted, setLifted] = useState(false);

  // The shadow is a blurred, blackened copy of the object, so it follows its real silhouette (cards, round tokens…).
  useEffect(() => {
    const g = shadowRef.current;
    if (!lifted || !g) return;
    try {
      g.cache({ pixelRatio: Math.min(1, LIFT.shadowResolution / Math.max(o.width, o.height)), offset: LIFT.shadowBlur * 3 });
      g.filters([Konva.Filters.Blur, Konva.Filters.Brighten]);
      g.blurRadius(LIFT.shadowBlur);
      g.brightness(-1);
    } catch {
      // Caching needs a real canvas; without one the object simply has no shadow.
    }
  }, [lifted, o.width, o.height]);

  const lift = () => {
    // Play mode only: in Edit mode objects move without the picked-up effect.
    if (useTableStore.getState().mode !== 'play') return;
    setLifted(true);
    liftRef.current?.to({ rotation: LIFT.rotation, scaleX: LIFT.scale, scaleY: LIFT.scale, duration: LIFT.duration });
  };

  const land = () => {
    setLifted(false);
    liftRef.current?.to({ rotation: 0, scaleX: 1, scaleY: 1, duration: LIFT.duration });
  };

  const onDragStart = (e: KonvaEventObject<DragEvent>) => {
    const s = useTableStore.getState();
    lift();
    if (inGroupSelection(o.id)) {
      if (!s.draggingId) groupDragKey = `group-drag:${++groupDragSeq}`;
    } else {
      if (!BACKGROUND_KINDS.has(o.kind)) e.target.moveToTop();
      s.select(o.id);
    }
    if (!s.draggingId) s.setDragging(o.id);
  };

  const onDragMove = (e: KonvaEventObject<DragEvent>) => {
    const dragsCards = o.kind === 'card' || o.kind === 'deck';
    if (o.kind === 'board' || o.kind === 'bag' || isHolder(o) || inGroupSelection(o.id)) return;
    const free = !!(e.evt as MouseEvent | undefined)?.shiftKey;
    const center = centerOf(e.target);
    const table = currentTable();
    const target = free ? undefined : findHoverTarget(table, o.id, center);
    // Cards and piles over a spread holder show the place they would take.
    const index = dragsCards && target?.kind === 'deck' && isSpread(target) ? spreadInsertIndex(table.objects, target, center) : null;
    useTableStore.getState().setDropTarget(target?.id ?? null, index);
  };

  const onDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target as unknown as Konva.Group;
    const free = !!(e.evt as MouseEvent | undefined)?.shiftKey;
    const s = useTableStore.getState();
    land();
    s.setDropTarget(null);
    s.setDragging(null);
    const position = { x: Math.round(node.x() - o.width / 2), y: Math.round(node.y() - o.height / 2) };
    if (inGroupSelection(o.id)) {
      s.dispatch({ type: 'MoveObject', id: o.id, position }, { coalesceKey: groupDragKey });
    } else {
      dropObject(o.id, position, free);
    }
    // react-konva will not reposition the node if the stored value is unchanged, so sync it explicitly.
    const after = currentTable().objects.find((x) => x.id === o.id);
    if (after) node.position({ x: after.position.x + after.width / 2, y: after.position.y + after.height / 2 });
  };

  const runDoubleAction = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const s = useTableStore.getState();
    if (s.tool !== 'select' || s.picking) return;
    if (o.kind === 'card' && !o.locked) flipCard(o.id);
    else if (o.kind === 'die') rollDie(o.id);
    else if (o.kind === 'checkbox' && mode === 'edit') toggleCheckbox(o.id);
    else if (o.kind === 'deck') {
      // A stack turns its top card over; a spread turns over the card that was double-clicked.
      const world = e.target.getStage()?.getRelativePointerPosition();
      const index = isSpread(o) ? (world ? cardIndexAt(currentTable().objects, o, world) : null) : 0;
      if (index !== null) flipDeckCard(o.id, index);
    }
  };

  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const isPlayButton = o.kind === 'button' && mode === 'play';
  /** Play-mode buttons and checkboxes react to a click (they don't move or get an action bar there). */
  const clickInPlay = (o.kind === 'button' || o.kind === 'checkbox') && mode === 'play';
  const [pressed, setPressed] = useState(false);

  // Play-mode buttons sink while held and spring back when released (wherever the pointer is let go).
  useEffect(() => {
    liftRef.current?.to({ scaleX: pressed ? 0.95 : 1, scaleY: pressed ? 0.95 : 1, duration: pressed ? 0.05 : 0.12 });
    if (!pressed) return;
    const release = () => setPressed(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, [pressed]);

  const onPress = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const p = 'touches' in e.evt ? e.evt.touches[0] : (e.evt as MouseEvent);
    pressAt.current = p ? { x: p.clientX, y: p.clientY } : null;
    const primary = 'touches' in e.evt || (e.evt as MouseEvent).button === 0;
    if (isPlayButton && primary && useTableStore.getState().tool === 'select') setPressed(true);
  };

  /** Play mode: a click (not a camera drag that started on it) runs the button / toggles the checkbox. */
  const runButtonClick = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const press = pressAt.current;
    pressAt.current = null;
    const p = 'changedTouches' in e.evt ? e.evt.changedTouches[0] : (e.evt as MouseEvent);
    if (press && p && Math.hypot(p.clientX - press.x, p.clientY - press.y) > 6) return;
    if (useTableStore.getState().tool !== 'select') return;
    if (o.kind === 'checkbox') toggleCheckbox(o.id);
    else runButton(o.id);
  };

  const onClick = (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return resetDoubleClick();
    if (useTableStore.getState().picking) return;
    if (clickInPlay) return runButtonClick(e);
    if (registerPrimaryClick(o.id)) runDoubleAction(e);
  };

  const onTap = (e: KonvaEventObject<TouchEvent>) => {
    if (clickInPlay && !tapsSuppressed()) runButtonClick(e);
  };

  const onDblTap = (e: KonvaEventObject<TouchEvent>) => {
    if (!tapsSuppressed()) runDoubleAction(e);
  };

  /** Reports the object (and, for a holder/pile, the card) under the mouse for the hover preview. */
  const hoverAt = (e: KonvaEventObject<MouseEvent>) => {
    let cardId: string | null = null;
    if (o.kind === 'deck') {
      const world = e.target.getStage()?.getRelativePointerPosition();
      const index = world ? cardIndexAt(currentTable().objects, o, world) : null;
      cardId = index === null ? null : (o.cards[index]?.id ?? null);
    }
    useTableStore.getState().setHover(o.id, cardId);
  };

  return (
    <Group
      id={o.id}
      name="object"
      x={o.position.x + o.width / 2}
      y={o.position.y + o.height / 2}
      offsetX={o.width / 2}
      offsetY={o.height / 2}
      rotation={o.rotation}
      draggable={draggable}
      opacity={dropTarget && !(o.kind === 'deck' && isSpread(o)) ? 0.45 : o.visible ? 1 : 0.35}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onTap}
      onMouseDown={onPress}
      onTouchStart={onPress}
      onDblTap={onDblTap}
      onMouseEnter={(e) => {
        hoverAt(e);
        const c = e.target.getStage()?.container();
        if (clickInPlay && c) c.style.cursor = 'pointer';
      }}
      onMouseMove={o.kind === 'deck' ? hoverAt : undefined}
      onMouseLeave={(e) => {
        useTableStore.getState().setHover(null);
        const c = e.target.getStage()?.container();
        if (clickInPlay && c) c.style.cursor = '';
      }}
    >
      {/* Tilted and scaled while lifted; rotation/scale are animated imperatively, so they are not props here. */}
      <Group ref={liftRef} name="lift" x={o.width / 2} y={o.height / 2} offsetX={o.width / 2} offsetY={o.height / 2}>
        {lifted && (
          <Group ref={shadowRef} name="lift-shadow" x={LIFT.shadowX} y={LIFT.shadowY} opacity={LIFT.shadowOpacity} listening={false}>
            <ObjectVisual o={o} mode={mode} />
          </Group>
        )}
        <ObjectVisual
          o={o}
          mode={mode}
          pressed={pressed}
          onStep={(d) => (useTableStore.getState().picking ? pickOnTable([o.id], 'toggle') : incrementCounter(o.id, d))}
          onTimer={(a) => {
            if (useTableStore.getState().picking) pickOnTable([o.id], 'toggle');
            else if (a === 'toggle') toggleTimer(o.id);
            else resetTimer(o.id);
          }}
        />
      </Group>
      {focused && (
        <Rect
          name="focus-outline"
          x={-12}
          y={-12}
          width={o.width + 24}
          height={o.height + 24}
          stroke="#f4c542"
          strokeWidth={3}
          cornerRadius={8}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {picked && (
        <Rect
          name="pick-outline"
          x={-6}
          y={-6}
          width={o.width + 12}
          height={o.height + 12}
          stroke="#38bdf8"
          strokeWidth={3}
          dash={[10, 6]}
          cornerRadius={6}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {dropTarget && (
        <Rect
          x={-10}
          y={-10}
          width={o.width + 20}
          height={o.height + 20}
          stroke="#f4c542"
          strokeWidth={4}
          cornerRadius={6}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </Group>
  );
}

export const ObjectNode = memo(ObjectNodeImpl);
