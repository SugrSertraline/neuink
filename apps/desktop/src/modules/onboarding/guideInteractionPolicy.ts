export type GuideInteractionPolicy = {
  mode: 'observe' | 'read' | 'practice';
  /** The few real controls permitted in an otherwise observational lesson. */
  actionTarget?: string;
  scroll?: boolean;
  contextMenuOnly?: string;
  popupActionTarget?: string;
};

export const OBSERVE_GUIDE: GuideInteractionPolicy = { mode:'observe' };
export const PRACTICE_GUIDE: GuideInteractionPolicy = { mode:'practice' };

const hover = new Set(['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove']);
const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const press = new Set(['pointerdown', 'mousedown', 'touchstart']);
const interactive = 'button, a, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"]';

/** Explicit lesson metadata, never inferred from instruction text or keywords. */
export function permitsGuideEvent(event: Event, policy: GuideInteractionPolicy, root: HTMLElement, popup = false) {
  if (hover.has(event.type)) return true;
  const node = event.target instanceof Element ? event.target : null;
  const actionSelector = popup ? policy.popupActionTarget : policy.actionTarget;
  const action = actionSelector ? node?.closest(actionSelector) : null;
  const onAction = Boolean(action && root.contains(action));
  const mode = popup && (policy.mode !== 'practice' || policy.popupActionTarget) ? 'read' : policy.mode;
  if (event.type === 'wheel' || event.type === 'touchmove') {
    if (event instanceof WheelEvent && (event.ctrlKey || event.metaKey) && mode !== 'practice') return false;
    return popup || (policy.scroll ?? mode !== 'observe');
  }
  if (event instanceof KeyboardEvent && scrollKeys.has(event.key)
    && !event.ctrlKey && !event.metaKey && !(onAction && event.key === ' ')
    && (event.key !== ' ' || !node?.closest(interactive))) return popup || (policy.scroll ?? mode !== 'observe');
  if (mode === 'practice' && (popup || !policy.contextMenuOnly)) return true;
  if (onAction) {
    if (event instanceof KeyboardEvent) return event.key === 'Enter' || event.key === ' ';
    return ['pointerdown', 'mousedown', 'touchstart', 'click', 'focus', 'focusin'].includes(event.type)
      && (!(event instanceof MouseEvent) || event.button === 0);
  }
  if (mode === 'practice') {
    // Opening the tab menu is a practice; closing or dragging the tab is not.
    const tab = policy.contextMenuOnly && node?.closest(policy.contextMenuOnly);
    if (!tab || !root.contains(tab)) return false;
    return event.type === 'contextmenu' || event.type === 'focus' || event.type === 'focusin'
      || (event instanceof MouseEvent && event.button === 2 && press.has(event.type))
      || (event instanceof KeyboardEvent && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')));
  }
  if (event.type === 'focus' || event.type === 'focusin') return !node?.closest('input, select, textarea, [contenteditable="true"]');
  // Reading screenshots/previews permits selecting and copying text, not opening
  // a different page or invoking the real editor from an automatic demonstration.
  if (mode === 'read' && press.has(event.type)) return !node?.closest(interactive);
  return mode === 'read' && event instanceof KeyboardEvent && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c';
}
