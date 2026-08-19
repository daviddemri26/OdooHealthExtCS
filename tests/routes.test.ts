import { beforeEach, describe, expect, it } from 'vitest';

import { isHealthEligibleSubscription } from '../src/features/health/eligibility';
import { isIndustryEligibleSubscription } from '../src/features/industry/eligibility';
import {
  findContractNumberAnchor,
  findOrderDateAnchor,
  getRenderedSubscriptionRoute,
  getRenderedQuoteShareRoute,
  getRenderedSubscriptionStatusLabel,
  hasInProgressSubscriptionBadge,
  isAllowedOdooLocation,
  isExactSubscriptionRoute,
  isExactQuoteShareRoute,
  isRenderedSubscriptionForm,
  parseSubscriptionRoute,
  parseQuoteShareRoutePathname,
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

  it('leaves In Progress eligibility to the server instead of translated badge text', () => {
    document.body.innerHTML = `
      <div class="o_form_view">
        <div name="partner_id"></div>
        <div name="subscription_state"><span class="badge">En cours</span></div>
      </div>`;
    const route = getRenderedSubscriptionRoute(location('/odoo/subscriptions/42'));
    expect(route).toMatchObject({ recordId: 42, pathname: '/odoo/subscriptions/42' });

    document.querySelector('[name="subscription_state"]')?.remove();
    expect(getRenderedSubscriptionRoute(location('/odoo/subscriptions/42'))).toMatchObject({
      recordId: 42,
    });
  });

  it('keeps an in-flight source bound to its exact record and pathname', () => {
    const route = parseSubscriptionRoute(location('/odoo/subscriptions/42'));
    expect(isExactSubscriptionRoute(route, 42, '/odoo/subscriptions/42')).toBe(true);
    expect(isExactSubscriptionRoute(route, 43, '/odoo/subscriptions/42')).toBe(false);
    expect(isExactSubscriptionRoute(route, 42, '/odoo/sale.order/42')).toBe(false);
  });

  it('targets direct Sales quotations and nested Subscription renewal quotations', () => {
    expect(parseQuoteShareRoutePathname('/odoo/sales/8170012')).toEqual({
      model: 'sale.order',
      recordId: 8_170_012,
      pathname: '/odoo/sales/8170012',
      target: 'sales_quotation',
    });
    expect(
      parseQuoteShareRoutePathname('/odoo/subscriptions/6690030/sale.order/sale.order/8169620'),
    ).toEqual({
      model: 'sale.order',
      recordId: 8_169_620,
      pathname: '/odoo/subscriptions/6690030/sale.order/sale.order/8169620',
      target: 'renewal_quotation',
    });
    expect(parseQuoteShareRoutePathname('/odoo/sale.order/7199099/sale.order/8175629')).toEqual({
      model: 'sale.order',
      recordId: 8_175_629,
      pathname: '/odoo/sale.order/7199099/sale.order/8175629',
      target: 'renewal_quotation',
    });
  });

  it('rejects non-target roots and nested SPA routes ending on another model', () => {
    expect(parseQuoteShareRoutePathname('/odoo/project.task/42')).toBeNull();
    expect(parseQuoteShareRoutePathname('/odoo/sales/8170012/res.partner/15')).toBeNull();
    expect(parseQuoteShareRoutePathname('/odoo/subscriptions/42/project.task/9')).toBeNull();
    expect(parseQuoteShareRoutePathname('/odoo/sale.order/42/res.partner/15')).toBeNull();
  });

  it('requires a rendered sale-order form before exposing the Share shortcut', () => {
    document.body.innerHTML = `
      <div class="o_form_view">
        <div name="partner_id"></div>
      </div>`;
    const rendered = getRenderedQuoteShareRoute(location('/odoo/sales/8170012'));
    expect(rendered).toMatchObject({ recordId: 8_170_012, target: 'sales_quotation' });

    document.querySelector('[name="partner_id"]')?.remove();
    expect(getRenderedQuoteShareRoute(location('/odoo/sales/8170012'))).toBeNull();

    document.body.innerHTML = `
      <div class="o_form_view"></div>
      <div name="partner_id"></div>`;
    expect(getRenderedQuoteShareRoute(location('/odoo/sales/8170012'))).toBeNull();
  });

  it('keeps a Share request bound to its exact target, record, and pathname', () => {
    const route = parseQuoteShareRoutePathname('/odoo/sales/8170012');
    expect(isExactQuoteShareRoute(route, route!)).toBe(true);
    expect(
      isExactQuoteShareRoute(route, {
        ...route!,
        pathname: '/odoo/sales/8170013',
        recordId: 8_170_013,
      }),
    ).toBe(false);
    expect(isExactQuoteShareRoute(route, { ...route!, target: 'renewal_quotation' })).toBe(false);
  });

  it('accepts only an exact In Progress subscription badge', () => {
    document.body.innerHTML = `
      <div class="o_form_view">
        <div name="subscription_state"><span class="badge"> In   Progress </span></div>
      </div>`;
    expect(hasInProgressSubscriptionBadge()).toBe(true);

    document.querySelector('.badge')!.textContent = 'Quotation Sent';
    expect(hasInProgressSubscriptionBadge()).toBe(false);

    document.querySelector('.badge')!.textContent = 'Not In Progress';
    expect(hasInProgressSubscriptionBadge()).toBe(false);
  });

  it.each([
    ['In Progress', true],
    ['Paused', true],
    ['Quotation Sent', false],
    ['En cours', false],
    ['in progress', false],
  ])('applies the independent exact Health policy to %s', (label, expected) => {
    document.body.innerHTML = `
      <div class="o_form_view">
        <div name="subscription_state"><span class="badge">${label}</span></div>
      </div>`;
    expect(isHealthEligibleSubscription()).toBe(expected);
  });

  it.each([
    ['In Progress', true],
    ['Paused', true],
    ['Quotation Sent', false],
    ['En cours', false],
    ['paused', false],
  ])('applies the independent exact Industry policy to %s', (label, expected) => {
    document.body.innerHTML = `
      <div class="o_form_view">
        <div name="subscription_state"><span class="badge">${label}</span></div>
      </div>`;
    expect(isIndustryEligibleSubscription()).toBe(expected);
  });

  it('fails closed when the rendered state is absent or ambiguous', () => {
    document.body.innerHTML = '<div class="o_form_view"></div>';
    expect(getRenderedSubscriptionStatusLabel()).toBeNull();
    expect(isHealthEligibleSubscription()).toBe(false);
    expect(isIndustryEligibleSubscription()).toBe(false);

    document.body.innerHTML = `
      <div class="o_form_view">
        <div name="subscription_state"><span class="badge">In Progress</span></div>
        <div name="subscription_state"><span class="badge">Paused</span></div>
      </div>`;
    expect(getRenderedSubscriptionStatusLabel()).toBeNull();
    expect(isHealthEligibleSubscription()).toBe(false);
    expect(isIndustryEligibleSubscription()).toBe(false);
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

  it('finds the visible contract number text used as the horizontal anchor', () => {
    document.body.innerHTML = `
      <div class="o_form_view">
        <h1><div name="client_order_ref"><span>SO2026/123</span></div></h1>
      </div>`;
    expect(findContractNumberAnchor()).toBe(document.querySelector('h1 span'));
  });
});
