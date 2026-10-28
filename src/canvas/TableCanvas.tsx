import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Circle, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import { simplifyPoints, strokeHit, textHit } from '../domain/annotations';
import { panBy, pinchBy, screenToWorld, zoomBy, type PinchPoint } from '../domain/camera';
import { newId } from '../domain/ids';
import { fixedInPlay, movableInPlay, ownerDeckOf, resolveCardLook, sortByZ, tokenCount } from '../domain/objects';
import { objectBounds } from '../domain/geometry';
import type { TabletopObject, Vec2 } from '../domain/types';
import { AnnotationLayer } from '../drawing/AnnotationLayer';
import { focusTextEditor, startEditingText } from '../drawing/textEditing';
import { TextEditorOverlay } from '../drawing/TextEditorOverlay';
import { ObjectNode } from '../objects/ObjectNode';
import { currentTable, MULTI_BAR, useTableStore } from '../state/tableStore';
import { ContextMenu, SelectionBar } from './SelectionBar';
import { getObjectActions, hasObjectControls } from './objectActions';
import { HoverPreview } from './HoverPreview';
import { FlashOutline } from './FlashOutline';
import {
  cardIndexAt,
  drawCardCommand,
  drawRandomFromBagCommand,
  pressPreviewOf,
  splitTokensCommand,
  takeStackCommand,
} from '../domain/rules';
import type { Command } from '../domain/commands';
import { resetDoubleClick } from './doubleClick';
import { Grid } from './Grid';
import { isLightColor } from './colors';
import { registerStage } from './stageRegistry';
import { pickOnTable } from './actions';
import { pickedIds } from '../domain/buttons';
import { allowTaps, LONG_PRESS_MS, LONG_PRESS_SLOP, suppressTaps, tapsSuppressed, TOUCH_DRAG_DISTANCE } from './touch';

type Gesture =
  | {
      kind: 'pan';
      start: Vec2;
      last: Vec2;
      moved: boolean;
      clickSelect: string | null;
      canMove: boolean;
      additive?: boolean;
      /** Started in pick mode: never changes the selection. */
      pick?: boolean;
    }
  | { kind: 'pen'; points: number[] }
  | { kind: 'erase'; strokeIds: Set<string>; textIds: Set<string> }
  | { kind: 'deck'; deckId: string; start: Vec2; index: number | 'all' }
  /** Play mode: a press on a bag; dragging draws a random piece out of it. */
  | { kind: 'bag'; id: string; start: Vec2 }
  /** Play mode: a press on a token stack; dragging takes one token off it. */
  | { kind: 'token'; id: string; start: Vec2 }
  /** Edit-mode selection box; `clickSelect` is selected if the pointer never moves. In pick mode it picks objects instead. */
  | { kind: 'marquee'; start: Vec2; startWorld: Vec2; moved: boolean; additive: boolean; clickSelect: string | null; pick?: boolean }
  /** Play mode: a press on a member of a box selection that isn't draggable by itself (pile, stack…); dragging moves the selection. */
  | { kind: 'group'; id: string; start: Vec2 };

const EMPTY_SET: ReadonlySet<string> = new Set();
const KEEP_RATIO_KINDS = new Set(['board', 'image', 'card', 'token', 'die']);
const CLICK_SLOP = 4;
const DECK_DRAG_SLOP = 6;
const COARSE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

type Pinch = PinchPoint;
function findObjectNode(target: Konva.Node): Konva.Node | null {
  let n: Konva.Node | null = target;
  while (n && !(n.getType() === 'Stage')) {
    if (n.hasName('object')) return n;
    n = n.getParent();
  }
  return null;
}

const isTokenStack = (o: TabletopObject) => o.kind === 'token' && tokenCount(o) > 1;

function isDeckHandle(target: Konva.Node): boolean {
  let n: Konva.Node | null = target;
  while (n && n.getType() !== 'Stage') {
    if (n.hasName('deck-handle')) return true;
    if (n.hasName('object')) return false;
    n = n.getParent();
  }
  return false;
}

function isUiButton(target: Konva.Node): boolean {
  let n: Konva.Node | null = target;
  while (n && n.getType() !== 'Stage') {
    if (n.hasName('ui-button') || n.getClassName() === 'Transformer') return true;
    if (n.hasName('object')) return false;
    n = n.getParent();
  }
  return false;
}

export function TableCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const liveLineRef = useRef<Konva.Line>(null);
  const eraserRef = useRef<Konva.Circle>(null);
  const marqueeRef = useRef<Konva.Rect>(null);
  const gesture = useRef<Gesture | null>(null);
  /** The gesture that ended last: a click / tap arrives after the window's pointerup has already ended it. */
  const lastGesture = useRef<Gesture | null>(null);
  /** Active touch points (client coordinates), a running two-finger pinch and a pending long-press. */
  const touches = useRef(new Map<number, Vec2>());
  const pinch = useRef<Pinch | null>(null);
  const longPress = useRef<{ timer: number; start: Vec2 } | null>(null);
  /** A touch that closed the text editor only closes it (like a click elsewhere with the mouse). */
  const closedEditor = useRef(false);
  const pendingDragId = useRef<string | null>(null);
  const swallowClick = useRef(false);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [panning, setPanning] = useState(false);

  const viewport = useTableStore((s) => s.viewport);
  const setViewport = useTableStore((s) => s.setViewport);
  const camera = useTableStore((s) => s.camera);
  const objects = useTableStore((s) => s.history.present.objects);
  const annotations = useTableStore((s) => s.history.present.annotations);
  const mode = useTableStore((s) => s.mode);
  const tool = useTableStore((s) => s.tool);
  const selectedId = useTableStore((s) => s.selectedId);
  const selectedIds = useTableStore((s) => s.selectedIds);
  const spaceHeld = useTableStore((s) => s.spaceHeld);
  const showGrid = useTableStore((s) => s.ui.showGrid);
  const tableColor = useTableStore((s) => s.doc?.tableColor);
  const dropTargetId = useTableStore((s) => s.dropTargetId);
  const editingId = useTableStore((s) => s.editingText?.id);
  const pen = useTableStore((s) => s.pen);
  const picking = useTableStore((s) => s.picking);
  const automationsOpen = useTableStore((s) => s.mode === 'edit' && !!s.automationButtonId);
  const pickedSet = useMemo(() => {
    if (!picking) return EMPTY_SET;
    const button = objects.find((o) => o.id === picking.buttonId);
    const step = button?.kind === 'button' ? button.steps.find((st) => st.id === picking.stepId) : undefined;
    return step ? new Set(pickedIds(step, picking.field)) : EMPTY_SET;
  }, [objects, picking]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewport]);

  useEffect(() => () => registerStage(null), []);

  const setStageRef = useCallback((s: Konva.Stage | null) => {
    stageRef.current = s;
    registerStage(s);
  }, []);

  useEffect(() => {
    if (tool !== 'eraser' && eraserRef.current?.visible()) {
      eraserRef.current.visible(false);
      eraserRef.current.getLayer()?.batchDraw();
    }
  }, [tool]);

  const sorted = useMemo(() => sortByZ(objects).filter((o) => o.visible || mode === 'edit'), [objects, mode]);
  const selected = useMemo(() => objects.find((o) => o.id === selectedId) ?? null, [objects, selectedId]);
  const transformable = useMemo(() => {
    if (tool !== 'select' || picking) return [];
    if (mode === 'edit') return objects.filter((o) => selectedIds.includes(o.id) && !o.locked);
    // Play mode: the pieces of a box selection drag together (the Transformer has no resize / rotate handles there).
    return selectedIds.length > 1 ? objects.filter((o) => selectedIds.includes(o.id) && movableInPlay(o)) : [];
  }, [objects, selectedIds, mode, tool, picking]);

  // Play mode: holders, piles, token stacks and buttons react to presses themselves (see onPointerDown); boards/holders may be fixed.
  const isDraggable = useCallback(
    (o: TabletopObject) =>
      tool === 'select' &&
      !spaceHeld &&
      !picking &&
      !o.locked &&
      (mode === 'edit' ||
        (o.kind !== 'deck' && o.kind !== 'bag' && o.kind !== 'button' && o.kind !== 'checkbox' && !isTokenStack(o) && !fixedInPlay(o))),
    [tool, spaceHeld, mode, picking],
  );

  const showTransformer = transformable.length > 0;
  const transformIds = transformable.map((o) => o.id).join();

  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const ids = new Set(transformIds ? transformIds.split(',') : []);
    const nodes = ids.size ? stage.find((n: Konva.Node) => n.hasName('object') && ids.has(n.id())) : [];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [transformIds, objects]);

  // After drawing a card by dragging from a deck, hand the active pointer over to the new card.
  useEffect(() => {
    const id = pendingDragId.current;
    if (!id) return;
    pendingDragId.current = null;
    const node = stageRef.current?.findOne((n: Konva.Node) => n.id() === id && n.hasName('object'));
    node?.startDrag();
  }, [objects]);

  const endGesture = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    lastGesture.current = g;
    const s = useTableStore.getState();
    switch (g.kind) {
      case 'pan':
        setPanning(false);
        if (!g.moved && !g.additive && !g.pick) s.select(g.clickSelect);
        break;
      case 'marquee': {
        const rect = marqueeRef.current;
        rect?.visible(false);
        rect?.getLayer()?.batchDraw();
        if (!g.moved) {
          // Play mode has no Shift+click selection, so a click there always selects (or clears) as usual.
          if ((!g.additive || s.mode === 'play') && !g.pick) s.select(g.clickSelect);
          break;
        }
        const box = { x: rect?.x() ?? 0, y: rect?.y() ?? 0, width: rect?.width() ?? 0, height: rect?.height() ?? 0 };
        const inside = sortByZ(currentTable().objects)
          .filter((o) => (s.mode === 'edit' ? true : g.pick ? o.visible : movableInPlay(o)))
          .filter((o) => {
            const b = objectBounds(o);
            return b.x >= box.x && b.y >= box.y && b.x + b.width <= box.x + box.width && b.y + b.height <= box.y + box.height;
          })
          .map((o) => o.id);
        if (g.pick) {
          pickOnTable(inside, 'add');
          break;
        }
        const ids = g.additive ? [...s.selectedIds, ...inside.filter((id) => !s.selectedIds.includes(id))] : inside;
        s.setSelection(ids);
        // Play mode has no group actions, so a group gets no action bar there.
        s.setSelectionBar(ids.length > 1 ? (s.mode === 'edit' ? MULTI_BAR : null) : (ids[0] ?? null));
        break;
      }
      case 'pen': {
        const line = liveLineRef.current;
        line?.points([]);
        line?.getLayer()?.batchDraw();
        const points = simplifyPoints(g.points, 0.75 / s.camera.scale);
        if (points.length >= 2) {
          s.dispatch({
            type: 'AddStroke',
            stroke: {
              id: newId(),
              points,
              color: s.pen.color,
              width: s.pen.width,
              opacity: s.pen.opacity,
            },
          });
        }
        break;
      }
      case 'erase':
        if (g.strokeIds.size || g.textIds.size) {
          s.dispatch({ type: 'EraseAnnotations', strokeIds: [...g.strokeIds], textIds: [...g.textIds] });
        }
        setHiddenIds(EMPTY_SET);
        break;
      case 'deck':
        s.select(g.deckId);
        break;
      case 'bag':
        s.select(g.id);
        break;
      case 'token':
        s.select(g.id);
        break;
    }
  }, []);

  useEffect(() => {
    const up = () => endGesture();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
    };
  }, [endGesture]);

  /** Drops the running gesture without applying it (a second finger turned it into a pinch, or a long-press opened the menu). */
  const cancelGesture = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    lastGesture.current = null;
    setPanning(false);
    if (g?.kind === 'pen') {
      liveLineRef.current?.points([]);
      liveLineRef.current?.getLayer()?.batchDraw();
    } else if (g?.kind === 'erase') {
      setHiddenIds(EMPTY_SET);
    } else if (g?.kind === 'marquee') {
      marqueeRef.current?.visible(false);
      marqueeRef.current?.getLayer()?.batchDraw();
    }
    if (eraserRef.current?.visible()) {
      eraserRef.current.visible(false);
      eraserRef.current.getLayer()?.batchDraw();
    }
  }, []);

  const eraseAt = (world: Vec2, g: Extract<Gesture, { kind: 'erase' }>) => {
    const s = useTableStore.getState();
    const radius = s.eraserRadius / s.camera.scale;
    const ann = currentTable().annotations;
    let changed = false;
    for (const st of ann.strokes) {
      if (!g.strokeIds.has(st.id) && strokeHit(st, world, radius)) {
        g.strokeIds.add(st.id);
        changed = true;
      }
    }
    for (const t of ann.text) {
      if (!g.textIds.has(t.id) && textHit(t, world, radius)) {
        g.textIds.add(t.id);
        changed = true;
      }
    }
    if (changed) setHiddenIds(new Set([...g.strokeIds, ...g.textIds]));
  };

  const onPointerDown = (e: KonvaEventObject<PointerEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const evt = e.evt;
    lastGesture.current = null;
    // Two fingers on the table pinch-zoom and pan (see the touch listeners below).
    if (pinch.current || touches.current.size > 1) return;
    const s = useTableStore.getState();
    if (s.editingText || closedEditor.current) {
      closedEditor.current = false;
      swallowClick.current = true;
      return;
    }
    swallowClick.current = false;
    if (evt.button !== 0) resetDoubleClick();
    if (evt.button === 2) return;
    const screen = stage.getPointerPosition();
    const world = stage.getRelativePointerPosition();
    if (!screen || !world) return;

    const startPan = (clickSelect: string | null, explicit = false) => {
      // With the camera locked, plain drags only select; explicit panning (Pan tool, Space, middle button) still works.
      const canMove = explicit || !s.ui.cameraLocked;
      gesture.current = { kind: 'pan', start: screen, last: screen, moved: false, clickSelect, canMove };
    };

    if (evt.button === 1 || s.tool === 'pan' || s.spaceHeld) {
      evt.preventDefault();
      startPan(s.selectedId, true);
      setPanning(true);
      return;
    }

    switch (s.tool) {
      case 'pen':
        gesture.current = { kind: 'pen', points: [world.x, world.y] };
        liveLineRef.current?.points([world.x, world.y, world.x + 0.01, world.y]);
        liveLineRef.current?.getLayer()?.batchDraw();
        return;
      case 'eraser': {
        const g: Gesture = { kind: 'erase', strokeIds: new Set(), textIds: new Set() };
        gesture.current = g;
        eraseAt(world, g);
        return;
      }
      case 'text':
        return;
      case 'select': {
        if (s.picking) {
          // Pick mode: Shift+drag (or any drag with the camera locked) boxes objects in; other drags pan. Clicks pick (see onClick).
          if (evt.shiftKey || s.ui.cameraLocked) {
            gesture.current = {
              kind: 'marquee',
              start: screen,
              startWorld: world,
              moved: false,
              additive: true,
              clickSelect: null,
              pick: true,
            };
          } else {
            startPan(null);
            if (gesture.current?.kind === 'pan') gesture.current.pick = true;
          }
          return;
        }
        if (isUiButton(e.target) || e.target.hasName('text-annotation')) return;
        const node = findObjectNode(e.target);
        const obj = node ? currentTable().objects.find((o) => o.id === node.id()) : undefined;
        // Edit mode: Ctrl/Cmd/Shift+click adds to / removes from the selection (applied on click, see onClick).
        const additive = s.mode === 'edit' && (evt.ctrlKey || evt.metaKey || evt.shiftKey);
        // Dragging the table draws a selection box when the camera is locked, or with Shift (Shift adds to the selection).
        const marquee = s.ui.cameraLocked || evt.shiftKey;
        const startMarquee = (clickSelect: string | null) => {
          gesture.current = {
            kind: 'marquee',
            start: screen,
            startWorld: world,
            moved: false,
            additive: additive || evt.shiftKey,
            clickSelect,
          };
        };
        if (!obj) {
          if (marquee) startMarquee(null);
          else startPan(null);
          return;
        }
        if (s.mode === 'play' && node && s.selectedIds.length > 1 && s.selectedIds.includes(obj.id) && movableInPlay(obj)) {
          // A member of a Play-mode box selection: dragging it moves the whole selection (the Transformer moves the rest).
          if (!node.draggable()) gesture.current = { kind: 'group', id: obj.id, start: screen };
          return;
        }
        if (s.mode === 'play' && obj.kind === 'deck') {
          const onBadge = isDeckHandle(e.target);
          if (obj.isPile) {
            // A pile is a loose stack: its badge or Shift+drag moves it; elsewhere a drag takes its top card.
            if ((evt.shiftKey || onBadge) && !obj.locked && node) {
              s.select(obj.id);
              node.startDrag();
              return;
            }
            gesture.current = { kind: 'deck', deckId: obj.id, start: screen, index: 0 };
            return;
          }
          const movable = !obj.locked && !fixedInPlay(obj) && !!node;
          if (onBadge && obj.cards.length > 0) {
            // Dragging the count badge lifts the whole stack out of the holder; the holder stays put.
            gesture.current = { kind: 'deck', deckId: obj.id, start: screen, index: 'all' };
            return;
          }
          const index = evt.shiftKey ? null : cardIndexAt(currentTable().objects, obj, world);
          if (index !== null) {
            gesture.current = { kind: 'deck', deckId: obj.id, start: screen, index };
            return;
          }
          if (movable && node) {
            // Not on a card (or Shift held): a holder that may move in Play mode is dragged.
            s.select(obj.id);
            node.startDrag();
            return;
          }
          // Otherwise the holder acts like the table surface (drag pans or draws a selection box, click selects).
          if (marquee) startMarquee(null);
          else startPan(obj.id);
          return;
        }
        if (s.mode === 'play' && obj.kind === 'bag') {
          // A bag with something in it: a drag draws a random piece (Shift+drag moves a bag that may move in Play mode).
          const movable = !obj.locked && !fixedInPlay(obj) && !!node;
          if (obj.items.length > 0 && !evt.shiftKey) {
            gesture.current = { kind: 'bag', id: obj.id, start: screen };
            return;
          }
          if (movable && node) {
            s.select(obj.id);
            node.startDrag();
            return;
          }
          if (marquee) startMarquee(null);
          else startPan(obj.id);
          return;
        }
        if (s.mode === 'play' && (obj.kind === 'button' || obj.kind === 'checkbox')) {
          // Buttons and checkboxes don't move in Play mode: dragging pans (or draws a selection box), a click runs / toggles them.
          if (marquee) startMarquee(null);
          else startPan(null);
          return;
        }
        if (s.mode === 'play' && isTokenStack(obj) && !obj.locked && node) {
          // A token stack: its badge or Shift+drag moves the whole stack; elsewhere a drag takes one token off.
          if (evt.shiftKey || isDeckHandle(e.target)) {
            s.select(obj.id);
            node.startDrag();
            return;
          }
          gesture.current = { kind: 'token', id: obj.id, start: screen };
          return;
        }
        if (obj.locked || (s.mode === 'play' && fixedInPlay(obj))) {
          // Locked objects (and boards in Play mode) act like the table surface: drag pans (or draws a selection box), click selects (edit mode only).
          if (marquee) startMarquee(s.mode === 'edit' ? obj.id : null);
          else {
            startPan(s.mode === 'edit' ? obj.id : null);
            if (gesture.current?.kind === 'pan') gesture.current.additive = additive;
          }
          return;
        }
        if (additive) return;
        // Pressing on a member of a multi-selection keeps the group, so it can be dragged together.
        if (s.selectedIds.length > 1 && s.selectedIds.includes(obj.id)) return;
        s.select(obj.id);
      }
    }
  };

  /** Opens the object menu for whatever is under `target` (right-click, or a long-press on touch screens). */
  const openMenuAt = useCallback((target: Konva.Node, screen: Vec2): boolean => {
    const s = useTableStore.getState();
    if (s.picking) return false;
    const node = findObjectNode(target);
    const obj = node ? currentTable().objects.find((o) => o.id === node.id()) : undefined;
    if (!obj) {
      s.setContextMenu(null);
      return false;
    }
    if (s.mode === 'edit' && s.selectedIds.length > 1 && s.selectedIds.includes(obj.id)) {
      s.setContextMenu({ objectId: obj.id, x: screen.x, y: screen.y, multi: true });
      return true;
    }
    // Play mode: objects without anything to do in a game (e.g. boards) get no menu.
    if (s.mode === 'play' && !hasObjectControls(obj) && getObjectActions(obj, 'play', currentTable()).length === 0) {
      s.setContextMenu(null);
      return false;
    }
    if (!obj.locked || s.mode === 'edit') s.select(obj.id);
    s.setContextMenu({ objectId: obj.id, x: screen.x, y: screen.y });
    return true;
  }, []);

  // Touch screens: two fingers pinch-zoom and pan the table, a long-press opens the object menu.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const local = (p: Vec2): Vec2 => {
      const r = el.getBoundingClientRect();
      return { x: p.x - r.left, y: p.y - r.top };
    };
    const pinchPoint = (): Pinch => {
      const [a, b] = [...touches.current.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), center: local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) };
    };
    const cancelLongPress = () => {
      if (!longPress.current) return;
      clearTimeout(longPress.current.timer);
      longPress.current = null;
    };
    const onLongPress = (start: Vec2) => {
      longPress.current = null;
      const stage = stageRef.current;
      const s = useTableStore.getState();
      if (!stage || touches.current.size !== 1 || s.draggingId || s.tool !== 'select' || s.editingText) return;
      const screen = local(start);
      const target = stage.getIntersection(screen) ?? stage;
      // A held card with "Zoom on hover" (its own or its deck's), loose or in a holder / pile, shows enlarged until the
      // finger lifts, instead of the menu (the action bar's ⋯ still opens it).
      const node = findObjectNode(target);
      const held = node ? currentTable().objects.find((o) => o.id === node.id()) : undefined;
      const world = screenToWorld(s.camera, screen);
      const preview = !s.picking && held ? pressPreviewOf(currentTable(), held, world) : null;
      if (preview) {
        cancelGesture();
        suppressTaps();
        s.setContextMenu(null);
        s.setPressPreview(preview.id, preview.cardId);
        return;
      }
      if (!openMenuAt(target, screen)) return;
      cancelGesture();
      suppressTaps();
    };
    const down = (e: PointerEvent) => {
      // Only touches on the table itself; overlays (action bar, menus, text editor) handle their own.
      if (e.pointerType !== 'touch' || !(e.target instanceof HTMLCanvasElement)) return;
      // A resting finger must not start a drag before it can long-press.
      if (Konva.dragDistance < TOUCH_DRAG_DISTANCE) Konva.dragDistance = TOUCH_DRAG_DISTANCE;
      if (touches.current.size === 0) allowTaps();
      // The canvas suppresses the browser's default focus change, so commit an open text field explicitly.
      closedEditor.current = !!useTableStore.getState().editingText;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches('input, textarea, select')) active.blur();
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cancelLongPress();
      if (touches.current.size === 1) {
        const start = { x: e.clientX, y: e.clientY };
        longPress.current = { start, timer: window.setTimeout(() => onLongPress(start), LONG_PRESS_MS) };
        return;
      }
      if (touches.current.size === 2) {
        // A second finger turns whatever the first one started into a pinch.
        cancelGesture();
        suppressTaps();
        stageRef.current?.find('.object').forEach((n) => {
          if (n.isDragging()) n.stopDrag();
        });
        pinch.current = pinchPoint();
      }
    };
    const move = (e: PointerEvent) => {
      if (!touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const lp = longPress.current;
      if (lp && Math.hypot(e.clientX - lp.start.x, e.clientY - lp.start.y) > LONG_PRESS_SLOP) cancelLongPress();
      const from = pinch.current;
      if (!from || touches.current.size < 2) return;
      const to = pinchPoint();
      const s = useTableStore.getState();
      s.setCamera(pinchBy(s.camera, from, to));
      pinch.current = to;
    };
    const up = (e: PointerEvent) => {
      if (!touches.current.delete(e.pointerId)) return;
      cancelLongPress();
      if (touches.current.size === 0) useTableStore.getState().setPressPreview(null);
      pinch.current = touches.current.size >= 2 ? pinchPoint() : null;
    };
    // Stops compatibility mouse events, the iOS callout and double-tap zoom on the table (Konva does this for shapes).
    const noNative = (e: TouchEvent) => {
      if (e.target instanceof HTMLCanvasElement && e.cancelable) e.preventDefault();
    };
    el.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    el.addEventListener('touchstart', noNative, { passive: false });
    return () => {
      cancelLongPress();
      el.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      el.removeEventListener('touchstart', noNative);
    };
  }, [openMenuAt, cancelGesture]);

  const onContextMenu = (e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    // Touch screens open the menu with our own long-press (iOS never sends contextmenu).
    if (touches.current.size > 0) return;
    const screen = stageRef.current?.getPointerPosition();
    if (screen) openMenuAt(e.target, screen);
    else useTableStore.getState().setContextMenu(null);
  };

  const onPointerMove = () => {
    const stage = stageRef.current;
    if (!stage || pinch.current) return;
    const s = useTableStore.getState();
    const world = stage.getRelativePointerPosition();
    const screen = stage.getPointerPosition();
    if (s.tool === 'eraser' && world && eraserRef.current) {
      eraserRef.current.position(world);
      eraserRef.current.radius(s.eraserRadius / s.camera.scale);
      eraserRef.current.visible(true);
      eraserRef.current.getLayer()?.batchDraw();
    }
    const g = gesture.current;
    if (!g || !world || !screen) return;
    switch (g.kind) {
      case 'pan': {
        const dx = screen.x - g.last.x;
        const dy = screen.y - g.last.y;
        g.last = screen;
        if (!g.moved && Math.hypot(screen.x - g.start.x, screen.y - g.start.y) > CLICK_SLOP) {
          g.moved = true;
          if (g.canMove) setPanning(true);
        }
        if (g.canMove && g.moved && (dx || dy)) s.setCamera(panBy(s.camera, dx, dy));
        break;
      }
      case 'pen': {
        const n = g.points.length;
        if (Math.hypot(world.x - g.points[n - 2], world.y - g.points[n - 1]) * s.camera.scale < 1) return;
        g.points.push(world.x, world.y);
        liveLineRef.current?.points(g.points);
        liveLineRef.current?.getLayer()?.batchDraw();
        break;
      }
      case 'erase':
        eraseAt(world, g);
        break;
      case 'marquee': {
        if (!g.moved && Math.hypot(screen.x - g.start.x, screen.y - g.start.y) <= CLICK_SLOP) return;
        g.moved = true;
        const r = marqueeRef.current;
        if (!r) return;
        r.setAttrs({
          x: Math.min(g.startWorld.x, world.x),
          y: Math.min(g.startWorld.y, world.y),
          width: Math.abs(world.x - g.startWorld.x),
          height: Math.abs(world.y - g.startWorld.y),
          dash: [6 / s.camera.scale, 4 / s.camera.scale],
          visible: true,
        });
        r.getLayer()?.batchDraw();
        break;
      }
      case 'group': {
        if (Math.hypot(screen.x - g.start.x, screen.y - g.start.y) < DECK_DRAG_SLOP) return;
        gesture.current = null;
        stageRef.current?.findOne((n: Konva.Node) => n.id() === g.id && n.hasName('object'))?.startDrag();
        break;
      }
      case 'deck': {
        if (Math.hypot(screen.x - g.start.x, screen.y - g.start.y) < DECK_DRAG_SLOP) return;
        const deck = currentTable().objects.find((o) => o.id === g.deckId);
        gesture.current = null;
        if (deck?.kind !== 'deck') return;
        let cmd: Command | null = null;
        if (g.index === 'all') {
          cmd = takeStackCommand(currentTable().objects, deck, world);
        } else if (deck.cards[g.index]) {
          const def = deck.cards[g.index];
          const look = resolveCardLook(def, deck, ownerDeckOf(currentTable().objects, def.id));
          cmd = drawCardCommand(deck, { x: Math.round(world.x - look.width / 2), y: Math.round(world.y - look.height / 2) }, g.index);
        }
        // Hand the pointer over to the new card or pile.
        const createdId = cmd?.type === 'DrawCard' ? cmd.cardId : cmd?.type === 'TakeStack' ? cmd.pileId : null;
        if (cmd && createdId) {
          pendingDragId.current = createdId;
          s.dispatch(cmd);
          s.select(createdId);
        }
        break;
      }
      case 'bag': {
        if (Math.hypot(screen.x - g.start.x, screen.y - g.start.y) < DECK_DRAG_SLOP) return;
        const bag = currentTable().objects.find((o) => o.id === g.id);
        gesture.current = null;
        const cmd = bag?.kind === 'bag' ? drawRandomFromBagCommand(bag, world) : null;
        // Hand the pointer over to the piece taken out of the bag.
        if (cmd?.type === 'BagDraw') {
          const outId = cmd.newId;
          pendingDragId.current = outId;
          s.dispatch(cmd);
          // A last token / a whole entry comes out under its own id, a token from a stack under the new one.
          if (!currentTable().objects.some((o) => o.id === outId)) pendingDragId.current = cmd.itemId;
          s.select(pendingDragId.current);
        }
        break;
      }
      case 'token': {
        if (Math.hypot(screen.x - g.start.x, screen.y - g.start.y) < DECK_DRAG_SLOP) return;
        const token = currentTable().objects.find((o) => o.id === g.id);
        gesture.current = null;
        const cmd = token?.kind === 'token' ? splitTokensCommand(token, 1, world) : null;
        // Hand the pointer over to the token taken off the stack.
        if (cmd?.type === 'SplitTokens') {
          pendingDragId.current = cmd.newId;
          s.dispatch(cmd);
          s.select(cmd.newId);
        }
        break;
      }
    }
  };

  /** A click (mouse) or a tap (touch) on the table. `additive` = Ctrl/Cmd/Shift held. */
  const handleClick = (target: Konva.Node, additive: boolean, touch: boolean) => {
    const stage = stageRef.current;
    const s = useTableStore.getState();
    if (s.tool === 'select') {
      // Konva emits no click after a node drag; camera pans and selection boxes are excluded here.
      const g = gesture.current ?? lastGesture.current;
      const node = findObjectNode(target);
      if (s.picking) {
        if (node && !((g?.kind === 'pan' || g?.kind === 'marquee') && g.moved)) pickOnTable([node.id()], 'toggle');
        return;
      }
      if (!node || ((g?.kind === 'pan' || g?.kind === 'marquee') && g.moved) || isUiButton(target)) return;
      const id = node.id();
      // Play-mode buttons and checkboxes just react to the click (see ObjectNode); they don't get a selection bar.
      const clickedKind = currentTable().objects.find((o) => o.id === id)?.kind;
      if (s.mode === 'play' && (clickedKind === 'button' || clickedKind === 'checkbox')) return;
      if (s.mode === 'edit' && additive) {
        s.toggleSelected(id);
        const after = useTableStore.getState();
        after.setSelectionBar(after.selectedIds.length > 1 ? MULTI_BAR : after.selectedId);
        return;
      }
      // A plain click on a member of a multi-selection selects just that object.
      if (s.selectedIds.length > 1 && s.selectedIds.includes(id)) s.select(id);
      s.setSelectionBar(id);
      return;
    }
    if (s.tool !== 'text' || !stage) return;
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (target.hasName('text-annotation')) {
      const t = currentTable().annotations.text.find((a) => a.id === target.id());
      if (t) startEditingText(t, touch);
      return;
    }
    const world = stage.getRelativePointerPosition();
    if (!world) return;
    const open = () =>
      s.setEditingText({
        position: { x: Math.round(world.x), y: Math.round(world.y - s.textStyle.fontSize * 0.6) },
        text: '',
        fontSize: s.textStyle.fontSize,
        color: s.textStyle.color,
      });
    if (!touch) return open();
    // Mobile browsers only show the keyboard when the field is focused while the tap is being handled.
    flushSync(open);
    focusTextEditor();
  };

  const onClick = (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    handleClick(e.target, e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey, false);
  };

  const onTap = (e: KonvaEventObject<TouchEvent>) => {
    if (tapsSuppressed()) return;
    handleClick(e.target, false, true);
  };

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const s = useTableStore.getState();
    const unit = e.evt.deltaMode === 1 ? 16 : e.evt.deltaMode === 2 ? 400 : 1;
    const dy = e.evt.deltaY * unit;
    const k = e.evt.ctrlKey ? 0.01 : 0.0015;
    const factor = Math.exp(-Math.max(-300, Math.min(300, dy)) * k);
    s.setCamera(zoomBy(s.camera, pointer, factor));
  };

  const onTransformEnd = () => {
    const tr = trRef.current;
    if (!tr) return;
    const commands: Command[] = [];
    for (const node of tr.nodes()) {
      const o = currentTable().objects.find((x) => x.id === node.id());
      if (!o) continue;
      const width = Math.max(4, Math.round(o.width * node.scaleX()));
      const height = Math.max(4, Math.round(o.height * node.scaleY()));
      const center = node.position();
      node.scale({ x: 1, y: 1 });
      commands.push({
        type: 'TransformObject',
        id: o.id,
        position: { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) },
        width,
        height,
        rotation: Math.round(node.rotation() * 10) / 10,
      });
    }
    if (commands.length) useTableStore.getState().dispatch(commands.length === 1 ? commands[0] : { type: 'Batch', commands });
  };

  const cursorClass = panning ? 'is-panning' : spaceHeld ? 'tool-pan' : picking ? 'is-picking' : `tool-${tool}`;

  return (
    <div
      ref={containerRef}
      className={`canvas-container ${cursorClass}`}
      data-testid="table-canvas"
      style={tableColor ? { background: tableColor } : undefined}
      onContextMenu={(e) => e.preventDefault()}
      onPointerLeave={() => {
        eraserRef.current?.visible(false);
        eraserRef.current?.getLayer()?.batchDraw();
        useTableStore.getState().setHover(null);
      }}
    >
      {viewport.width > 0 && (
        <Stage
          ref={setStageRef}
          width={viewport.width}
          height={viewport.height}
          x={camera.x}
          y={camera.y}
          scaleX={camera.scale}
          scaleY={camera.scale}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onClick={onClick}
          onTap={onTap}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
        >
          {mode === 'edit' && showGrid && (
            <Layer name="grid-layer" listening={false}>
              <Grid camera={camera} width={viewport.width} height={viewport.height} light={isLightColor(tableColor)} />
            </Layer>
          )}
          <Layer>
            {sorted.map((o) => (
              <ObjectNode
                key={o.id}
                object={o}
                mode={mode}
                draggable={isDraggable(o)}
                dropTarget={o.id === dropTargetId}
                picked={pickedSet.has(o.id)}
                focused={automationsOpen && o.id === selectedId}
              />
            ))}
            <Transformer
              ref={trRef}
              visible={showTransformer}
              resizeEnabled={mode === 'edit'}
              rotateEnabled={mode === 'edit'}
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              rotationSnapTolerance={6}
              keepRatio={transformable.length > 1 || (!!selected && KEEP_RATIO_KINDS.has(selected.kind))}
              flipEnabled={false}
              ignoreStroke
              anchorSize={COARSE_POINTER ? 14 : 9}
              borderStroke="#2684ff"
              anchorStroke="#2684ff"
              boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox)}
              onTransformEnd={onTransformEnd}
            />
            <FlashOutline />
          </Layer>
          <Layer>
            <AnnotationLayer
              annotations={annotations}
              hiddenIds={hiddenIds}
              editingId={editingId}
              textDraggable={tool === 'select' && !spaceHeld && !picking}
            />
            <Line
              ref={liveLineRef}
              points={[]}
              stroke={pen.color}
              strokeWidth={pen.width}
              opacity={pen.opacity}
              lineCap="round"
              lineJoin="round"
              tension={0.35}
              listening={false}
            />
            <Circle
              ref={eraserRef}
              visible={false}
              radius={10}
              stroke="#111"
              strokeWidth={1}
              dash={[3, 3]}
              strokeScaleEnabled={false}
              fill="rgba(255,255,255,0.35)"
              listening={false}
            />
            <Rect
              ref={marqueeRef}
              name="selection-box"
              visible={false}
              stroke="#2684ff"
              strokeWidth={1}
              strokeScaleEnabled={false}
              fill="rgba(38,132,255,0.12)"
              listening={false}
            />
          </Layer>
        </Stage>
      )}
      <TextEditorOverlay />
      <SelectionBar />
      <ContextMenu />
      <HoverPreview />
    </div>
  );
}
