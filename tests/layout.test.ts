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
        <div class="o_form_sheet">
          <h1><div name="client_order_ref"><span>SO2026/123</span></div></h1>
          <div name="subscription_state"></div>
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
        </div>
      </div>`;
  });

  it('matches the Order Date label and value columns at any horizontal position', () => {
    const field = document.querySelector<HTMLElement>('[name="date_order"]')!;
    const value = field.closest<HTMLElement>('.o_cell')!;
    const label = value.previousElementSibling as HTMLElement;
    const contract = document.querySelector<HTMLElement>('h1 span')!;
    const sheet = document.querySelector<HTMLElement>('.o_form_sheet')!;
    const status = document.querySelector<HTMLElement>('[name="subscription_state"]')!;
    label.getBoundingClientRect = () => rect(520, 220, 136, 26);
    value.getBoundingClientRect = () => rect(672, 220, 408, 26);
    contract.getBoundingClientRect = () => rect(40, 165, 280, 40);
    sheet.getBoundingClientRect = () => rect(24, 145, 1080, 800);
    status.getBoundingClientRect = () => rect(900, 165, 90, 21);

    expect(measureOrderDateAnchor(document)).toMatchObject({
      top: 0,
      left: 344,
      width: 380,
      labelWidth: 64,
      columnGap: 8,
      rowGap: 4,
      fontSize: '14px',
      lineHeight: '21px',
      labelColor: 'rgb(80, 80, 80)',
      valueColor: 'rgb(40, 40, 40)',
      linkColor: 'rgb(0, 160, 157)',
    });
  });

  it('keeps a stable sheet-relative position when the page scrolls', () => {
    const field = document.querySelector<HTMLElement>('[name="date_order"]')!;
    const value = field.closest<HTMLElement>('.o_cell')!;
    const label = value.previousElementSibling as HTMLElement;
    const contract = document.querySelector<HTMLElement>('h1 span')!;
    const sheet = document.querySelector<HTMLElement>('.o_form_sheet')!;
    const status = document.querySelector<HTMLElement>('[name="subscription_state"]')!;
    contract.getBoundingClientRect = () => rect(40, -235, 280, 40);
    label.getBoundingClientRect = () => rect(520, -180, 136, 26);
    value.getBoundingClientRect = () => rect(672, -180, 408, 26);
    sheet.getBoundingClientRect = () => rect(24, -255, 1080, 800);
    status.getBoundingClientRect = () => rect(900, -235, 90, 21);
    expect(measureOrderDateAnchor(document)).toMatchObject({ top: 0, left: 344, width: 380 });

    label.getBoundingClientRect = () => rect(520, 220, 0, 0);
    expect(measureOrderDateAnchor(document)).toBeNull();
  });

  it('stays clear of the native subscription-state badge', () => {
    const field = document.querySelector<HTMLElement>('[name="date_order"]')!;
    const value = field.closest<HTMLElement>('.o_cell')!;
    const label = value.previousElementSibling as HTMLElement;
    const contract = document.querySelector<HTMLElement>('h1 span')!;
    const sheet = document.querySelector<HTMLElement>('.o_form_sheet')!;
    const status = document.querySelector<HTMLElement>('[name="subscription_state"]')!;
    label.getBoundingClientRect = () => rect(520, 220, 136, 26);
    value.getBoundingClientRect = () => rect(672, 220, 408, 26);
    contract.getBoundingClientRect = () => rect(40, 165, 430, 40);
    sheet.getBoundingClientRect = () => rect(24, 145, 1080, 800);
    status.getBoundingClientRect = () => rect(800, 165, 90, 21);

    expect(measureOrderDateAnchor(document)).toMatchObject({
      left: 494,
      width: 262,
    });
  });

  it('falls back to the form title when Firefox omits the client-order field wrapper', () => {
    document.querySelector('[name="client_order_ref"]')?.remove();
    const heading = document.querySelector<HTMLElement>('h1')!;
    heading.textContent = 'SO2026/123';
    const field = document.querySelector<HTMLElement>('[name="date_order"]')!;
    const value = field.closest<HTMLElement>('.o_cell')!;
    const label = value.previousElementSibling as HTMLElement;
    const sheet = document.querySelector<HTMLElement>('.o_form_sheet')!;
    const status = document.querySelector<HTMLElement>('[name="subscription_state"]')!;
    label.getBoundingClientRect = () => rect(520, 220, 136, 26);
    value.getBoundingClientRect = () => rect(672, 220, 408, 26);
    heading.getBoundingClientRect = () => rect(40, 165, 280, 40);
    sheet.getBoundingClientRect = () => rect(24, 145, 1080, 800);
    status.getBoundingClientRect = () => rect(900, 165, 90, 21);

    expect(measureOrderDateAnchor(document)).toMatchObject({ top: 0, left: 344, width: 380 });
  });
});
