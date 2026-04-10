const EDITABLE_SELECTOR =
  "input:not([type='button']):not([type='checkbox']):not([type='radio']):not([type='file']):not([type='submit']):not([type='reset']), textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']";

const KEYBOARD_OPEN_THRESHOLD = 80;
const FIELD_TOP_MARGIN = 12;
const FIELD_BOTTOM_MARGIN = 24;

let focusedEditable: HTMLElement | null = null;
let stableLayoutViewportHeight = 0;
let stableViewportHeight = 0;
let keyboardInset = 0;
let ensureVisibleTimeout = 0;
let isBootstrapped = false;

export function measureKeyboardInset(
  stableHeight: number,
  viewportHeight: number,
  viewportOffsetTop = 0,
  layoutViewportDelta = 0,
) {
  return Math.max(
    0,
    Math.round(stableHeight - viewportHeight - viewportOffsetTop - layoutViewportDelta),
  );
}

export function computeFocusScrollDelta(
  elementTop: number,
  elementBottom: number,
  viewportTop: number,
  viewportHeight: number,
  safeTop = 0,
) {
  const minVisibleTop = viewportTop + FIELD_TOP_MARGIN + safeTop;
  const maxVisibleBottom = viewportTop + viewportHeight - FIELD_BOTTOM_MARGIN;

  if (elementBottom > maxVisibleBottom) {
    return Math.ceil(elementBottom - maxVisibleBottom);
  }

  if (elementTop < minVisibleTop) {
    return Math.floor(elementTop - minVisibleTop);
  }

  return 0;
}

function isEditableElement(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target.matches(EDITABLE_SELECTOR);
}

function getViewportMetrics() {
  const visualViewport = window.visualViewport;

  return {
    height: visualViewport?.height ?? window.innerHeight,
    top: visualViewport?.offsetTop ?? 0,
  };
}

function setKeyboardInset(nextInset: number) {
  keyboardInset = nextInset >= KEYBOARD_OPEN_THRESHOLD ? nextInset : 0;
  document.documentElement.style.setProperty("--app-keyboard-inset", `${keyboardInset}px`);
}

function updateStableViewportHeight(force = false) {
  const { height } = getViewportMetrics();
  const layoutHeight = window.innerHeight;

  if (force || !focusedEditable || keyboardInset === 0) {
    stableViewportHeight = Math.round(height);
    stableLayoutViewportHeight = Math.round(layoutHeight);
  }
}

function ensureFocusedFieldVisible() {
  if (!focusedEditable) {
    return;
  }

  const { height, top } = getViewportMetrics();
  const inputRect = focusedEditable.getBoundingClientRect();
  const fieldRect = focusedEditable.closest(".field")?.getBoundingClientRect();
  const safeTop = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--app-safe-top") || "0",
  );
  const elementTop = fieldRect?.top ?? inputRect.top;
  const elementBottom = inputRect.bottom;
  const delta = computeFocusScrollDelta(elementTop, elementBottom, top, height, safeTop);

  if (Math.abs(delta) < 6) {
    return;
  }

  const scrollingElement = document.scrollingElement ?? document.documentElement;
  const currentTop = scrollingElement.scrollTop;
  const nextTop = Math.max(0, currentTop + delta);

  window.scrollTo({
    top: nextTop,
    behavior: "auto",
  });
}

function scheduleEnsureVisible(delay = 120) {
  if (ensureVisibleTimeout) {
    window.clearTimeout(ensureVisibleTimeout);
  }

  ensureVisibleTimeout = window.setTimeout(() => {
    ensureVisibleTimeout = 0;
    ensureFocusedFieldVisible();
  }, delay);
}

function syncKeyboardViewport() {
  const { height, top } = getViewportMetrics();
  const layoutHeight = Math.round(window.innerHeight);
  const previousInset = keyboardInset;

  if (!stableViewportHeight) {
    stableViewportHeight = Math.round(height);
  }

  if (!stableLayoutViewportHeight) {
    stableLayoutViewportHeight = layoutHeight;
  }

  const layoutViewportDelta = Math.max(0, stableLayoutViewportHeight - layoutHeight);

  setKeyboardInset(
    focusedEditable ? measureKeyboardInset(stableViewportHeight, height, top, layoutViewportDelta) : 0,
  );

  if (focusedEditable && keyboardInset > 0) {
    scheduleEnsureVisible(previousInset === keyboardInset ? 120 : 180);
  } else if (keyboardInset === 0) {
    updateStableViewportHeight(true);
  }
}

function handleFocusIn(event: FocusEvent) {
  if (!isEditableElement(event.target)) {
    return;
  }

  focusedEditable = event.target;
  syncKeyboardViewport();
  scheduleEnsureVisible(140);
}

function handleFocusOut() {
  window.setTimeout(() => {
    const activeElement = document.activeElement;

    if (isEditableElement(activeElement)) {
      focusedEditable = activeElement;
      syncKeyboardViewport();
      return;
    }

    focusedEditable = null;
    if (ensureVisibleTimeout) {
      window.clearTimeout(ensureVisibleTimeout);
      ensureVisibleTimeout = 0;
    }
    setKeyboardInset(0);
    updateStableViewportHeight(true);
  }, 80);
}

function handleViewportChange() {
  syncKeyboardViewport();
}

export function bootstrapMobileViewport() {
  if (typeof window === "undefined" || isBootstrapped) {
    return;
  }

  isBootstrapped = true;
  updateStableViewportHeight(true);
  setKeyboardInset(0);

  document.addEventListener("focusin", handleFocusIn);
  document.addEventListener("focusout", handleFocusOut);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("orientationchange", () => {
    updateStableViewportHeight(true);
    syncKeyboardViewport();
  });
  window.visualViewport?.addEventListener("resize", handleViewportChange);
  window.visualViewport?.addEventListener("scroll", handleViewportChange);
}
