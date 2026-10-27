/**
 * Touch gesture state shared by the canvas and the object nodes. After a pinch or a long-press the lifted fingers
 * must not also count as a tap (which would run a button, flip a card or open the action bar).
 */
let suppressed = false;

export function suppressTaps(): void {
  suppressed = true;
}

/** Called when a new touch sequence starts (the first finger goes down). */
export function allowTaps(): void {
  suppressed = false;
}

export function tapsSuppressed(): boolean {
  return suppressed;
}

/** Long-press duration that opens the object menu on touch screens. */
export const LONG_PRESS_MS = 500;
/** A finger that moves further than this (px) is dragging, not long-pressing. */
export const LONG_PRESS_SLOP = 10;
/** Konva drag threshold for touch, so a resting finger can long-press without starting a drag. */
export const TOUCH_DRAG_DISTANCE = 6;
