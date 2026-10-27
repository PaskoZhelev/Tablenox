const DOUBLE_CLICK_MS = 400;

/**
 * Primary-button double-click detection. Konva's own dblclick also fires for left+right click pairs,
 * which caused accidental draws/rolls when opening the context menu.
 */
let lastPrimaryClick: { id: string; at: number } | null = null;

export function registerPrimaryClick(id: string): boolean {
  const now = performance.now();
  const isDouble = !!lastPrimaryClick && lastPrimaryClick.id === id && now - lastPrimaryClick.at < DOUBLE_CLICK_MS;
  lastPrimaryClick = isDouble ? null : { id, at: now };
  return isDouble;
}

export function resetDoubleClick(): void {
  lastPrimaryClick = null;
}
