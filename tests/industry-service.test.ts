import { describe, expect, it, vi } from 'vitest';

import {
  applyIndustryChange,
  loadIndustryContext,
  undoIndustryChange,
} from '../src/features/industry/service';
import { OdooGatewayError } from '../src/odoo/gateway';
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
    expect(gateway.customerDataCalls).toHaveLength(0);
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

  it('preserves a signed partner ID in closed set and clear operations', async () => {
    const gateway = new MockGateway();
    const context = {
      partnerId: -81,
      partnerName: 'Synthetic Customer',
      currentIndustryId: 3,
      industries: [],
    };
    gateway.reads['res.partner'] = [{ id: -81, industry_id: [3, 'Technology'] }];
    await applyIndustryChange(gateway, 42, context, 5);
    await applyIndustryChange(gateway, 42, context, null);
    expect(gateway.customerDataCalls).toEqual([
      {
        name: 'applyIndustry',
        sourceOrderId: 42,
        expectedPartnerId: -81,
        nextIndustryId: 5,
      },
      {
        name: 'applyIndustry',
        sourceOrderId: 42,
        expectedPartnerId: -81,
        nextIndustryId: null,
      },
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
    vi.spyOn(gateway, 'applyIndustry').mockRejectedValue(
      new OdooGatewayError('server_error', 'Odoo could not complete the request.'),
    );
    await expect(
      applyIndustryChange(
        gateway,
        42,
        { partnerId: 81, partnerName: 'Demo Customer', currentIndustryId: null, industries: [] },
        5,
      ),
    ).rejects.toMatchObject({ code: 'server_error' });
  });

  it('preserves a signed partner ID when safely undoing', async () => {
    const gateway = new MockGateway();
    const change = { sourceOrderId: 42, partnerId: -81, before: 3, applied: 5 };
    await expect(undoIndustryChange(gateway, change)).resolves.toBe(true);
    gateway.industryUndoResult = false;
    await expect(undoIndustryChange(gateway, change)).resolves.toBe(false);
    expect(gateway.customerDataCalls).toEqual([
      {
        name: 'undoIndustry',
        sourceOrderId: 42,
        expectedPartnerId: -81,
        expectedAppliedIndustryId: 5,
        restoreIndustryId: 3,
      },
      {
        name: 'undoIndustry',
        sourceOrderId: 42,
        expectedPartnerId: -81,
        expectedAppliedIndustryId: 5,
        restoreIndustryId: 3,
      },
    ]);
  });
});
