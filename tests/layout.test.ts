import { beforeEach, describe, expect, it } from 'vitest';

import { measureOrderDateAnchor } from '../src/odoo/layout';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('native Odoo field anchor', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="o_form_view">
        <div class="o_inner_group" style="row-gap: 8px">
          <div class="o_cell o_wrap_label" style="color: rgb(80, 80, 80)">Order Date</div>
          <div class="o_cell">
            <div
              name="date_order"
              style="font-family: Arial; font-size: 14px; line-height: 21px; color: rgb(40, 40, 40)"
            ></div>
          </div>
          <a style="color: rgb(0, 160, 157)">Related value</a>
        </div>
      </div>`;
  });

  it('matches the Order Date label and value columns at any horizontal position', () => {
    const field = document.querySelector<HTMLElement>('[name="date_order"]')!;
    const value = field.closest<HTMLElement>('.o_cell')!;
    const label = value.previousElementSibling as HTMLElement;
    label.getBoundingClientRect = () => rect(520, 220, 136, 26);
    value.getBoundingClientRect = () => rect(672, 220, 408, 26);

    expect(measureOrderDateAnchor(document, 760)).toMatchObject({
      bottom: 548,
      left: 520,
      width: 560,
      labelWidth: 136,
      columnGap: 16,
      rowGap: 8,
      fontSize: '14px',
      lineHeight: '21px',
      labelColor: 'rgb(80, 80, 80)',
      valueColor: 'rgb(40, 40, 40)',
      linkColor: 'rgb(0, 160, 157)',
    });
  });

  it('does not use a fallback position when Order Date is hidden or offscreen', () => {
    const field = document.querySelector<HTMLElement>('[name="date_order"]')!;
    const value = field.closest<HTMLElement>('.o_cell')!;
    const label = value.previousElementSibling as HTMLElement;
    label.getBoundingClientRect = () => rect(520, 40, 136, 26);
    value.getBoundingClientRect = () => rect(672, 40, 408, 26);
    expect(measureOrderDateAnchor(document, 760)).toBeNull();

    label.getBoundingClientRect = () => rect(520, 220, 0, 0);
    expect(measureOrderDateAnchor(document, 760)).toBeNull();
  });
});
