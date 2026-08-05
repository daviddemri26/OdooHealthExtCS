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

  it('loads the exact subscription partner and dynamic choices', async () => {
    const gateway = new MockGateway();
    gateway.fields['res.partner'] = {
      industry_id: { type: 'many2one', relation: 'res.partner.industry' },
    };
    gateway.reads['sale.order'] = [{ id: 42, partner_id: [81, 'Demo Customer'] }];
    gateway.reads['res.partner'] = [{ id: 81, industry_id: [3, 'Technology'] }];
    gateway.searches['res.partner.industry'] = [
      { id: 3, name: 'Technology' },
      { id: 2, name: 'Education' },
    ];
    await expect(loadIndustryContext(gateway, 42)).resolves.toEqual({
      partnerId: 81,
      partnerName: 'Demo Customer',
      currentIndustryId: 3,
      industries: [
        { id: 2, name: 'Education' },
        { id: 3, name: 'Technology' },
      ],
    });
  });

  it('sets and clears industry using Odoo many2one values', async () => {
    const gateway = new MockGateway();
    const context = {
      partnerId: 81,
      partnerName: 'Demo Customer',
      currentIndustryId: 3,
      industries: [],
    };
    await applyIndustryChange(gateway, context, 5);
    await applyIndustryChange(gateway, context, null);
    expect(gateway.writes.map((write) => write.values)).toEqual([
      { industry_id: 5 },
      { industry_id: false },
    ]);
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

  it('undoes only if the customer value is still the applied value', async () => {
    const gateway = new MockGateway();
    const change = { partnerId: 81, before: 3, applied: 5 };
    gateway.reads['res.partner'] = [{ id: 81, industry_id: [5, 'Manufacturing'] }];
    await expect(undoIndustryChange(gateway, change)).resolves.toBe(true);
    gateway.reads['res.partner'] = [{ id: 81, industry_id: [7, 'Retail'] }];
    await expect(undoIndustryChange(gateway, change)).resolves.toBe(false);
    expect(gateway.writes).toHaveLength(1);
  });
});
