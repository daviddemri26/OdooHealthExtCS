import { describe, expect, it } from 'vitest';

import {
  CANONICAL_HEALTH_NAMES,
  ODOO_BRIDGE_CHANNEL,
  ODOO_BRIDGE_VERSION,
  isCustomerDataBridgeOperation,
  isOdooBridgeRequest,
  isRenewalBridgeOperation,
  parseCustomerDataUndoResult,
  parseHealthMutationResult,
  parseIndustryMutationResult,
  parseRenewalCreatedQuoteResult,
  parseRenewalDiscountApplyResult,
  parseRenewalDiscountClearResult,
  parseRenewalIntermediateCancellationResult,
  parseRenewalPreflightResult,
  parseRenewalQuoteSummary,
  parseRenewalShareLinkResult,
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

  it('accepts only the read operations required by Health and Industry', () => {
    const allowed: OdooBridgeCall[] = [
      call({
        method: 'fields_get',
        args: [],
        kwargs: {
          allfields: ['tag_ids'],
          attributes: ['type', 'relation', 'readonly', 'string'],
        },
      }),
      call({ args: [[42], ['partner_id']] }),
      call({ model: 'res.partner', args: [[7], ['industry_id']] }),
      call({ model: 'res.partner', args: [[-7], ['industry_id']] }),
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
    ];

    for (const operation of allowed)
      expect(validateOdooBridgeCall(operation)).toEqual({ ok: true });
  });

  it('accepts exact closed customer-data operations and response schemas', () => {
    const operations = [
      { name: 'applyHealthState', sourceOrderId: 42, nextState: 'medium' },
      {
        name: 'undoHealthState',
        sourceOrderId: 42,
        expectedAppliedHealthTagIds: [12],
        restoreHealthTagIds: [11],
      },
      { name: 'applyIndustry', sourceOrderId: 42, expectedPartnerId: -7, nextIndustryId: 9 },
      {
        name: 'undoIndustry',
        sourceOrderId: 42,
        expectedPartnerId: -7,
        expectedAppliedIndustryId: 9,
        restoreIndustryId: null,
      },
    ];
    for (const operation of operations) expect(isCustomerDataBridgeOperation(operation)).toBe(true);

    expect(
      isCustomerDataBridgeOperation({
        name: 'applyHealthState',
        sourceOrderId: 42,
        nextState: 'critical',
      }),
    ).toBe(false);
    expect(
      isCustomerDataBridgeOperation({
        name: 'applyIndustry',
        sourceOrderId: 42,
        expectedPartnerId: -7,
        nextIndustryId: 9,
        model: 'res.partner',
      }),
    ).toBe(false);
    expect(isCustomerDataBridgeOperation({ name: 'write', model: 'sale.order' })).toBe(false);

    const request = {
      channel: ODOO_BRIDGE_CHANNEL,
      version: ODOO_BRIDGE_VERSION,
      direction: 'request',
      clientId: 'client-12345678',
      requestId: 'request-12345678',
      kind: 'customerData',
      operation: operations[0],
    };
    expect(isOdooBridgeRequest(request)).toBe(true);
    expect(
      isOdooBridgeRequest({ ...request, operation: { ...operations[0], sourceOrderId: 0 } }),
    ).toBe(false);

    expect(
      parseHealthMutationResult(
        {
          sourceOrderId: 42,
          beforeHealthTagIds: [11],
          appliedHealthTagIds: [12],
          state: 'medium',
        },
        42,
      ),
    ).toEqual({
      sourceOrderId: 42,
      beforeHealthTagIds: [11],
      appliedHealthTagIds: [12],
      state: 'medium',
    });
    expect(
      parseHealthMutationResult(
        {
          sourceOrderId: 42,
          beforeHealthTagIds: [11],
          appliedHealthTagIds: [12, 13],
          state: 'medium',
        },
        42,
      ),
    ).toBeNull();
    expect(parseCustomerDataUndoResult({ restored: false })).toEqual({ restored: false });
    expect(
      parseIndustryMutationResult(
        {
          sourceOrderId: 42,
          partnerId: -7,
          beforeIndustryId: null,
          appliedIndustryId: 9,
        },
        42,
        -7,
      ),
    ).toEqual({
      sourceOrderId: 42,
      partnerId: -7,
      beforeIndustryId: null,
      appliedIndustryId: 9,
    });
  });

  it('accepts exact closed renewal operations and rejects generic or malformed variants', () => {
    const runId = 'renewal-12345678';
    expect(isRenewalBridgeOperation({ name: 'preflightRenewal', sourceOrderId: 42 })).toBe(true);
    expect(
      isRenewalBridgeOperation({
        name: 'createNativeRenewal',
        sourceOrderId: 42,
        runId,
        expected: {
          planId: 7,
          currentContractMonths: 12,
          writeDate: '2026-08-14 12:00:00',
        },
        requiredCopyYears: [1, 5],
        requiresDiscount: true,
        retention: 'selected',
      }),
    ).toBe(true);
    expect(
      isRenewalBridgeOperation({
        name: 'createNativeRenewal',
        sourceOrderId: 42,
        runId,
        expected: {
          planId: 7,
          currentContractMonths: 12,
          writeDate: '2026-08-14 12:00:00',
        },
        requiredCopyYears: [],
        requiresDiscount: false,
        retention: 'intermediate',
      }),
    ).toBe(true);
    expect(
      isRenewalBridgeOperation({
        name: 'applyNativeGlobalDiscount',
        quoteId: 81,
        percentageTenths: 65,
        runId,
      }),
    ).toBe(true);
    expect(isRenewalBridgeOperation({ name: 'finishRenewalRun', runId })).toBe(true);

    expect(
      isRenewalBridgeOperation({
        name: 'applyNativeGlobalDiscount',
        quoteId: 81,
        percentageTenths: 0,
        runId,
      }),
    ).toBe(false);
    const createOperation = {
      name: 'createNativeRenewal',
      sourceOrderId: 42,
      runId,
      expected: {
        planId: 7,
        currentContractMonths: 12,
        writeDate: '2026-08-14 12:00:00',
      },
      requiresDiscount: true,
      retention: 'selected',
    };
    expect(isRenewalBridgeOperation({ ...createOperation, requiredCopyYears: [5, 1] })).toBe(false);
    expect(isRenewalBridgeOperation({ ...createOperation, requiredCopyYears: [1, 1] })).toBe(false);
    expect(
      isRenewalBridgeOperation({
        ...createOperation,
        requiredCopyYears: [],
        requiresDiscount: 'true',
      }),
    ).toBe(false);
    expect(
      isRenewalBridgeOperation({
        name: 'createNativeRenewal',
        sourceOrderId: 42,
        runId,
        expected: createOperation.expected,
        requiredCopyYears: [],
      }),
    ).toBe(false);
    expect(
      isRenewalBridgeOperation({
        name: 'copyNativePlan',
        sourceQuoteId: 81,
        years: 6,
        runId,
        retention: 'selected',
      }),
    ).toBe(false);
    expect(isRenewalBridgeOperation({ name: 'cancelIntermediateRenewalQuotes', runId })).toBe(true);
    expect(
      isRenewalBridgeOperation({
        name: 'cancelIntermediateRenewalQuotes',
        runId,
        quoteIds: [81],
      }),
    ).toBe(false);
    expect(isRenewalBridgeOperation({ name: 'finishRenewalRun', runId, quoteId: 81 })).toBe(false);
    expect(isRenewalBridgeOperation({ name: 'finishRenewalRun', runId: 'foreign-run' })).toBe(
      false,
    );
    expect(
      isRenewalBridgeOperation({
        name: 'call',
        model: 'sale.order',
        method: 'prepare_renewal_order',
      }),
    ).toBe(false);
  });

  it('accepts only an exact versioned renewal request envelope', () => {
    const request = {
      channel: ODOO_BRIDGE_CHANNEL,
      version: ODOO_BRIDGE_VERSION,
      direction: 'request',
      clientId: 'client-12345678',
      requestId: 'request-12345678',
      kind: 'renewal',
      operation: { name: 'preflightRenewal', sourceOrderId: 42 },
    };

    expect(isOdooBridgeRequest(request)).toBe(true);
    expect(isOdooBridgeRequest({ ...request, model: 'sale.order' })).toBe(false);
    expect(
      isOdooBridgeRequest({
        ...request,
        operation: { ...request.operation, sourceOrderId: 0 },
      }),
    ).toBe(false);
  });

  it('parses each renewal response with an exact operation-specific schema', () => {
    const preflight = {
      eligible: true as const,
      sourceOrderId: 42,
      planId: 7,
      renewalQuoteCount: 6,
      writeDate: '2026-08-14 12:00:00',
      billingPeriodValue: 13,
      billingPeriodUnit: 'month',
      currentContractMonths: 13,
      allowedTargetYears: [2, 3, 4, 5],
    };
    expect(parseRenewalPreflightResult(preflight, 42)).toEqual(preflight);
    expect(parseRenewalPreflightResult({ ...preflight, renewalQuoteCount: -1 }, 42)).toBeNull();
    const missingCount: Record<string, unknown> = { ...preflight };
    delete missingCount.renewalQuoteCount;
    expect(parseRenewalPreflightResult(missingCount, 42)).toBeNull();
    expect(parseRenewalPreflightResult({ ...preflight, sourceOrderId: 43 }, 42)).toBeNull();
    expect(
      parseRenewalPreflightResult({ ...preflight, allowedTargetYears: [1, 2, 3, 4, 5] }, 42),
    ).toBeNull();
    expect(parseRenewalPreflightResult({ ...preflight, privateField: true }, 42)).toBeNull();
    expect(
      parseRenewalPreflightResult(
        { eligible: false, sourceOrderId: 42, reason: 'not-in-progress' },
        42,
      ),
    ).toEqual({ eligible: false, sourceOrderId: 42, reason: 'not-in-progress' });

    expect(parseRenewalCreatedQuoteResult({ quoteId: 82 }, 42)).toEqual({ quoteId: 82 });
    expect(
      parseRenewalCreatedQuoteResult({ quoteId: 82, reconciledAfterValidationFailure: true }, 42),
    ).toEqual({ quoteId: 82, reconciledAfterValidationFailure: true });
    expect(
      parseRenewalCreatedQuoteResult(
        {
          quoteId: 82,
          reconciledAfterTimeout: true,
          reconciledAfterValidationFailure: true,
        },
        42,
      ),
    ).toBeNull();
    expect(parseRenewalCreatedQuoteResult({ quoteId: 42 }, 42)).toBeNull();
    expect(parseRenewalCreatedQuoteResult({ quoteId: 82, action: {} }, 42)).toBeNull();
    expect(parseRenewalDiscountClearResult({ removedLineCount: 0 })).toEqual({
      removedLineCount: 0,
    });
    expect(parseRenewalDiscountClearResult({ removedLineCount: -1 })).toBeNull();
    expect(parseRenewalDiscountApplyResult({ createdLineCount: 1 })).toEqual({
      createdLineCount: 1,
    });
    expect(parseRenewalDiscountApplyResult({ createdLineCount: 0 })).toBeNull();
    expect(
      parseRenewalIntermediateCancellationResult({
        cancelledQuoteIds: [82, 83],
        alreadyCancelledQuoteIds: [84],
      }),
    ).toEqual({ cancelledQuoteIds: [82, 83], alreadyCancelledQuoteIds: [84] });
    expect(
      parseRenewalIntermediateCancellationResult({
        cancelledQuoteIds: [83, 82],
        alreadyCancelledQuoteIds: [],
      }),
    ).toBeNull();
    expect(
      parseRenewalIntermediateCancellationResult({
        cancelledQuoteIds: [82],
        alreadyCancelledQuoteIds: [82],
      }),
    ).toBeNull();

    const shareLink =
      'https://www.odoo.com/mail/view?model=sale.order&res_id=82&access_token=secret-token';
    expect(parseRenewalShareLinkResult({ quoteId: 82, shareLink }, 82)).toEqual({
      quoteId: 82,
      shareLink,
    });
    expect(
      parseRenewalShareLinkResult(
        { quoteId: 82, shareLink: 'https://example.com/mail/view?res_id=82' },
        82,
      ),
    ).toBeNull();
  });

  it('parses a bounded renewal summary and rejects inconsistent line metadata', () => {
    const summary = {
      quoteId: 82,
      createdFromQuoteId: 42,
      name: 'SO2026/82',
      state: 'draft',
      subscriptionState: '2_renewal',
      planId: 8,
      billingPeriodValue: 5,
      billingPeriodUnit: 'year',
      currentContractMonths: 60,
      templateId: 11,
      currencyId: 2,
      currencyRounding: 0.01,
      amountUntaxed: 90,
      amountTax: 0,
      amountTotal: 90,
      lineCount: 2,
      multiYearDiscountLineCount: 1,
      lines: [
        {
          lineId: 101,
          productId: 5,
          sequence: 10,
          quantity: 1,
          unitPrice: 100,
          subtotal: 100,
          total: 100,
          taxIds: [],
          isMultiYearDiscount: false,
        },
        {
          lineId: 102,
          productId: 9,
          sequence: 999,
          quantity: 1,
          unitPrice: -10,
          subtotal: -10,
          total: -10,
          taxIds: [],
          isMultiYearDiscount: true,
        },
      ],
    };
    expect(parseRenewalQuoteSummary(summary, 82)).toEqual(summary);
    expect(parseRenewalQuoteSummary({ ...summary, quoteId: 83 }, 82)).toBeNull();
    expect(parseRenewalQuoteSummary({ ...summary, lineCount: 1 }, 82)).toBeNull();
    expect(parseRenewalQuoteSummary({ ...summary, multiYearDiscountLineCount: 0 }, 82)).toBeNull();
    expect(
      parseRenewalQuoteSummary(
        { ...summary, lines: [summary.lines[0], { ...summary.lines[1], lineId: 101 }] },
        82,
      ),
    ).toBeNull();
    expect(parseRenewalQuoteSummary({ ...summary, partnerId: 999 }, 82)).toBeNull();
  });

  it.each([
    call({ model: 'res.users' }),
    call({ method: 'unlink' }),
    call({ args: [[42], ['amount_total']] }),
    call({ args: [[42], ['tag_ids', 'partner_id', 'subscription_state']] }),
    call({ args: [[42, 43], ['tag_ids']] }),
    call({ args: [[-42], ['tag_ids']] }),
    call({ model: 'res.partner', args: [[0], ['industry_id']] }),
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
    call({ method: 'write', args: [[42], { tag_ids: [[6, 0, [11]]] }] }),
    call({ model: 'res.partner', method: 'write', args: [[7], { industry_id: 9 }] }),
    call({ method: 'write', args: [[42], { tag_ids: [[4, 99]] }] }),
    call({ method: 'write', args: [[42], { tag_ids: [[6, 0, [-99]]] }] }),
    call({ method: 'write', args: [[42], { tag_ids: [[6, 0, []]], amount_total: 0 }] }),
    call({ model: 'res.partner', method: 'write', args: [[7], { industry_id: '9' }] }),
    call({ model: 'res.partner', method: 'write', args: [[-7], { industry_id: -9 }] }),
  ])('rejects an operation outside the exact allow-list', (operation) => {
    expect(validateOdooBridgeCall(operation)).toMatchObject({
      ok: false,
      failure: { code: 'incompatible_endpoint' },
    });
  });
});
