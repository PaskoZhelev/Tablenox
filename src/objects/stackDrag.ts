let pending = false;

/**
 * Marks the next group drag as moving a piece stack by its count badge (or clears that): once it lands, only the
 * stack's top piece stays selected, so pressing the stack again takes its top piece off instead of moving them all.
 */
export function markStackDrag(on: boolean): void {
  pending = on;
}

/** Whether the group drag that is starting moves a piece stack by its badge (and clears the mark). */
export function takeStackDrag(): boolean {
  const was = pending;
  pending = false;
  return was;
}
