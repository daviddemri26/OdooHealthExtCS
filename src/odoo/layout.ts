import { findContractNumberAnchor, findOrderDateAnchor } from './routes';

export interface OdooFieldAnchor {
  top: number;
  left: number;
  maxWidth: number;
  labelWidth: number;
  columnGap: number;
  rowGap: number;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  labelColor: string;
  valueColor: string;
  linkColor: string;
}

function measureContractTextRight(
  contractNumber: HTMLElement | null,
  sheetBounds: DOMRect,
): number | undefined {
  if (!contractNumber) return undefined;
  const bounds = contractNumber.getBoundingClientRect();
  if (bounds.width > 0 && bounds.width <= Math.min(520, sheetBounds.width * 0.5)) {
    return bounds.right;
  }

  const range = contractNumber.ownerDocument.createRange?.();
  if (range && typeof range.getBoundingClientRect === 'function') {
    try {
      range.selectNodeContents(contractNumber);
      const textBounds = range.getBoundingClientRect();
      if (
        textBounds.width > 0 &&
        textBounds.width <= Math.min(520, sheetBounds.width * 0.5) &&
        textBounds.right > sheetBounds.left &&
        textBounds.right < sheetBounds.right
      ) {
        return textBounds.right;
      }
    } catch {
      // Firefox may expose the heading before its text range is measurable.
    }
  }

  const text = contractNumber.textContent?.trim();
  if (!text) return undefined;
  const fontSize = Number.parseFloat(getComputedStyle(contractNumber).fontSize) || 40;
  const estimatedWidth = Math.min(480, Math.max(120, text.length * fontSize * 0.62));
  const left = bounds.left > sheetBounds.left ? bounds.left : sheetBounds.left + 16;
  return Math.min(sheetBounds.right - 16, left + estimatedWidth);
}

export function measureOrderDateAnchor(root: ParentNode = document): OdooFieldAnchor | null {
  const field = findOrderDateAnchor(root);
  const contractNumber = findContractNumberAnchor(root);
  const sheet =
    field?.closest<HTMLElement>('.o_form_sheet') ??
    contractNumber?.closest<HTMLElement>('.o_form_sheet') ??
    Array.from(root.querySelectorAll<HTMLElement>('.o_form_view .o_form_sheet')).find(
      (candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      },
    );
  if (!sheet) return null;

  const sheetBounds = sheet?.getBoundingClientRect();
  const statusBounds = root
    .querySelector<HTMLElement>('.o_form_view [name="subscription_state"]')
    ?.getBoundingClientRect();
  if (!sheetBounds || sheetBounds.width <= 0 || sheetBounds.height <= 0) {
    return null;
  }

  const group = field?.closest<HTMLElement>('.o_inner_group');
  const label =
    group?.querySelector<HTMLElement>('.o_wrap_label, label') ??
    sheet?.querySelector<HTMLElement>('.o_inner_group .o_wrap_label, .o_inner_group label') ??
    contractNumber ??
    sheet;
  const fieldStyle = getComputedStyle(field ?? sheet);
  const labelStyle = getComputedStyle(label);
  const link =
    group?.querySelector<HTMLElement>('a:not(.o_external_button)') ??
    sheet?.querySelector<HTMLElement>('a:not(.o_external_button)');
  const linkColor = link ? getComputedStyle(link).color : '#00a09d';
  const statusLeft =
    statusBounds && statusBounds.width > 0 && statusBounds.left > sheetBounds.left
      ? statusBounds.left - 20
      : Number.POSITIVE_INFINITY;
  const safeRight = Math.min(sheetBounds.right - 16, statusLeft);
  const measuredContractRight = measureContractTextRight(contractNumber, sheetBounds);
  const preferredLeftViewport = measuredContractRight
    ? measuredContractRight + 48
    : sheetBounds.left + Math.min(360, Math.max(240, sheetBounds.width * 0.32));
  const minimumPanelWidth = 230;
  const latestSafeLeft = Math.max(sheetBounds.left + 16, safeRight - minimumPanelWidth);
  const leftViewport = Math.min(preferredLeftViewport, latestSafeLeft);
  const left = Math.max(16, leftViewport - sheetBounds.left);
  const maxWidth = Math.max(
    minimumPanelWidth,
    Math.min(440, sheetBounds.width - left - 16, safeRight - (sheetBounds.left + left)),
  );

  return {
    top: 0,
    left,
    maxWidth,
    labelWidth: 64,
    columnGap: 8,
    rowGap: 4,
    fontFamily: fieldStyle.fontFamily,
    fontSize: fieldStyle.fontSize,
    lineHeight: fieldStyle.lineHeight,
    labelColor: labelStyle.color,
    valueColor: fieldStyle.color,
    linkColor,
  };
}
