import { beforeEach, describe, expect, it } from 'vitest';

import {
  collectSubscriptionListRows,
  findSubscriptionListView,
  SubscriptionListHealthPreview,
} from '../src/features/health/list-preview';
import { MockGateway } from './helpers/mock-gateway';

function renderSubscriptionList(): HTMLTableElement {
  document.body.innerHTML = `
    <div class="o_action_manager">
      <div class="o_list_view o_view_controller o_action">
        <table class="o_list_table">
          <thead><tr>
            <th data-name="recurring_total">Recurring</th>
            <th data-name="subscription_state">Status</th>
            <th data-name="partner_id">Customer</th>
            <th data-name="name">Number</th>
          </tr></thead>
          <tbody>
            <tr class="o_group_header"><th colspan="4">September</th></tr>
            <tr class="o_data_row">
              <td name="subscription_state">In Progress</td>
              <td name="partner_id">Customer One</td>
              <td name="recurring_total">100</td>
              <td name="name" data-tooltip="SO/1">SO/1</td>
            </tr>
            <tr class="o_data_row">
              <td name="name" data-tooltip="SO/2">SO/2</td>
              <td name="recurring_total">200</td>
              <td name="partner_id">Customer Two</td>
              <td name="subscription_state">In Progress</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
  return document.querySelector('table')!;
}

function configuredGateway(): MockGateway {
  const gateway = new MockGateway();
  gateway.fields['sale.order'] = { tag_ids: { type: 'many2many', relation: 'crm.tag' } };
  gateway.searches['crm.tag'] = [
    { id: 11, name: 'Health - High' },
    { id: 12, name: 'Health - Medium' },
    { id: 13, name: 'Health - Low' },
  ];
  gateway.searches['sale.order'] = [
    { id: 1, name: 'SO/1', tag_ids: [11] },
    { id: 2, name: 'SO/2', tag_ids: [] },
  ];
  return gateway;
}

describe('subscription list health preview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.querySelector('#odoo-health-list-preview-styles')?.remove();
  });

  it('recognizes a subscription list from technical fields without inspecting the URL', () => {
    const table = renderSubscriptionList();
    expect(findSubscriptionListView()).toMatchObject({ table });
    expect(collectSubscriptionListRows(table).map((row) => row.orderName)).toEqual([
      'SO/1',
      'SO/2',
    ]);

    document.querySelector('[data-name="subscription_state"]')?.remove();
    document.querySelectorAll('[name="subscription_state"]').forEach((cell) => cell.remove());
    expect(findSubscriptionListView()).toBeNull();
  });

  it('decorates customer cells by field name and ignores grouped rows', async () => {
    renderSubscriptionList();
    const preview = new SubscriptionListHealthPreview(configuredGateway());
    const syncing = preview.sync(true);

    const customerCells = Array.from(
      document.querySelectorAll<HTMLTableCellElement>('td[name="partner_id"]'),
    );
    expect(customerCells).toHaveLength(2);
    expect(customerCells[0]).toHaveClass('odoo-health-list-preview-cell');
    const loadingMarker = customerCells[0]?.querySelector('[data-health-state="loading"]');
    expect(loadingMarker).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelectorAll('[data-health-state="loading"]')).toHaveLength(2);

    await syncing;

    expect(customerCells[0]?.querySelector('[data-health-state="high"]')).toBe(loadingMarker);
    expect(loadingMarker).toHaveAttribute('aria-label', 'Account health: High');
    expect(customerCells[1]?.querySelector('[data-health-state="not-set"]')).toBeInTheDocument();
    expect(document.querySelector('.o_group_header .odoo-health-list-preview-marker')).toBeNull();
    expect(document.querySelector('#odoo-health-list-preview-styles')).toHaveTextContent(
      'width: 3px',
    );
    expect(document.querySelector('#odoo-health-list-preview-styles')).toHaveTextContent(
      'padding-left: 7px',
    );
    expect(document.querySelector('#odoo-health-list-preview-styles')).toHaveTextContent(
      'transform: translateY(-2px)',
    );
    expect(document.querySelector('#odoo-health-list-preview-styles')).toHaveTextContent(
      'background-color: rgba(142, 142, 147, 0.2)',
    );
    expect(document.querySelector('#odoo-health-list-preview-styles')).toHaveTextContent(
      'transition: background-color 140ms ease-out',
    );
  });

  it('removes markers when disabled or when the rendered view stops matching', async () => {
    renderSubscriptionList();
    const preview = new SubscriptionListHealthPreview(configuredGateway());
    await preview.sync(true);
    expect(document.querySelectorAll('.odoo-health-list-preview-marker')).toHaveLength(2);

    await preview.sync(false);
    expect(document.querySelector('.odoo-health-list-preview-marker')).toBeNull();
    expect(document.querySelector('.odoo-health-list-preview-cell')).toBeNull();

    await preview.sync(true);
    document.querySelector('.o_list_view')?.classList.remove('o_action');
    await preview.sync(true);
    expect(document.querySelector('.odoo-health-list-preview-marker')).toBeNull();
  });

  it('refreshes markers after Odoo replaces the rendered list rows', async () => {
    const table = renderSubscriptionList();
    const gateway = configuredGateway();
    const preview = new SubscriptionListHealthPreview(gateway);
    await preview.sync(true);

    table.querySelector('tbody')!.innerHTML = `
      <tr class="o_data_row">
        <td name="name" data-tooltip="SO/3">SO/3</td>
        <td name="partner_id">Customer Three</td>
        <td name="subscription_state">In Progress</td>
        <td name="recurring_total">300</td>
      </tr>`;
    gateway.searches['sale.order'] = [{ id: 3, name: 'SO/3', tag_ids: [12] }];
    await preview.sync(true);

    expect(document.querySelector('[data-health-state="medium"]')).toHaveAttribute(
      'aria-label',
      'Account health: Medium',
    );
    expect(document.querySelectorAll('.odoo-health-list-preview-marker')).toHaveLength(1);
  });

  it('does not leave a gray fallback when Odoo returns an unsafe response', async () => {
    renderSubscriptionList();
    const gateway = configuredGateway();
    gateway.searches['sale.order'] = [{ id: 1, name: 'SO/1', tag_ids: ['unsafe'] }];
    const preview = new SubscriptionListHealthPreview(gateway);
    await preview.sync(true);

    expect(document.querySelector('.odoo-health-list-preview-marker')).toBeNull();
    expect(document.querySelector('.odoo-health-list-preview-cell')).toBeNull();
  });
});
