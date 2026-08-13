import { describe, expect, it } from 'vitest';

import {
  applyIndustryChange,
  loadIndustryContext,
  undoIndustryChange,
} from '../src/features/industry/service';
import { MockGateway } from './helpers/mock-gateway';

describe('industry service', () => {
  it('fails closed when the Odoo field contract changes', async () => {
    const gateway = new MockGateway();
    gateway.fields['res.partner'] = {
      industry_id: { type: 'many2one', relation: 'unexpected.industry' },
    };
    await expect(loadIndustryContext(gateway, 42)).rejects.toMatchObject({
      code: 'missing_fields',
    });
    expect(gateway.writes).toHaveLength(0);
  });

  it('loads the exact signed subscription partner and dynamic choices', async () => {
    const gateway = new MockGateway();
    gateway.fields['res.partner'] = {
      industry_id: { type: 'many2one', relation: 'res.partner.industry' },
    };
    gateway.reads['sale.order'] = [{ id: 42, partner_id: [-81, 'Synthetic Customer'] }];
    gateway.reads['res.partner'] = [{ id: -81, industry_id: [3, 'Technology'] }];
    gateway.searches['res.partner.industry'] = [
      { id: 3, name: 'Technology' },
      { id: 2, name: 'Education' },
    ];
    await expect(loadIndustryContext(gateway, 42)).resolves.toEqual({
      partnerId: -81,
      partnerName: 'Synthetic Customer',
      currentIndustryId: 3,
      industries: [
        { id: 2, name: 'Education' },
        { id: 3, name: 'Technology' },
      ],
    });
    expect(gateway.readCalls).toEqual([
      { model: 'sale.order', ids: [42], fields: ['partner_id'] },
      { model: 'res.partner', ids: [-81], fields: ['industry_id'] },
    ]);
  });

  it('preserves a signed partner ID while setting and clearing industry', async () => {
    const gateway = new MockGateway();
    const context = {
      partnerId: -81,
      partnerName: 'Synthetic Customer',
      currentIndustryId: 3,
      industries: [],
    };
    await applyIndustryChange(gateway, context, 5);
    await applyIndustryChange(gateway, context, null);
    expect(gateway.writes).toEqual([
      { model: 'res.partner', ids: [-81], values: { industry_id: 5 } },
      { model: 'res.partner', ids: [-81], values: { industry_id: false } },
    ]);
  });

  it('rejects a zero partner ID', async () => {
    const gateway = new MockGateway();
    gateway.fields['res.partner'] = {
      industry_id: { type: 'many2one', relation: 'res.partner.industry' },
    };
    gateway.reads['sale.order'] = [{ id: 42, partner_id: [0, 'Synthetic Customer'] }];

    await expect(loadIndustryContext(gateway, 42)).rejects.toMatchObject({
      code: 'incompatible_response',
    });
    expect(gateway.readCalls).toEqual([{ model: 'sale.order', ids: [42], fields: ['partner_id'] }]);
  });

  it('surfaces a failed industry write', async () => {
    const gateway = new MockGateway();
    gateway.writeResult = false;
    await expect(
      applyIndustryChange(
        gateway,
        { partnerId: 81, partnerName: 'Demo Customer', currentIndustryId: null, industries: [] },
        5,
      ),
    ).rejects.toMatchObject({ code: 'server_error' });
  });

  it('preserves a signed partner ID when safely undoing', async () => {
    const gateway = new MockGateway();
    const change = { partnerId: -81, before: 3, applied: 5 };
    gateway.reads['res.partner'] = [{ id: -81, industry_id: [5, 'Manufacturing'] }];
    await expect(undoIndustryChange(gateway, change)).resolves.toBe(true);
    gateway.reads['res.partner'] = [{ id: -81, industry_id: [7, 'Retail'] }];
    await expect(undoIndustryChange(gateway, change)).resolves.toBe(false);
    expect(gateway.readCalls).toEqual([
      { model: 'res.partner', ids: [-81], fields: ['industry_id'] },
      { model: 'res.partner', ids: [-81], fields: ['industry_id'] },
    ]);
    expect(gateway.writes).toEqual([
      { model: 'res.partner', ids: [-81], values: { industry_id: 3 } },
    ]);
  });
});
