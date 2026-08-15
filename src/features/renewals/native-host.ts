export const NATIVE_RENEW_BUTTON_SELECTOR =
  '.o_form_view button[name="prepare_renewal_order"][type="object"]';

export interface RenewalButtonHost {
  host: HTMLSpanElement;
  shadow: ShadowRoot;
  container: HTMLSpanElement;
  sourceButton: HTMLButtonElement;
  detach: () => void;
}

const RENEWAL_HOST_STYLES = `
:host {
  box-sizing: border-box;
  inline-size: 0;
  min-inline-size: 0;
  isolation: isolate;
  overflow: hidden;
  animation: ohe-renewal-caret-expand 180ms cubic-bezier(.2, .8, .2, 1) 20ms both;
}

.ohe-renewal-caret-button {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background-clip: padding-box !important;
  color: var(--renew-button-color, inherit) !important;
  background: var(--renew-button-background, transparent) !important;
  border-color: var(--renew-button-border-color, currentColor) !important;
  box-shadow: var(--renew-button-box-shadow, none) !important;
  filter: var(--renew-button-filter, none) !important;
  transform: var(--renew-button-transform, none) !important;
}

.ohe-renewal-caret-button::before {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 1px;
  z-index: 1;
  pointer-events: none;
  content: "";
  background: var(--renew-button-separator-color, currentColor);
  opacity: .42;
}

.ohe-renewal-caret-button:hover:not(:disabled),
.ohe-renewal-caret-button:focus-visible:not(:disabled) {
  color: var(--renew-button-hover-color, var(--renew-button-color, inherit)) !important;
  background: var(
    --renew-button-hover-background,
    var(--renew-button-background, transparent)
  ) !important;
  border-color: var(
    --renew-button-hover-border-color,
    var(--renew-button-border-color, currentColor)
  ) !important;
  box-shadow: var(
    --renew-button-hover-box-shadow,
    var(--renew-button-box-shadow, none)
  ) !important;
  filter: var(--renew-button-hover-filter, var(--renew-button-filter, none)) !important;
  transform: var(
    --renew-button-hover-transform,
    var(--renew-button-transform, none)
  ) !important;
}

.ohe-renewal-caret-button:active:not(:disabled) {
  color: var(--renew-button-active-color, var(--renew-button-color, inherit)) !important;
  background: var(
    --renew-button-active-background,
    var(--renew-button-background, transparent)
  ) !important;
  border-color: var(
    --renew-button-active-border-color,
    var(--renew-button-border-color, currentColor)
  ) !important;
  box-shadow: var(
    --renew-button-active-box-shadow,
    var(--renew-button-box-shadow, none)
  ) !important;
  filter: var(--renew-button-active-filter, var(--renew-button-filter, none)) !important;
  transform: var(
    --renew-button-active-transform,
    var(--renew-button-transform, none)
  ) !important;
}

@keyframes ohe-renewal-caret-expand {
  from { inline-size: 0; }
  to { inline-size: var(--renew-button-caret-width, 32px); }
}

@media (prefers-reduced-motion: reduce) {
  :host {
    inline-size: var(--renew-button-caret-width, 32px);
    animation: none;
  }
}
`;

const SPLIT_BUTTON_PROPERTIES = [
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-start-end-radius',
  'border-end-end-radius',
  'border-right-width',
  'border-inline-end-width',
  'margin-inline-end',
] as const;

interface InlineStyleValue {
  value: string;
  priority: string;
}

interface SplitButtonSnapshot {
  originalMarker: string | null;
  styles: Record<string, InlineStyleValue>;
}

const SPLIT_SNAPSHOT_ATTRIBUTE = 'data-ohe-renewal-split-snapshot';
const MAX_SNAPSHOT_LENGTH = 4_096;
const MAX_STYLE_VALUE_LENGTH = 256;

const hostDetachers = new WeakMap<HTMLElement, () => void>();

function readSplitButtonSnapshot(button: HTMLButtonElement): SplitButtonSnapshot | null {
  const serialized = button.getAttribute(SPLIT_SNAPSHOT_ATTRIBUTE);
  if (!serialized || serialized.length > MAX_SNAPSHOT_LENGTH) return null;

  try {
    const candidate = JSON.parse(serialized) as unknown;
    if (!candidate || typeof candidate !== 'object') return null;
    const record = candidate as Record<string, unknown>;
    if (record.originalMarker !== null && typeof record.originalMarker !== 'string') return null;
    if (!record.styles || typeof record.styles !== 'object') return null;

    const styles: Record<string, InlineStyleValue> = {};
    for (const property of SPLIT_BUTTON_PROPERTIES) {
      const raw = (record.styles as Record<string, unknown>)[property];
      if (!raw || typeof raw !== 'object') return null;
      const value = (raw as Record<string, unknown>).value;
      const priority = (raw as Record<string, unknown>).priority;
      if (
        typeof value !== 'string' ||
        value.length > MAX_STYLE_VALUE_LENGTH ||
        (priority !== '' && priority !== 'important')
      ) {
        return null;
      }
      styles[property] = { value, priority };
    }
    return { originalMarker: record.originalMarker as string | null, styles };
  } catch {
    return null;
  }
}

function restoreInlineStyles(
  button: HTMLButtonElement,
  styles: Readonly<Record<string, InlineStyleValue>>,
): void {
  for (const property of SPLIT_BUTTON_PROPERTIES) {
    const original = styles[property];
    if (original?.value) {
      button.style.setProperty(property, original.value, original.priority);
    } else {
      button.style.removeProperty(property);
    }
  }
}

function restoreMarker(button: HTMLButtonElement, originalMarker: string | null): void {
  if (originalMarker === null) button.removeAttribute('data-ohe-renewal-split-source');
  else button.setAttribute('data-ohe-renewal-split-source', originalMarker);
}

/**
 * Repairs a split button left behind by an older content-script context before
 * reading any styles for the next host. The persisted snapshot is bounded and
 * contains CSS values only. The fallback handles hosts created before snapshots
 * existed without treating our forced zeroes as native values.
 */
function restoreOrphanedSplitButton(
  button: HTMLButtonElement,
  orphanHost: HTMLElement | null,
): void {
  if (button.getAttribute('data-ohe-renewal-split-source') !== 'true') return;

  const snapshot = readSplitButtonSnapshot(button);
  if (snapshot) {
    restoreInlineStyles(button, snapshot.styles);
    restoreMarker(button, snapshot.originalMarker);
  } else {
    const topRadius = orphanHost?.style.getPropertyValue('--renew-button-radius-top-right');
    const bottomRadius = orphanHost?.style.getPropertyValue('--renew-button-radius-bottom-right');
    const endMargin = orphanHost?.style.marginInlineEnd;
    button.style.removeProperty('border-start-end-radius');
    button.style.removeProperty('border-end-end-radius');
    button.style.removeProperty('border-right-width');
    button.style.removeProperty('border-inline-end-width');
    if (topRadius) button.style.setProperty('border-top-right-radius', topRadius);
    else button.style.removeProperty('border-top-right-radius');
    if (bottomRadius) button.style.setProperty('border-bottom-right-radius', bottomRadius);
    else button.style.removeProperty('border-bottom-right-radius');
    if (endMargin) button.style.setProperty('margin-inline-end', endMargin);
    else button.style.removeProperty('margin-inline-end');
    button.removeAttribute('data-ohe-renewal-split-source');
  }
  button.removeAttribute(SPLIT_SNAPSHOT_ATTRIBUTE);
}

function isVisibleButton(button: HTMLButtonElement): boolean {
  if (!button.isConnected || button.hidden || button.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  const view = button.ownerDocument.defaultView;
  const style = view?.getComputedStyle(button);
  if (style?.display === 'none' || style?.visibility === 'hidden') return false;

  const bounds = button.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

/**
 * Resolves the technical Odoo button and fails closed if the rendered form is
 * ambiguous. The translated label is deliberately never used as a selector.
 */
export function findNativeRenewButton(root: ParentNode = document): HTMLButtonElement | null {
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>(NATIVE_RENEW_BUTTON_SELECTOR),
  ).filter(isVisibleButton);
  return buttons.length === 1 ? buttons[0]! : null;
}

function mirrorNativeButtonStyle(host: HTMLSpanElement, button: HTMLButtonElement): void {
  const view = button.ownerDocument.defaultView;
  const style = view?.getComputedStyle(button);
  const bounds = button.getBoundingClientRect();
  if (!style) return;

  const resting = readComputedVisualStyle(style);
  const hoverBackground = readFirstCustomProperty(style, ['--bs-btn-hover-bg', '--btn-hover-bg']);
  const hoverColor = readFirstCustomProperty(style, ['--bs-btn-hover-color', '--btn-hover-color']);
  const hoverBorderColor = readFirstCustomProperty(style, [
    '--bs-btn-hover-border-color',
    '--btn-hover-border-color',
  ]);
  const hoverFilter = readFirstCustomProperty(style, [
    '--bs-btn-hover-filter',
    '--btn-hover-filter',
  ]);
  const hasExplicitHoverFill = Boolean(hoverBackground || hoverFilter);
  writeMirroredVisualStyle(host, '', resting);
  // Odoo button borders can be transparent or match the fill. The foreground
  // color gives the two independently-hoverable halves a stable seam in both
  // themes without coupling either half's hover state to the other one.
  host.style.setProperty('--renew-button-separator-color', resting.color);
  writeMirroredVisualStyle(host, 'hover-', {
    ...resting,
    background: hoverBackground ?? resting.background,
    color: hoverColor ?? resting.color,
    borderColor: hoverBorderColor ?? resting.borderColor,
    boxShadow:
      readFirstCustomProperty(style, ['--bs-btn-hover-box-shadow', '--btn-hover-box-shadow']) ??
      resting.boxShadow,
    filter:
      hoverFilter ??
      (hasExplicitHoverFill ? resting.filter : addBrightnessFallback(resting.filter)),
  });
  writeMirroredVisualStyle(host, 'active-', {
    ...resting,
    background:
      readFirstCustomProperty(style, ['--bs-btn-active-bg', '--btn-active-bg']) ??
      resting.background,
    color:
      readFirstCustomProperty(style, ['--bs-btn-active-color', '--btn-active-color']) ??
      resting.color,
    borderColor:
      readFirstCustomProperty(style, [
        '--bs-btn-active-border-color',
        '--btn-active-border-color',
      ]) ?? resting.borderColor,
    boxShadow:
      readFirstCustomProperty(style, [
        '--bs-btn-active-shadow',
        '--bs-btn-active-box-shadow',
        '--btn-active-shadow',
        '--btn-active-box-shadow',
      ]) ?? resting.boxShadow,
  });
  host.style.setProperty('--renew-button-radius-top-right', style.borderTopRightRadius);
  host.style.setProperty('--renew-button-radius-bottom-right', style.borderBottomRightRadius);
  host.style.setProperty('--renew-button-font-family', style.fontFamily);
  host.style.setProperty('--renew-button-font-size', style.fontSize);
  host.style.setProperty('--renew-button-font-weight', style.fontWeight);
  host.style.setProperty('--renew-button-line-height', style.lineHeight);
  if (bounds.height > 0) host.style.setProperty('--renew-button-height', `${bounds.height}px`);
}

function addBrightnessFallback(filter: string): string {
  const trimmed = filter.trim();
  return trimmed && trimmed !== 'none' ? `${trimmed} brightness(1.12)` : 'brightness(1.12)';
}

interface MirroredVisualStyle {
  background: string;
  color: string;
  borderColor: string;
  boxShadow: string;
  filter: string;
  transform: string;
}

function readComputedVisualStyle(style: CSSStyleDeclaration): MirroredVisualStyle {
  return {
    background: style.background,
    color: style.color,
    borderColor: style.borderRightColor,
    boxShadow: style.boxShadow,
    filter: style.filter,
    transform: style.transform,
  };
}

function readFirstCustomProperty(
  style: CSSStyleDeclaration,
  propertyNames: readonly string[],
): string | null {
  for (const propertyName of propertyNames) {
    const value = style.getPropertyValue(propertyName).trim();
    if (value) return value;
  }
  return null;
}

function writeMirroredVisualStyle(
  host: HTMLSpanElement,
  statePrefix: '' | 'hover-' | 'active-',
  style: MirroredVisualStyle,
): void {
  host.style.setProperty(`--renew-button-${statePrefix}background`, style.background);
  host.style.setProperty(`--renew-button-${statePrefix}color`, style.color);
  host.style.setProperty(`--renew-button-${statePrefix}border-color`, style.borderColor);
  host.style.setProperty(`--renew-button-${statePrefix}box-shadow`, style.boxShadow);
  host.style.setProperty(`--renew-button-${statePrefix}filter`, style.filter);
  host.style.setProperty(`--renew-button-${statePrefix}transform`, style.transform);
}

/**
 * Odoo spaces status-bar actions either with a button margin or with a flex/grid
 * column gap. The native margin is transferred to the caret below. A parent gap
 * needs a local negative margin at the Renew/caret seam so it is not inserted
 * between the two halves; the same parent gap remains untouched after the caret.
 */
function getParentJoinOffset(button: HTMLButtonElement): string {
  const parent = button.parentElement;
  const view = button.ownerDocument.defaultView;
  if (!parent || !view) return '0px';

  const style = view.getComputedStyle(parent);
  const supportsHorizontalGap =
    style.display.includes('grid') ||
    (style.display.includes('flex') &&
      (style.flexDirection === 'row' || style.flexDirection === 'row-reverse'));
  if (!supportsHorizontalGap) return '0px';

  const gap = Number.parseFloat(style.columnGap);
  if (!Number.isFinite(gap) || gap <= 0 || gap > 64) return '0px';
  return `${-gap}px`;
}

function attachNativeSplitButtonStyle(
  button: HTMLButtonElement,
  host: HTMLSpanElement,
): () => void {
  const view = button.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(button);
  const originalStyles = new Map<string, InlineStyleValue>();
  for (const property of SPLIT_BUTTON_PROPERTIES) {
    originalStyles.set(property, {
      value: button.style.getPropertyValue(property),
      priority: button.style.getPropertyPriority(property),
    });
  }
  const originalMarker = button.getAttribute('data-ohe-renewal-split-source');
  const snapshot: SplitButtonSnapshot = {
    originalMarker,
    styles: Object.fromEntries(originalStyles),
  };
  button.setAttribute(SPLIT_SNAPSHOT_ATTRIBUTE, JSON.stringify(snapshot));

  // Transfer the native action spacing to the caret host, then make Renew and
  // the caret meet on a single separator. Logical radii cover RTL layouts;
  // physical right radii keep older Odoo/Firefox combinations deterministic.
  const nativeEndMargin = computed?.marginInlineEnd || computed?.marginRight || '0px';
  host.style.setProperty('margin-inline-start', getParentJoinOffset(button), 'important');
  host.style.setProperty('margin-inline-end', nativeEndMargin, 'important');
  button.style.setProperty('margin-inline-end', '0px', 'important');
  button.style.setProperty('border-top-right-radius', '0px', 'important');
  button.style.setProperty('border-bottom-right-radius', '0px', 'important');
  button.style.setProperty('border-start-end-radius', '0px', 'important');
  button.style.setProperty('border-end-end-radius', '0px', 'important');
  button.style.setProperty('border-right-width', '0px', 'important');
  button.style.setProperty('border-inline-end-width', '0px', 'important');
  button.setAttribute('data-ohe-renewal-split-source', 'true');

  return () => {
    restoreInlineStyles(button, Object.fromEntries(originalStyles));
    restoreMarker(button, originalMarker);
    button.removeAttribute(SPLIT_SNAPSHOT_ATTRIBUTE);
  };
}

export function attachRenewalButtonHost(
  rootId: string,
  styles: string,
  documentRoot: Document = document,
): RenewalButtonHost | null {
  const button = findNativeRenewButton(documentRoot);
  if (!button?.parentElement) return null;

  const existingHost = documentRoot.getElementById(rootId);
  if (existingHost) {
    const detachExisting = hostDetachers.get(existingHost);
    if (detachExisting) detachExisting();
    else {
      restoreOrphanedSplitButton(button, existingHost);
      existingHost.remove();
    }
  }
  // A detached/crashed host may already be gone while its inline split styles
  // remain on the native button. Recover them before mirroring or snapshotting.
  restoreOrphanedSplitButton(button, null);
  const host = documentRoot.createElement('span');
  host.id = rootId;
  host.style.display = 'inline-flex';
  host.style.alignSelf = 'stretch';
  host.style.minWidth = '0px';
  host.style.overflow = 'hidden';
  host.style.pointerEvents = 'auto';
  host.style.position = 'relative';
  host.style.zIndex = '1';
  host.setAttribute('data-extension-renewal', 'OdooHealthExtCS');
  mirrorNativeButtonStyle(host, button);
  const restoreNativeButton = attachNativeSplitButtonStyle(button, host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = documentRoot.createElement('style');
  style.textContent = `${RENEWAL_HOST_STYLES}\n${styles}`;
  const container = documentRoot.createElement('span');
  container.style.display = 'inline-flex';
  container.style.alignItems = 'stretch';
  container.style.flex = '0 0 var(--renew-button-caret-width, 32px)';
  container.style.width = 'var(--renew-button-caret-width, 32px)';
  shadow.append(style, container);

  button.insertAdjacentElement('afterend', host);
  let detached = false;
  const detach = (): void => {
    if (detached) return;
    detached = true;
    restoreNativeButton();
    hostDetachers.delete(host);
    host.remove();
  };
  hostDetachers.set(host, detach);
  return { host, shadow, container, sourceButton: button, detach };
}
