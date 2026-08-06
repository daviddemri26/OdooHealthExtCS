import { findOrderDateAnchor } from './routes';

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
  const valueCell = field?.closest<HTMLElement>('.o_cell');
  const labelCell = valueCell?.previousElementSibling as HTMLElement | null;
  const group = field?.closest<HTMLElement>('.o_inner_group');
  if (
    !field ||
    !valueCell ||
    !labelCell ||
    !group ||
    !labelCell.classList.contains('o_wrap_label')
  ) {
    return null;
  }

  const labelBounds = labelCell.getBoundingClientRect();
  const valueBounds = valueCell.getBoundingClientRect();
  const fieldTop = Math.min(labelBounds.top, valueBounds.top);
  if (
    labelBounds.width <= 0 ||
    valueBounds.width <= 0 ||
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

  return {
    bottom: Math.max(0, viewportHeight - fieldTop + rowGap),
    left: labelBounds.left,
    width: valueBounds.right - labelBounds.left,
    labelWidth: labelBounds.width,
    columnGap: Math.max(0, valueBounds.left - labelBounds.right),
    rowGap,
    fontFamily: fieldStyle.fontFamily,
    fontSize: fieldStyle.fontSize,
    lineHeight: fieldStyle.lineHeight,
    labelColor: labelStyle.color,
    valueColor: fieldStyle.color,
    linkColor,
  };
}
