export const NATIVE_RENEWAL_QUOTE_BUTTON_SELECTOR =
  '.o_form_view button[name="open_subscription_renewal"]';
export const NATIVE_RENEWAL_QUOTE_VALUE_SELECTOR =
  '.o_field_statinfo[name="renewal_count"] .o_stat_value';

interface PatchedNativeValue {
  element: HTMLElement;
  originalText: string;
  displayedText: string;
}

export interface RenewalQuoteSmartButtonState {
  enabled: boolean;
  sourceOrderId: number | null;
  visibleRenewalQuoteCount: number | null;
}

export interface RenewalQuoteSmartButtonOptions {
  document?: Document;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseRenderedCount(value: string | null): number | null {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  const count = Number(normalized);
  return Number.isSafeInteger(count) ? count : null;
}

function uniqueElement<T extends Element>(root: ParentNode, selector: string): T | null {
  const elements = root.querySelectorAll<T>(selector);
  return elements.length === 1 ? elements[0]! : null;
}

/** Updates only Odoo's existing Renewal Quote counter and never creates a button. */
export class RenewalQuoteSmartButtonManager {
  private readonly document: Document;
  private sourceOrderId: number | null = null;
  private lastNativeCount = 0;
  private patchedNative: PatchedNativeValue | null = null;

  constructor(options: RenewalQuoteSmartButtonOptions = {}) {
    this.document = options.document ?? document;
  }

  sync(state: RenewalQuoteSmartButtonState): void {
    if (
      !state.enabled ||
      !isPositiveSafeInteger(state.sourceOrderId) ||
      !isNonNegativeSafeInteger(state.visibleRenewalQuoteCount)
    ) {
      this.detach();
      return;
    }

    if (this.sourceOrderId !== state.sourceOrderId) {
      this.resetSource(state.sourceOrderId);
    }

    const nativeButton = uniqueElement<HTMLButtonElement>(
      this.document,
      NATIVE_RENEWAL_QUOTE_BUTTON_SELECTOR,
    );
    if (!nativeButton) {
      this.restoreNativeValue();
      return;
    }

    this.syncNativeButton(nativeButton, state.visibleRenewalQuoteCount);
  }

  detach(): void {
    this.restoreNativeValue();
    this.sourceOrderId = null;
    this.lastNativeCount = 0;
  }

  private resetSource(sourceOrderId: number): void {
    this.restoreNativeValue();
    this.sourceOrderId = sourceOrderId;
    this.lastNativeCount = 0;
  }

  private syncNativeButton(button: HTMLButtonElement, controlledCount: number): void {
    const value = uniqueElement<HTMLElement>(button, NATIVE_RENEWAL_QUOTE_VALUE_SELECTOR);
    if (!value) {
      this.restoreNativeValue();
      return;
    }

    if (this.patchedNative?.element !== value) {
      this.restoreNativeValue();
      const nativeCount = parseRenderedCount(value.textContent);
      if (nativeCount !== null) this.lastNativeCount = nativeCount;
      this.patchedNative = {
        element: value,
        originalText: value.textContent ?? '',
        displayedText: value.textContent ?? '',
      };
    } else if (value.textContent !== this.patchedNative.displayedText) {
      const nativeCount = parseRenderedCount(value.textContent);
      if (nativeCount !== null) this.lastNativeCount = nativeCount;
      this.patchedNative.originalText = value.textContent ?? '';
    }

    const renderedCount = String(Math.max(controlledCount, this.lastNativeCount));
    if (value.textContent !== renderedCount) value.textContent = renderedCount;
    this.patchedNative.displayedText = renderedCount;
  }

  private restoreNativeValue(): void {
    if (!this.patchedNative) return;
    const { element, originalText, displayedText } = this.patchedNative;
    if (element.isConnected && element.textContent === displayedText) {
      element.textContent = originalText;
    }
    this.patchedNative = null;
  }
}
