import { beforeEach, describe, expect, it } from 'vitest';

import {
  findOrderDateAnchor,
  isAllowedOdooLocation,
  isRenderedSubscriptionForm,
  parseSubscriptionRoute,
} from '../src/odoo/routes';

function location(
  pathname: string,
  hostname = 'www.odoo.com',
): Pick<Location, 'hostname' | 'pathname'> {
  return { hostname, pathname };
}

describe('Odoo route eligibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('accepts only the exact Odoo host and /odoo prefix', () => {
    expect(isAllowedOdooLocation(location('/odoo/subscriptions/42'))).toBe(true);
    expect(isAllowedOdooLocation(location('/subscriptions/42'))).toBe(false);
    expect(isAllowedOdooLocation(location('/odoo/subscriptions/42', 'odoo.com'))).toBe(false);
    expect(isAllowedOdooLocation(location('/odoo/subscriptions/42', 'example.com'))).toBe(false);
  });

  it('parses direct subscription routes', () => {
    expect(parseSubscriptionRoute(location('/odoo/subscriptions/42'))).toMatchObject({
      model: 'sale.order',
      recordId: 42,
    });
  });

  it('uses the active model on nested SPA routes', () => {
    expect(parseSubscriptionRoute(location('/odoo/project.task/9/sale.order/84'))).toMatchObject({
      recordId: 84,
    });
    expect(parseSubscriptionRoute(location('/odoo/subscriptions/42/res.partner/15'))).toBeNull();
  });

  it('requires a rendered subscription form', () => {
    document.body.innerHTML = `
      <div class="o_form_view">
        <div name="partner_id"></div>
        <div name="subscription_state"></div>
      </div>`;
    expect(isRenderedSubscriptionForm('/odoo/sale.order/42')).toBe(true);
    document.querySelector('[name="subscription_state"]')?.remove();
    expect(isRenderedSubscriptionForm('/odoo/sale.order/42')).toBe(false);
    expect(isRenderedSubscriptionForm('/odoo/subscriptions/42')).toBe(true);
  });

  it('finds the native Order Date field used as the visual anchor', () => {
    document.body.innerHTML = `
      <div class="o_form_view">
        <div name="date_order"></div>
      </div>`;
    expect(findOrderDateAnchor()).toBe(document.querySelector('[name="date_order"]'));
    document.querySelector('[name="date_order"]')?.remove();
    expect(findOrderDateAnchor()).toBeNull();
  });
});
