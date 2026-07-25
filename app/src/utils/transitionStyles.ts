/**
 * WLED v16 transition styles (`bs` / TRANSITION_*).
 * Mirrors firmware MbRuleEngine.cpp blendingStyleFromTypeString exactly.
 * Keep in sync if WLED's TRANSITION_* values ever change.
 */

export const TRANSITION_STYLE_TO_BS: Record<string, number> = {
  instant: 0x00,
  fairyDust: 0x01,
  swipeRight: 0x02,
  swipeLeft: 0x03,
  outsideIn: 0x04,
  insideOut: 0x05,
  swipeUp: 0x06,
  swipeDown: 0x07,
  openH: 0x08,
  openV: 0x09,
  swipeTL: 0x0A,
  swipeTR: 0x0B,
  swipeBR: 0x0C,
  swipeBL: 0x0D,
  circularOut: 0x0E,
  circularIn: 0x0F,
  pushRight: 0x10,
  pushLeft: 0x11,
  pushUp: 0x12,
  pushDown: 0x13,
  pushTL: 0x14,
  pushTR: 0x15,
  pushBR: 0x16,
  pushBL: 0x17,
};

export type TransitionStyle = keyof typeof TRANSITION_STYLE_TO_BS;

/** UI labels — same vocabulary as the web rule editor's stop/start transitions. */
export const TRANSITION_STYLES: { value: TransitionStyle; label: string }[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'fairyDust', label: 'Fairy Dust' },
  { value: 'swipeRight', label: 'Swipe right' },
  { value: 'swipeLeft', label: 'Swipe left' },
  { value: 'outsideIn', label: 'Outside-in' },
  { value: 'insideOut', label: 'Inside-out' },
  { value: 'swipeUp', label: 'Swipe up (2D)' },
  { value: 'swipeDown', label: 'Swipe down (2D)' },
  { value: 'openH', label: 'Open horizontal (2D)' },
  { value: 'openV', label: 'Open vertical (2D)' },
  { value: 'swipeTL', label: 'Swipe TL (2D)' },
  { value: 'swipeTR', label: 'Swipe TR (2D)' },
  { value: 'swipeBR', label: 'Swipe BR (2D)' },
  { value: 'swipeBL', label: 'Swipe BL (2D)' },
  { value: 'circularOut', label: 'Circular out (2D)' },
  { value: 'circularIn', label: 'Circular in (2D)' },
  { value: 'pushRight', label: 'Push right' },
  { value: 'pushLeft', label: 'Push left' },
  { value: 'pushUp', label: 'Push up (2D)' },
  { value: 'pushDown', label: 'Push down (2D)' },
  { value: 'pushTL', label: 'Push TL (2D)' },
  { value: 'pushTR', label: 'Push TR (2D)' },
  { value: 'pushBR', label: 'Push BR (2D)' },
  { value: 'pushBL', label: 'Push BL (2D)' },
];

export const KNOWN_TRANSITION_STYLES = new Set<string>(
  Object.keys(TRANSITION_STYLE_TO_BS),
);

export function transitionStyleLabel(style: string | null | undefined): string {
  if (style == null || style === '') return 'Use default';
  return TRANSITION_STYLES.find((t) => t.value === style)?.label ?? style;
}
