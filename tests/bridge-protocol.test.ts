import { describe, expect, it } from 'vitest';

import {
  CANONICAL_HEALTH_NAMES,
  ODOO_BRIDGE_CHANNEL,
  ODOO_BRIDGE_VERSION,
  isOdooBridgeRequest,
  validateOdooBridgeCall,
  type OdooBridgeCall,
} from '../src/odoo/bridge-protocol';

function call(overrides: Partial<OdooBridgeCall> = {}): OdooBridgeCall {
  return {
    model: 'sale.order',
    method: 'read',
    args: [[42], ['tag_ids']],
    kwargs: {},
    ...overrides,
  };
}

describe('Odoo bridge allow-list', () => {
  it('accepts only an exact versioned connection probe request', () => {
    const probe = {
      channel: ODOO_BRIDGE_CHANNEL,
      version: ODOO_BRIDGE_VERSION,
      direction: 'request',
      clientId: 'client-12345678',
      requestId: 'request-12345678',
      kind: 'probe',
    };

    expect(isOdooBridgeRequest(probe)).toBe(true);
    expect(isOdooBridgeRequest({ ...probe, model: 'res.users' })).toBe(false);
    expect(isOdooBridgeRequest({ ...probe, version: ODOO_BRIDGE_VERSION - 1 })).toBe(false);
  });

  it('accepts every operation required by Health and Industry', () => {
    const allowed: OdooBridgeCall[] = [
      call({
        method: 'fields_get',
        args: [],
        kwargs: {
          allfields: ['tag_ids'],
          attributes: ['type', 'relation', 'readonly', 'string'],
        },
      }),
      call({ args: [[42], ['tag_ids', 'partner_id', 'subscription_state']] }),
      call({ args: [[42], ['partner_id']] }),
      call({ model: 'res.partner', args: [[7], ['industry_id']] }),
      call({
        method: 'search_read',
        args: [[['name', 'in', ['SO2026/1', 'SO2026/2']]]],
        kwargs: { fields: ['id', 'name', 'tag_ids'], limit: 4 },
      }),
      call({
        model: 'crm.tag',
        method: 'search_read',
        args: [[['name', 'in', [...CANONICAL_HEALTH_NAMES]]]],
        kwargs: { fields: ['id', 'name'], limit: 20 },
      }),
      call({
        model: 'res.partner.industry',
        method: 'search_read',
        args: [[]],
        kwargs: { fields: ['id', 'name'], limit: 500, order: 'name asc' },
      }),
      call({
        method: 'write',
        args: [[42], { tag_ids: [[6, 0, [1, 2, 3]]] }],
      }),
      call({ model: 'res.partner', method: 'write', args: [[7], { industry_id: false }] }),
      call({ model: 'res.partner', method: 'write', args: [[7], { industry_id: 9 }] }),
    ];

    for (const operation of allowed)
      expect(validateOdooBridgeCall(operation)).toEqual({ ok: true });
  });

  it.each([
    call({ model: 'res.users' }),
    call({ method: 'unlink' }),
    call({ args: [[42], ['amount_total']] }),
    call({ args: [[42, 43], ['tag_ids']] }),
    call({
      method: 'search_read',
      args: [[['name', 'in', ['SO2026/1', 'SO2026/1']]]],
      kwargs: { fields: ['id', 'name', 'tag_ids'], limit: 4 },
    }),
    call({
      method: 'search_read',
      args: [[['name', 'in', ['SO2026/1']]]],
      kwargs: { fields: ['id', 'name', 'partner_id', 'tag_ids'], limit: 2 },
    }),
    call({
      method: 'search_read',
      args: [[['name', 'in', ['SO2026/1']]]],
      kwargs: { fields: ['id', 'name', 'tag_ids'], limit: 100 },
    }),
    call({
      method: 'search_read',
      args: [[['name', 'in', Array.from({ length: 101 }, (_, index) => `SO2026/${index + 1}`)]]],
      kwargs: { fields: ['id', 'name', 'tag_ids'], limit: 202 },
    }),
    call({
      model: 'crm.tag',
      method: 'search_read',
      args: [[['name', 'ilike', 'Health']]],
      kwargs: { fields: ['id', 'name'], limit: 20 },
    }),
    call({ method: 'write', args: [[42], { tag_ids: [[4, 99]] }] }),
    call({ method: 'write', args: [[42], { tag_ids: [[6, 0, []]], amount_total: 0 }] }),
    call({ model: 'res.partner', method: 'write', args: [[7], { industry_id: '9' }] }),
  ])('rejects an operation outside the exact allow-list', (operation) => {
    expect(validateOdooBridgeCall(operation)).toMatchObject({
      ok: false,
      failure: { code: 'incompatible_endpoint' },
    });
  });
});
