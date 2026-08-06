import { findContractNumberAnchor, findOrderDateAnchor } from './routes';

export interface OdooFieldAnchor {
  top: number;
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

export function measureOrderDateAnchor(root: ParentNode = document): OdooFieldAnchor | null {
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
  if (
    labelBounds.width <= 0 ||
    valueBounds.width <= 0 ||
    contractBounds.width <= 0 ||
    !sheetBounds ||
    sheetBounds.width <= 0 ||
    sheetBounds.height <= 0
  ) {
    return null;
  }

  const fieldStyle = getComputedStyle(field);
  const labelStyle = getComputedStyle(labelCell);
  const link = group.querySelector<HTMLElement>('a:not(.o_external_button)');
  const linkColor = link ? getComputedStyle(link).color : '#00a09d';
  const leftViewport = contractBounds.right + 48;
  const left = leftViewport - sheetBounds.left;
  const safeRight = Math.min(
    sheetBounds.right - 16,
    statusBounds?.left ? statusBounds.left - 20 : Number.POSITIVE_INFINITY,
  );
  const width = Math.min(380, safeRight - leftViewport);
  if (width < 260) return null;

  return {
    top: 0,
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
