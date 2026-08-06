import { findContractNumberAnchor, findOrderDateAnchor } from './routes';

export interface OdooFieldAnchor {
  bottom: number;
  left: number;
  width: number;
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

function parsePixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function measureOrderDateAnchor(
  root: ParentNode = document,
  viewportHeight = window.innerHeight,
): OdooFieldAnchor | null {
  const field = findOrderDateAnchor(root);
  const contractNumber = findContractNumberAnchor(root);
  const valueCell = field?.closest<HTMLElement>('.o_cell');
  const labelCell = valueCell?.previousElementSibling as HTMLElement | null;
  const group = field?.closest<HTMLElement>('.o_inner_group');
  if (
    !field ||
    !contractNumber ||
    !valueCell ||
    !labelCell ||
    !group ||
    !labelCell.classList.contains('o_wrap_label')
  ) {
    return null;
  }

  const labelBounds = labelCell.getBoundingClientRect();
  const valueBounds = valueCell.getBoundingClientRect();
  const contractBounds = contractNumber.getBoundingClientRect();
  const sheetBounds = field.closest<HTMLElement>('.o_form_sheet')?.getBoundingClientRect();
  const statusBounds = root
    .querySelector<HTMLElement>('.o_form_view [name="subscription_state"]')
    ?.getBoundingClientRect();
  const fieldTop = Math.min(labelBounds.top, valueBounds.top);
  if (
    labelBounds.width <= 0 ||
    valueBounds.width <= 0 ||
    contractBounds.width <= 0 ||
    fieldTop < 72 ||
    fieldTop > viewportHeight
  ) {
    return null;
  }

  const fieldStyle = getComputedStyle(field);
  const labelStyle = getComputedStyle(labelCell);
  const groupStyle = getComputedStyle(group);
  const link = group.querySelector<HTMLElement>('a:not(.o_external_button)');
  const linkColor = link ? getComputedStyle(link).color : '#00a09d';
  const rowGap = parsePixels(groupStyle.rowGap, 8);
  const left = contractBounds.right + 48;
  const safeRight = Math.min(
    sheetBounds?.right ? sheetBounds.right - 16 : valueBounds.right,
    statusBounds?.left ? statusBounds.left - 20 : Number.POSITIVE_INFINITY,
  );
  const width = Math.min(380, safeRight - left);
  if (width < 260) return null;

  return {
    bottom: Math.max(0, viewportHeight - fieldTop + rowGap),
    left,
    width,
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
