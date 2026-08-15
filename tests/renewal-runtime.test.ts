import { describe, expect, it, vi } from 'vitest';

import { ODOO_BRIDGE_ORIGIN, bridgeFailure } from '../src/odoo/bridge-protocol';
import {
  RENEWAL_END_TO_END_TIMEOUT_BUDGET_MS,
  RENEWAL_GATEWAY_SAFETY_MARGIN_MS,
  RENEWAL_GATEWAY_TIMEOUT_MS,
  RENEWAL_RECONCILIATION_DELAY_MS,
  RENEWAL_RECONCILIATION_TIMEOUT_MS,
  RENEWAL_RUNTIME_TIMEOUT_MS,
} from '../src/odoo/renewal-contracts';
import {
  RenewalOwnershipRegistry,
  executeOdooRenewalOperation,
  type RenewalOwnedQuoteFingerprint,
} from '../src/odoo/renewal-runtime';

interface RpcStep {
  path: string;
  result?: unknown;
  error?: unknown;
}

function jsonResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'request-renewal', result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function queuedFetcher(steps: RpcStep[]): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected RPC request to ${String(input)}`);
    expect(String(input)).toBe(`${ODOO_BRIDGE_ORIGIN}${step.path}`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ jsonrpc: '2.0', method: 'call' });
    if ('error' in step) throw step.error;
    return jsonResponse(step.result);
  });
}

function orderFieldDefinitions(): Record<string, unknown> {
  return {
    state: { type: 'selection' },
    subscription_state: { type: 'selection' },
    is_subscription: { type: 'boolean' },
    plan_id: { type: 'many2one', relation: 'sale.subscription.plan' },
    write_date: { type: 'datetime' },
    renewal_count: { type: 'integer' },
  };
}

function planFieldDefinitions(): Record<string, unknown> {
  return {
    billing_period_value: { type: 'integer' },
    billing_period_unit: { type: 'selection' },
  };
}

function currencyRoundingSteps(currencyId = 2, rounding = 0.01): RpcStep[] {
  return [
    {
      path: '/web/dataset/call_kw/res.currency/fields_get',
      result: { rounding: { type: 'float' } },
    },
    {
      path: '/web/dataset/call_kw/res.currency/read',
      result: [{ id: currencyId, rounding }],
    },
  ];
}

function ownershipFieldDefinitions(): Record<string, unknown> {
  return {
    state: { type: 'selection' },
    subscription_state: { type: 'selection' },
    is_subscription: { type: 'boolean' },
    subscription_id: { type: 'many2one', relation: 'sale.order' },
    origin_order_id: { type: 'many2one', relation: 'sale.order' },
    partner_id: { type: 'many2one', relation: 'res.partner' },
    company_id: { type: 'many2one', relation: 'res.company' },
    currency_id: { type: 'many2one', relation: 'res.currency' },
    pricelist_id: { type: 'many2one', relation: 'product.pricelist' },
    create_date: { type: 'datetime' },
    write_date: { type: 'datetime' },
    plan_id: { type: 'many2one', relation: 'sale.subscription.plan' },
    sale_order_template_id: { type: 'many2one', relation: 'sale.order.template' },
    order_line: { type: 'one2many', relation: 'sale.order.line' },
  };
}

function lineFieldDefinitions(): Record<string, unknown> {
  return {
    order_id: { type: 'many2one', relation: 'sale.order' },
    product_id: { type: 'many2one', relation: 'product.product' },
    display_type: { type: 'selection' },
    name: { type: 'text' },
    sequence: { type: 'integer' },
    product_uom_qty: { type: 'float' },
    price_unit: { type: 'float' },
    price_subtotal: { type: 'monetary' },
    price_total: { type: 'monetary' },
    tax_ids: { type: 'many2many', relation: 'account.tax' },
    extra_tax_data: { type: 'json' },
    write_date: { type: 'datetime' },
  };
}

function discountWizardAction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'ir.actions.act_window',
    res_model: 'sale.order.discount',
    target: 'new',
    ...overrides,
  };
}

function discountWizardFieldDefinitions(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sale_order_id: { type: 'many2one', relation: 'sale.order', required: true },
    discount_type: {
      type: 'selection',
      selection: [
        ['so_discount', 'Global Discount'],
        ['amount', 'Fixed Amount'],
      ],
    },
    discount_percentage: { type: 'float' },
    discount_description: { type: 'text' },
    ...overrides,
  };
}

function discountWizardPreflightSteps(
  actionOverrides: Record<string, unknown> = {},
  fieldOverrides: Record<string, unknown> = {},
): RpcStep[] {
  return [
    {
      path: '/web/dataset/call_button/sale.order/action_open_discount_wizard',
      result: discountWizardAction(actionOverrides),
    },
    {
      path: '/web/dataset/call_kw/sale.order.discount/fields_get',
      result: discountWizardFieldDefinitions(fieldOverrides),
    },
  ];
}

function ownedFingerprint(
  parentQuoteId: number,
  currentContractMonths: number,
  rootSourceOrderId = 42,
  createDate = '2026-08-14 13:00:00',
  options: {
    originRootOrderId?: number;
    planId?: number;
    templateId?: number;
    templateClass?: 'standard' | 'custom';
    lineRecords?: Record<string, unknown>[];
  } = {},
): RenewalOwnedQuoteFingerprint {
  const planId = options.planId ?? (currentContractMonths === 60 ? 8 : 7);
  const lineState = testLineState(options.lineRecords ?? []);
  return {
    rootSourceOrderId,
    originRootOrderId: options.originRootOrderId ?? rootSourceOrderId,
    parentQuoteId,
    partnerId: 20,
    companyId: 3,
    currencyId: 2,
    pricelistId: 4,
    planId,
    templateId: options.templateId ?? 80 + planId,
    templateClass: options.templateClass ?? 'custom',
    currencyRounding: 0.01,
    createDate,
    writeDate: createDate,
    currentContractMonths,
    lineFingerprint: lineState.fingerprint,
    commercialLines: lineState.commercialLines,
  };
}

function testLineState(lineRecords: Record<string, unknown>[]): {
  fingerprint: string;
  commercialLines: RenewalOwnedQuoteFingerprint['commercialLines'];
} {
  const normalized = lineRecords
    .map((record) => {
      const product = record.product_id as false | [number, string];
      const displayType = typeof record.display_type === 'string' ? record.display_type : null;
      const extraTaxData = JSON.stringify(record.extra_tax_data ?? null);
      const computationKey = (record.extra_tax_data as { computation_key?: unknown } | null)
        ?.computation_key;
      return {
        id: Number(record.id),
        productId: product ? product[0] : null,
        displayType,
        name: String(record.name),
        sequence: Number(record.sequence),
        quantity: Number(record.product_uom_qty),
        unitPrice: Number(record.price_unit),
        subtotal: Number(record.price_subtotal),
        total: Number(record.price_total),
        taxIds: [...((record.tax_ids as number[]) ?? [])].sort((left, right) => left - right),
        extraTaxData,
        isNativeGlobalDiscount:
          typeof computationKey === 'string' && /^global_discount,[1-9]\d*$/.test(computationKey),
        writeDate: String(record.write_date),
      };
    })
    .sort((left, right) => left.id - right.id);
  return {
    fingerprint: JSON.stringify(normalized),
    commercialLines: normalized.map((record) => ({
      productId: record.productId,
      displayType: record.displayType,
      name: record.name,
      sequence: record.sequence,
      quantity: record.quantity,
      unitPrice: record.unitPrice,
      subtotal: record.subtotal,
      total: record.total,
      taxIds: [...record.taxIds],
      isNativeGlobalDiscount: record.isNativeGlobalDiscount,
    })),
  };
}

function sourceCommercialSteps(orderId: number): RpcStep[] {
  return [
    {
      path: '/web/dataset/call_kw/sale.order/read',
      result: [
        {
          id: orderId,
          partner_id: [20, 'Private customer'],
          company_id: [3, 'Odoo Inc.'],
          currency_id: [2, 'USD'],
          pricelist_id: [4, 'Private pricelist'],
          origin_order_id: false,
          plan_id: [7, 'Private plan'],
          sale_order_template_id: [87, 'Private template'],
          order_line: [],
        },
      ],
    },
  ];
}

function sourceCommercialLineSteps(
  orderId: number,
  lineRecord: Record<string, unknown>,
): RpcStep[] {
  return [
    {
      path: '/web/dataset/call_kw/sale.order/read',
      result: [
        {
          id: orderId,
          partner_id: [20, 'Private customer'],
          company_id: [3, 'Odoo Inc.'],
          currency_id: [2, 'USD'],
          pricelist_id: [4, 'Private pricelist'],
          origin_order_id: false,
          plan_id: [7, 'Private plan'],
          sale_order_template_id: [87, 'Private template'],
          order_line: [lineRecord.id],
        },
      ],
    },
    {
      path: '/web/dataset/call_kw/sale.order.line/read',
      result: [lineRecord],
    },
  ];
}

function linkedRenewalSteps(ids: number[]): RpcStep[] {
  return [
    {
      path: '/web/dataset/call_kw/sale.order/search_read',
      result: ids.map((id) => ({ id })),
    },
  ];
}

function templateValidationSteps(
  planId: number,
  templateId = 80 + planId,
  templateClass: 'standard' | 'custom' = 'custom',
): RpcStep[] {
  const customTemplateId = templateClass === 'custom' ? templateId : templateId + 1;
  return [
    {
      path: '/web/dataset/call_kw/sale.order.template/fields_get',
      result: {
        plan_id: { type: 'many2one', relation: 'sale.subscription.plan' },
        custom_plan_id: { type: 'many2one', relation: 'sale.order.template' },
      },
    },
    {
      path: '/web/dataset/call_kw/sale.order.template/search_read',
      result:
        templateClass === 'custom'
          ? [
              {
                id: templateId,
                plan_id: [planId, 'Private plan'],
                custom_plan_id: false,
              },
            ]
          : [
              {
                id: templateId,
                plan_id: [planId, 'Private plan'],
                custom_plan_id: [customTemplateId, 'Private custom template'],
              },
              {
                id: customTemplateId,
                plan_id: [planId, 'Private plan'],
                custom_plan_id: false,
              },
            ],
    },
  ];
}

function copyActionName(years: 1 | 2 | 3 | 4 | 5): string {
  return years === 1 ? 'Copy to Yearly' : `Copy to ${years} Years`;
}

type CopyYear = 1 | 2 | 3 | 4 | 5;

function copyActionBindings(
  yearsToInclude: readonly CopyYear[] = [1, 2, 3, 4, 5],
): Record<string, unknown>[] {
  return yearsToInclude.map((years) => ({
    id: 9300 + years,
    name: copyActionName(years),
    binding_view_types: 'list,form',
  }));
}

function copyActionResolutionSteps(
  requiredYears: readonly CopyYear[],
  loadedOverride?: (years: CopyYear) => Record<string, unknown>,
  bindingYears: readonly CopyYear[] = requiredYears,
): RpcStep[] {
  return [
    {
      path: '/web/dataset/call_kw/ir.actions.actions/get_bindings',
      result: { action: copyActionBindings(bindingYears) },
    },
    ...requiredYears.map((years): RpcStep => ({
      path: '/web/action/load',
      result: {
        id: 9300 + years,
        name: copyActionName(years),
        type: 'ir.actions.server',
        model_name: 'sale.order',
        binding_type: 'action',
        binding_model_id: [17, 'Sales Order'],
        binding_view_types: 'list,form',
        xml_id: null,
        ...loadedOverride?.(years),
      },
    })),
  ];
}

function ownedQuoteVerificationSteps(
  orderId: number,
  planId: number,
  periodValue: number,
  periodUnit: 'month' | 'year',
  rootSourceOrderId = 42,
  createDate = '2026-08-14 13:00:00',
  options: {
    originRootOrderId?: number;
    templateId?: number;
    lineRecords?: Record<string, unknown>[];
  } = {},
): RpcStep[] {
  const lineRecords = options.lineRecords ?? [];
  return [
    {
      path: '/web/dataset/call_kw/sale.order/read',
      result: [
        {
          id: orderId,
          state: 'draft',
          subscription_state: '2_renewal',
          is_subscription: true,
          subscription_id: [rootSourceOrderId, 'Private source'],
          origin_order_id: [options.originRootOrderId ?? rootSourceOrderId, 'Private origin'],
          partner_id: [20, 'Private customer'],
          company_id: [3, 'Odoo Inc.'],
          currency_id: [2, 'USD'],
          pricelist_id: [4, 'Private pricelist'],
          create_date: createDate,
          write_date: createDate,
          plan_id: [planId, 'Private plan label'],
          sale_order_template_id: [options.templateId ?? 80 + planId, 'Private template'],
          order_line: lineRecords.map((record) => record.id),
        },
      ],
    },
    {
      path: '/web/dataset/call_kw/sale.subscription.plan/fields_get',
      result: planFieldDefinitions(),
    },
    {
      path: '/web/dataset/call_kw/sale.subscription.plan/read',
      result: [
        {
          id: planId,
          billing_period_value: periodValue,
          billing_period_unit: periodUnit,
        },
      ],
    },
    ...(lineRecords.length > 0
      ? [
          {
            path: '/web/dataset/call_kw/sale.order.line/read',
            result: lineRecords,
          },
        ]
      : []),
  ];
}

function preflightSteps(
  orderId: number,
  planId: number,
  periodValue: number,
  periodUnit: 'month' | 'year',
  orderOverrides: Record<string, unknown> = {},
): RpcStep[] {
  return [
    {
      path: '/web/dataset/call_kw/sale.order/fields_get',
      result: orderFieldDefinitions(),
    },
    {
      path: '/web/dataset/call_kw/sale.order/read',
      result: [
        {
          id: orderId,
          state: 'sale',
          subscription_state: '3_progress',
          is_subscription: true,
          plan_id: [planId, 'Private plan label'],
          write_date: '2026-08-14 12:00:00',
          renewal_count: 6,
          ...orderOverrides,
        },
      ],
    },
    {
      path: '/web/dataset/call_kw/sale.subscription.plan/fields_get',
      result: planFieldDefinitions(),
    },
    {
      path: '/web/dataset/call_kw/sale.subscription.plan/read',
      result: [
        {
          id: planId,
          billing_period_value: periodValue,
          billing_period_unit: periodUnit,
        },
      ],
    },
  ];
}

function nativeCreationPreludeSteps(
  existingQuoteIds: number[] = [70, 71],
  requiresDiscount = true,
): RpcStep[] {
  return [
    ...preflightSteps(42, 7, 1, 'year'),
    {
      path: '/web/dataset/call_kw/sale.order/fields_get',
      result: ownershipFieldDefinitions(),
    },
    {
      path: '/web/dataset/call_kw/sale.order.line/fields_get',
      result: lineFieldDefinitions(),
    },
    ...(requiresDiscount ? discountWizardPreflightSteps() : []),
    ...sourceCommercialSteps(42),
    ...linkedRenewalSteps(existingQuoteIds),
    ...preflightSteps(42, 7, 1, 'year'),
    ...sourceCommercialSteps(42),
    ...templateValidationSteps(7, 87),
    ...currencyRoundingSteps(),
  ];
}

function line(
  id: number,
  productId: number,
  productName: string,
  price: number,
): Record<string, unknown> {
  return {
    id,
    order_id: [82, 'Q'],
    product_id: [productId, `Product ${productId}`],
    display_type: false,
    name: productName,
    sequence: productId === 9 ? 999 : 10,
    product_uom_qty: 1,
    price_unit: price,
    price_subtotal: price,
    price_total: price,
    tax_ids: [],
    extra_tax_data:
      productId === 9 ? { computation_key: `global_discount,${id}` } : { tax_details: {} },
    write_date: '2026-08-14 13:00:00',
  };
}

function quoteLinesSteps(lineIds: number[], lines: Record<string, unknown>[]): RpcStep[] {
  return [
    {
      path: '/web/dataset/call_kw/sale.order/fields_get',
      result: {
        state: { type: 'selection' },
        order_line: { type: 'one2many', relation: 'sale.order.line' },
      },
    },
    {
      path: '/web/dataset/call_kw/sale.order/read',
      result: [
        {
          id: 82,
          state: 'draft',
          order_line: lineIds,
        },
      ],
    },
    ...(lineIds.length > 0
      ? [
          {
            path: '/web/dataset/call_kw/sale.order.line/read',
            result: lines,
          },
        ]
      : []),
  ];
}

const clientId = 'client-renewal-tests';
const runId = 'renewal-12345678';

describe('closed renewal bridge runtime', () => {
  it('keeps the fixed runtime and reconciliation budgets inside the gateway safety margin', () => {
    expect(RENEWAL_RUNTIME_TIMEOUT_MS).toBe(45_000);
    expect(RENEWAL_RECONCILIATION_DELAY_MS).toBe(1_500);
    expect(RENEWAL_RECONCILIATION_TIMEOUT_MS).toBe(10_000);
    expect(RENEWAL_GATEWAY_TIMEOUT_MS).toBe(75_000);
    expect(
      RENEWAL_GATEWAY_TIMEOUT_MS - RENEWAL_END_TO_END_TIMEOUT_BUDGET_MS,
    ).toBeGreaterThanOrEqual(RENEWAL_GATEWAY_SAFETY_MARGIN_MS);
  });

  it('reads the technical billing period and offers only equal or longer years', async () => {
    const steps = preflightSteps(42, 7, 13, 'month');
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        { name: 'preflightRenewal', sourceOrderId: 42 },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId },
      ),
    ).resolves.toEqual({
      ok: true,
      result: {
        eligible: true,
        sourceOrderId: 42,
        planId: 7,
        renewalQuoteCount: 6,
        billingPeriodValue: 13,
        billingPeriodUnit: 'month',
        currentContractMonths: 13,
        writeDate: '2026-08-14 12:00:00',
        allowedTargetYears: [2, 3, 4, 5],
      },
    });
    expect(steps).toHaveLength(0);
  });

  it('reports a normal server-side ineligibility when the source is not in progress', async () => {
    const steps = preflightSteps(42, 7, 1, 'year', {
      subscription_state: '4_paused',
    }).slice(0, 2);
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        { name: 'preflightRenewal', sourceOrderId: 42 },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId },
      ),
    ).resolves.toEqual({
      ok: true,
      result: { eligible: false, sourceOrderId: 42, reason: 'not-in-progress' },
    });
    expect(steps).toHaveLength(0);
  });

  it('rejects an invalid native renewal counter in the existing preflight read', async () => {
    const steps = preflightSteps(42, 7, 1, 'year', { renewal_count: -1 }).slice(0, 2);
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        { name: 'preflightRenewal', sourceOrderId: 42 },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_response' } });
    expect(steps).toHaveLength(0);
  });

  it('returns an explicit fail-closed message when the billing period is unsupported', async () => {
    const steps = preflightSteps(42, 7, 1, 'year');
    steps[3] = {
      path: '/web/dataset/call_kw/sale.subscription.plan/read',
      result: [{ id: 7, billing_period_value: 1, billing_period_unit: 'week' }],
    };
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        { name: 'preflightRenewal', sourceOrderId: 42 },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId },
      ),
    ).resolves.toEqual({
      ok: false,
      failure: {
        code: 'incompatible_response',
        message: 'The current contract duration could not be verified. No quotation was created.',
      },
    });
    expect(steps).toHaveLength(0);
  });

  it('creates a native renewal only from the unchanged source fingerprint', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...preflightSteps(42, 7, 1, 'year'),
      {
        path: '/web/dataset/call_kw/sale.order/fields_get',
        result: ownershipFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/sale.order.line/fields_get',
        result: lineFieldDefinitions(),
      },
      ...discountWizardPreflightSteps(),
      ...sourceCommercialSteps(42),
      ...linkedRenewalSteps([70, 71]),
      ...preflightSteps(42, 7, 1, 'year'),
      ...sourceCommercialSteps(42),
      ...templateValidationSteps(7, 87),
      ...currencyRoundingSteps(),
      {
        path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
        result: {
          type: 'ir.actions.act_window',
          res_model: 'sale.order',
          res_id: 82,
          context: { private: 'does not cross' },
        },
      },
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { quoteId: 82 } });
    expect(steps).toHaveLength(0);

    const unauthorizedFetcher = vi.fn<typeof fetch>();
    await expect(
      executeOdooRenewalOperation(
        { name: 'getNativeShareLink', quoteId: 82, runId: 'renewal-foreign1' },
        {
          fetcher: unauthorizedFetcher,
          origin: ODOO_BRIDGE_ORIGIN,
          clientId,
          ownership,
        },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_endpoint' } });
    expect(unauthorizedFetcher).not.toHaveBeenCalled();
  });

  it('finishes only the requested run and revokes its quotes and resolved Copy actions', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const secondRunId = 'renewal-secondrun1';
    ownership.register(clientId, runId, 82, ownedFingerprint(42, 12));
    ownership.registerCopyAction(clientId, runId, 5, 9305);
    ownership.beginCreation(clientId, runId, {
      rootSourceOrderId: 42,
      originRootOrderId: 42,
      parentQuoteId: 82,
      expectedIdentity: { partnerId: 20, companyId: 3, currencyId: 2, pricelistId: 4 },
      expectedMonths: 60,
      sourceMonths: 12,
      expectedTemplateClass: 'custom',
      expectedTemplateId: null,
      currencyRounding: 0.01,
      sourceCommercialLines: [],
      compareNativeDiscountLines: false,
      priceMode: 'duration-scale',
      existingLinkedQuoteIds: new Set([70, 71, 82]),
    });
    ownership.register(clientId, secondRunId, 83, ownedFingerprint(42, 24));
    ownership.registerCopyAction(clientId, secondRunId, 3, 9303);
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      executeOdooRenewalOperation(
        { name: 'finishRenewalRun', runId },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: true });
    expect(fetcher).not.toHaveBeenCalled();
    expect(ownership.getPendingCreation(clientId, runId)).toBeNull();

    await expect(
      executeOdooRenewalOperation(
        { name: 'copyNativePlan', sourceQuoteId: 82, years: 5, runId },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_endpoint' } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(ownership.require(clientId, secondRunId, 83)).toMatchObject({
      rootSourceOrderId: 42,
      currentContractMonths: 24,
    });
    expect(ownership.requireCopyAction(clientId, secondRunId, 3)).toBe(9303);

    // Cleanup is idempotent and the same opaque run identifier may be safely reused only after
    // its prior authority has been revoked.
    await expect(
      executeOdooRenewalOperation(
        { name: 'finishRenewalRun', runId },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: true });
    ownership.register(clientId, runId, 84, ownedFingerprint(42, 36));
    ownership.registerCopyAction(clientId, runId, 4, 9304);
    expect(ownership.require(clientId, runId, 84).currentContractMonths).toBe(36);
    expect(ownership.requireCopyAction(clientId, runId, 4)).toBe(9304);
  });

  it.each([
    {
      label: 'the wizard action type is not a window action',
      wizardSteps: discountWizardPreflightSteps({ type: 'ir.actions.client' }).slice(0, 1),
    },
    {
      label: 'the wizard action model is not the native discount wizard',
      wizardSteps: discountWizardPreflightSteps({ res_model: 'res.partner' }).slice(0, 1),
    },
    {
      label: 'the wizard action target is not modal',
      wizardSteps: discountWizardPreflightSteps({ target: 'current' }).slice(0, 1),
    },
    {
      label: 'the wizard sale order field is not required',
      wizardSteps: discountWizardPreflightSteps(
        {},
        {
          sale_order_id: { type: 'many2one', relation: 'sale.order', required: false },
        },
      ),
    },
    {
      label: 'the wizard discount selection excludes the native global discount',
      wizardSteps: discountWizardPreflightSteps(
        {},
        {
          discount_type: { type: 'selection', selection: [['amount', 'Fixed Amount']] },
        },
      ),
    },
    {
      label: 'the custom description field is not text',
      wizardSteps: discountWizardPreflightSteps(
        {},
        {
          discount_description: { type: 'char' },
        },
      ),
    },
  ])('rejects before native Renew when $label', async ({ wizardSteps }) => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...preflightSteps(42, 7, 1, 'year'),
      {
        path: '/web/dataset/call_kw/sale.order/fields_get',
        result: ownershipFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/sale.order.line/fields_get',
        result: lineFieldDefinitions(),
      },
      ...wizardSteps,
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_response' } });
    expect(
      (fetcher as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).endsWith('/sale.order/prepare_renewal_order'),
      ),
    ).toBe(false);
    expect(steps).toHaveLength(0);
  });

  it('does not require the Discount wizard contract for an all-zero run', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...nativeCreationPreludeSteps([70, 71], false),
      {
        path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
        result: { type: 'ir.actions.act_window', res_model: 'sale.order', res_id: 82 },
      },
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
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
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { quoteId: 82 } });
    expect(
      (fetcher as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).endsWith('/sale.order/action_open_discount_wizard'),
      ),
    ).toBe(false);
    expect(steps).toHaveLength(0);
  });

  it('rejects a missing required Copy action before invoking native Renew', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...preflightSteps(42, 7, 1, 'year'),
      {
        path: '/web/dataset/call_kw/sale.order/fields_get',
        result: ownershipFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/sale.order.line/fields_get',
        result: lineFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/ir.actions.actions/get_bindings',
        result: {
          action: [
            {
              id: 9303,
              name: 'Copy to 3 Years',
              binding_view_types: 'list,form',
            },
          ],
        },
      },
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [5],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_response' } });
    expect(
      (fetcher as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).endsWith('/sale.order/prepare_renewal_order'),
      ),
    ).toBe(false);
    expect(steps).toHaveLength(0);
  });

  it('ignores an exact-name Copy homonym for an unrelated year', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...preflightSteps(42, 7, 1, 'year'),
      {
        path: '/web/dataset/call_kw/sale.order/fields_get',
        result: ownershipFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/sale.order.line/fields_get',
        result: lineFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/ir.actions.actions/get_bindings',
        result: {
          action: [
            ...copyActionBindings(),
            {
              id: 9999,
              name: 'Copy to 3 Years',
              binding_view_types: 'list,form',
            },
          ],
        },
      },
      {
        path: '/web/action/load',
        result: {
          id: 9305,
          name: 'Copy to 5 Years',
          type: 'ir.actions.client',
          model_name: 'sale.order',
          binding_type: 'action',
          binding_model_id: [17, 'Sales Order'],
          binding_view_types: 'list,form',
          xml_id: null,
        },
      },
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [5],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_response' } });
    const actionCalls = (fetcher as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes('/web/action/'),
    );
    expect(actionCalls).toHaveLength(1);
    expect(JSON.parse(String(actionCalls[0]?.[1]?.body))).toMatchObject({
      params: { action_id: 9305 },
    });
    expect(steps).toHaveLength(0);
  });

  it('resolves only the required Copy action once in en_US and reuses it from a French page run', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...preflightSteps(42, 7, 1, 'year'),
      {
        path: '/web/dataset/call_kw/sale.order/fields_get',
        result: ownershipFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/sale.order.line/fields_get',
        result: lineFieldDefinitions(),
      },
      ...copyActionResolutionSteps([5]),
      ...discountWizardPreflightSteps(),
      ...sourceCommercialSteps(42),
      ...linkedRenewalSteps([70, 71]),
      ...preflightSteps(42, 7, 1, 'year'),
      ...sourceCommercialSteps(42),
      ...templateValidationSteps(7, 87),
      ...currencyRoundingSteps(),
      {
        path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
        result: { type: 'ir.actions.act_window', res_model: 'sale.order', res_id: 82 },
      },
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      ...linkedRenewalSteps([70, 71, 82]),
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      {
        path: '/web/action/run',
        result: { type: 'ir.actions.act_window', res_model: 'sale.order', res_id: 83 },
      },
      ...ownedQuoteVerificationSteps(83, 8, 5, 'year', 42, '2026-08-14 13:01:00'),
      ...templateValidationSteps(8, 88),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [5],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { quoteId: 82 } });
    await expect(
      executeOdooRenewalOperation(
        { name: 'copyNativePlan', sourceQuoteId: 82, years: 5, runId },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { quoteId: 83 } });

    const calls = (fetcher as ReturnType<typeof vi.fn>).mock.calls;
    const bindingCalls = calls.filter((call) => String(call[0]).endsWith('/get_bindings'));
    expect(bindingCalls).toHaveLength(1);
    expect(calls.some((call) => String(call[0]).includes('/call_kw/ir.model/'))).toBe(false);
    const bindingBody = JSON.parse(String(bindingCalls[0]?.[1]?.body)) as {
      params: { kwargs: { context: { lang: string } } };
    };
    expect(bindingBody.params.kwargs.context.lang).toBe('en_US');
    const actionCalls = calls.filter((call) => String(call[0]).includes('/web/action/'));
    expect(actionCalls).toHaveLength(2);
    for (const call of actionCalls) {
      const body = JSON.parse(String(call[1]?.body)) as {
        params: { context: { lang: string } };
      };
      expect(body.params.context.lang).toBe('en_US');
    }
    expect(steps).toHaveLength(0);
  });

  it('rechecks the source line fingerprint immediately before native Renew', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const initialLine = {
      ...line(201, 5, 'Custom Plan\nPersisted source line', 100),
      order_id: [42, 'Source'],
    };
    const changedLine = {
      ...initialLine,
      product_uom_qty: 2,
      write_date: '2026-08-14 13:00:01',
    };
    const steps: RpcStep[] = [
      ...preflightSteps(42, 7, 1, 'year'),
      {
        path: '/web/dataset/call_kw/sale.order/fields_get',
        result: ownershipFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/sale.order.line/fields_get',
        result: lineFieldDefinitions(),
      },
      ...discountWizardPreflightSteps(),
      ...sourceCommercialLineSteps(42, initialLine),
      ...linkedRenewalSteps([70, 71]),
      ...preflightSteps(42, 7, 1, 'year'),
      ...sourceCommercialLineSteps(42, changedLine),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_response' } });
    expect(
      (fetcher as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).endsWith('/sale.order/prepare_renewal_order'),
      ),
    ).toBe(false);
    expect(steps).toHaveLength(0);
  });

  it('marks a native renewal unknown when its commercial structure differs from the source', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const sourceLine = {
      ...line(201, 5, 'Custom Plan', 100),
      order_id: [42, 'Source'],
    };
    const wrongRenewalLine = {
      ...line(301, 6, 'Unexpected Product', 100),
      order_id: [82, 'Renewal'],
    };
    const steps: RpcStep[] = [
      ...preflightSteps(42, 7, 1, 'year'),
      {
        path: '/web/dataset/call_kw/sale.order/fields_get',
        result: ownershipFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/sale.order.line/fields_get',
        result: lineFieldDefinitions(),
      },
      ...sourceCommercialLineSteps(42, sourceLine),
      ...linkedRenewalSteps([70, 71]),
      ...preflightSteps(42, 7, 1, 'year'),
      ...sourceCommercialLineSteps(42, sourceLine),
      ...templateValidationSteps(7, 87),
      ...currencyRoundingSteps(),
      {
        path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
        result: { type: 'ir.actions.act_window', res_model: 'sale.order', res_id: 82 },
      },
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year', 42, '2026-08-14 13:00:00', {
        lineRecords: [wrongRenewalLine],
      }),
    ];

    await expect(
      executeOdooRenewalOperation(
        {
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
        },
        { fetcher: queuedFetcher(steps), origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({
      ok: true,
      result: { quoteId: 82, reconciledAfterValidationFailure: true },
    });
    expect(steps).toHaveLength(0);
  });

  it('runs a previously validated Copy action without navigation or a second resolution', async () => {
    const ownership = new RenewalOwnershipRegistry();
    ownership.register(clientId, runId, 82, ownedFingerprint(42, 12));
    ownership.registerCopyAction(clientId, runId, 5, 9301);
    const steps: RpcStep[] = [
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      ...linkedRenewalSteps([70, 71, 82]),
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      {
        path: '/web/action/run',
        result: { type: 'ir.actions.act_window', res_model: 'sale.order', res_id: 83 },
      },
      ...ownedQuoteVerificationSteps(83, 8, 5, 'year', 42, '2026-08-14 13:01:00'),
      ...templateValidationSteps(8, 88),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        { name: 'copyNativePlan', sourceQuoteId: 82, years: 5, runId },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { quoteId: 83 } });
    expect(steps).toHaveLength(0);
    const calledUrls = (fetcher as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(calledUrls).not.toContain(`${ODOO_BRIDGE_ORIGIN}/web/action/load`);
    expect(calledUrls).not.toContain(
      `${ODOO_BRIDGE_ORIGIN}/web/dataset/call_kw/ir.actions.actions/get_bindings`,
    );
    expect(calledUrls).toContain(`${ODOO_BRIDGE_ORIGIN}/web/action/run`);
  });

  it.each([
    {
      label: 'template',
      targetTemplateId: 999,
      targetProductId: 5,
      targetPrice: 500,
    },
    {
      label: 'commercial line',
      targetTemplateId: 88,
      targetProductId: 6,
      targetPrice: 500,
    },
    {
      label: 'price scale',
      targetTemplateId: 88,
      targetProductId: 5,
      targetPrice: 400,
    },
  ])('marks a Copy with a wrong $label as an unknown result', async (scenario) => {
    const ownership = new RenewalOwnershipRegistry();
    const sourceLine = line(201, 5, 'Custom Plan', 100);
    const targetLine = {
      ...line(301, scenario.targetProductId, 'Copied Plan', scenario.targetPrice),
      order_id: [83, 'Copied quote'],
    };
    ownership.register(
      clientId,
      runId,
      82,
      ownedFingerprint(42, 12, 42, '2026-08-14 13:00:00', {
        lineRecords: [sourceLine],
      }),
    );
    ownership.registerCopyAction(clientId, runId, 5, 9301);
    const steps: RpcStep[] = [
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year', 42, '2026-08-14 13:00:00', {
        lineRecords: [sourceLine],
      }),
      ...linkedRenewalSteps([70, 71, 82]),
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year', 42, '2026-08-14 13:00:00', {
        lineRecords: [sourceLine],
      }),
      {
        path: '/web/action/run',
        result: { type: 'ir.actions.act_window', res_model: 'sale.order', res_id: 83 },
      },
      ...ownedQuoteVerificationSteps(83, 8, 5, 'year', 42, '2026-08-14 13:01:00', {
        templateId: scenario.targetTemplateId,
        lineRecords: [targetLine],
      }),
      ...templateValidationSteps(8, 88),
    ];

    await expect(
      executeOdooRenewalOperation(
        { name: 'copyNativePlan', sourceQuoteId: 82, years: 5, runId },
        { fetcher: queuedFetcher(steps), origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({
      ok: true,
      result: { quoteId: 83, reconciledAfterValidationFailure: true },
    });
    expect(steps).toHaveLength(0);
  });

  it('scales positive Copy lines while allowing each negative line to remain fixed or scale', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const sourceLines = [
      line(201, 5, 'Custom Plan', 100),
      { ...line(202, 6, 'First Year Discount', -10), sequence: 20 },
      { ...line(203, 7, 'Recurring Credit', -4), sequence: 30 },
    ];
    const targetLines = [
      { ...line(301, 5, 'Copied Plan', 500), order_id: [83, 'Copied quote'] },
      {
        ...line(302, 6, 'Copied First Year Discount', -10),
        order_id: [83, 'Copied quote'],
        sequence: 20,
      },
      {
        ...line(303, 7, 'Copied Recurring Credit', -20),
        order_id: [83, 'Copied quote'],
        sequence: 30,
      },
    ];
    ownership.register(
      clientId,
      runId,
      82,
      ownedFingerprint(42, 12, 42, '2026-08-14 13:00:00', {
        lineRecords: sourceLines,
      }),
    );
    ownership.registerCopyAction(clientId, runId, 5, 9301);
    const steps: RpcStep[] = [
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year', 42, '2026-08-14 13:00:00', {
        lineRecords: sourceLines,
      }),
      ...linkedRenewalSteps([70, 71, 82]),
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year', 42, '2026-08-14 13:00:00', {
        lineRecords: sourceLines,
      }),
      {
        path: '/web/action/run',
        result: { type: 'ir.actions.act_window', res_model: 'sale.order', res_id: 83 },
      },
      ...ownedQuoteVerificationSteps(83, 8, 5, 'year', 42, '2026-08-14 13:01:00', {
        lineRecords: targetLines,
      }),
      ...templateValidationSteps(8, 88),
    ];

    await expect(
      executeOdooRenewalOperation(
        { name: 'copyNativePlan', sourceQuoteId: 82, years: 5, runId },
        { fetcher: queuedFetcher(steps), origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { quoteId: 83 } });
    expect(steps).toHaveLength(0);
  });

  it('allows Monthly to Yearly native repricing while preserving structure and ultimate origin', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const sourceLine = line(201, 5, 'Monthly Custom Plan', 86);
    const yearlyLine = {
      ...line(301, 5, 'Yearly Custom Plan', 828),
      order_id: [83, 'Yearly quote'],
    };
    ownership.register(
      clientId,
      runId,
      82,
      ownedFingerprint(42, 1, 42, '2026-08-14 13:00:00', {
        originRootOrderId: 99,
        planId: 6,
        templateId: 86,
        lineRecords: [sourceLine],
      }),
    );
    ownership.registerCopyAction(clientId, runId, 1, 9301);
    const sourceOptions = {
      originRootOrderId: 99,
      templateId: 86,
      lineRecords: [sourceLine],
    };
    const steps: RpcStep[] = [
      ...ownedQuoteVerificationSteps(82, 6, 1, 'month', 42, '2026-08-14 13:00:00', sourceOptions),
      ...linkedRenewalSteps([70, 71, 82]),
      ...ownedQuoteVerificationSteps(82, 6, 1, 'month', 42, '2026-08-14 13:00:00', sourceOptions),
      {
        path: '/web/action/run',
        result: { type: 'ir.actions.act_window', res_model: 'sale.order', res_id: 83 },
      },
      ...ownedQuoteVerificationSteps(83, 7, 1, 'year', 42, '2026-08-14 13:01:00', {
        originRootOrderId: 99,
        templateId: 87,
        lineRecords: [yearlyLine],
      }),
      ...templateValidationSteps(7, 87),
    ];

    await expect(
      executeOdooRenewalOperation(
        { name: 'copyNativePlan', sourceQuoteId: 82, years: 1, runId },
        { fetcher: queuedFetcher(steps), origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { quoteId: 83 } });
    expect(steps).toHaveLength(0);
  });

  it('clears only the configured Multi Year Discount lines on an owned quote', async () => {
    const ownership = new RenewalOwnershipRegistry();
    ownership.register(clientId, runId, 82, ownedFingerprint(42, 12));
    const firstYearDiscount = line(
      102,
      5,
      'Custom Plan First Year Discount\nfor the Initial ordered quantity only',
      -17.5,
    );
    const steps: RpcStep[] = [
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      ...quoteLinesSteps(
        [101, 102],
        [line(101, 9, 'Multi Year Discount', -214.56), firstYearDiscount],
      ),
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      { path: '/web/dataset/call_kw/sale.order.line/unlink', result: true },
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      ...quoteLinesSteps([102], [firstYearDiscount]),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        { name: 'clearNativeMultiYearDiscount', quoteId: 82, runId },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { removedLineCount: 1 } });
    const unlinkCall = (fetcher as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      String(call[0]).endsWith('/sale.order.line/unlink'),
    );
    expect(JSON.parse(String(unlinkCall?.[1]?.body))).toMatchObject({
      params: { model: 'sale.order.line', method: 'unlink', args: [[101]], kwargs: {} },
    });
    expect(steps).toHaveLength(0);
  });

  it('applies the native global discount with tenths precision and an empty custom description', async () => {
    const ownership = new RenewalOwnershipRegistry();
    ownership.register(clientId, runId, 82, ownedFingerprint(42, 12));
    const baseLine = line(102, 5, 'Custom Plan', 100);
    const steps: RpcStep[] = [
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      ...quoteLinesSteps([102], [baseLine]),
      ...discountWizardPreflightSteps(),
      { path: '/web/dataset/call_kw/sale.order.discount/create', result: 501 },
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      {
        path: '/web/dataset/call_button/sale.order.discount/action_apply_discount',
        result: false,
      },
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      ...quoteLinesSteps([102, 103], [baseLine, line(103, 9, 'Multi Year Discount', -6.5)]),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'applyNativeGlobalDiscount',
          quoteId: 82,
          percentageTenths: 65,
          runId,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { createdLineCount: 1 } });
    const createCall = (fetcher as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      String(call[0]).endsWith('/sale.order.discount/create'),
    );
    const createBody = JSON.parse(String(createCall?.[1]?.body));
    expect(createBody).toMatchObject({
      params: {
        model: 'sale.order.discount',
        method: 'create',
        args: [
          {
            sale_order_id: 82,
            discount_type: 'so_discount',
            discount_percentage: 0.065,
            discount_description: '',
          },
        ],
        kwargs: {},
      },
    });
    expect(steps).toHaveLength(0);
  });

  it('returns only a strictly validated native Share link for an owned quote', async () => {
    const ownership = new RenewalOwnershipRegistry();
    ownership.register(clientId, runId, 82, ownedFingerprint(42, 12));
    const shareLink =
      'https://www.odoo.com/mail/view?model=sale.order&res_id=82&access_token=secret-token';
    const steps: RpcStep[] = [
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      {
        path: '/web/dataset/call_kw/portal.share/default_get',
        result: { share_link: shareLink, partner_ids: [999], note: 'must not cross' },
      },
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        { name: 'getNativeShareLink', quoteId: 82, runId },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { quoteId: 82, shareLink } });
    expect(steps).toHaveLength(0);
  });

  it('sanitizes a bounded quote summary without customer data', async () => {
    const ownership = new RenewalOwnershipRegistry();
    ownership.register(clientId, runId, 82, ownedFingerprint(42, 60));
    const baseLine = line(102, 5, 'Custom Plan', 100);
    const discountLine = line(103, 9, 'Multi Year Discount', -6.5);
    const steps: RpcStep[] = [
      ...ownedQuoteVerificationSteps(82, 8, 5, 'year'),
      {
        path: '/web/dataset/call_kw/sale.order/read',
        result: [
          {
            id: 82,
            name: 'SO2026/82',
            state: 'draft',
            subscription_state: '2_renewal',
            plan_id: [8, 'Private plan label'],
            sale_order_template_id: [11, 'Private template label'],
            currency_id: [2, 'USD'],
            amount_untaxed: 93.5,
            amount_tax: 0,
            amount_total: 93.5,
            order_line: [102, 103],
            partner_id: [999, 'Must not cross'],
          },
        ],
      },
      {
        path: '/web/dataset/call_kw/sale.subscription.plan/fields_get',
        result: planFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/sale.subscription.plan/read',
        result: [{ id: 8, billing_period_value: 5, billing_period_unit: 'year' }],
      },
      ...currencyRoundingSteps(),
      ...quoteLinesSteps([102, 103], [baseLine, discountLine]),
    ];
    const fetcher = queuedFetcher(steps);

    const result = await executeOdooRenewalOperation(
      { name: 'readRenewalQuoteSummary', quoteId: 82, runId },
      { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
    );
    expect(result).toMatchObject({
      ok: true,
      result: {
        quoteId: 82,
        createdFromQuoteId: 42,
        name: 'SO2026/82',
        planId: 8,
        currentContractMonths: 60,
        templateId: 11,
        currencyId: 2,
        lineCount: 2,
        multiYearDiscountLineCount: 1,
      },
    });
    expect(JSON.stringify(result)).not.toContain('Must not cross');
    expect(JSON.stringify(result)).not.toContain('Private plan label');
    expect(steps).toHaveLength(0);
  });

  it('rejects a shorter Copy target before any fetch', async () => {
    const ownership = new RenewalOwnershipRegistry();
    ownership.register(clientId, runId, 82, ownedFingerprint(42, 60));
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      executeOdooRenewalOperation(
        { name: 'copyNativePlan', sourceQuoteId: 82, years: 3, runId },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_endpoint' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects Copy action metadata drift before invoking native Renew', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const resolutionSteps = copyActionResolutionSteps([5], () => ({
      model_name: 'res.partner',
      binding_model_id: [18, 'Contact'],
    }));
    const steps: RpcStep[] = [
      ...preflightSteps(42, 7, 1, 'year'),
      {
        path: '/web/dataset/call_kw/sale.order/fields_get',
        result: ownershipFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/sale.order.line/fields_get',
        result: lineFieldDefinitions(),
      },
      ...resolutionSteps,
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [5],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_response' } });
    expect(
      (fetcher as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).endsWith('/sale.order/prepare_renewal_order'),
      ),
    ).toBe(false);
    expect(steps).toHaveLength(0);
  });

  it('rejects a non-server Copy action loaded from an otherwise valid binding', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const resolutionSteps = copyActionResolutionSteps([5], () => ({
      type: 'ir.actions.act_window',
    }));
    const steps: RpcStep[] = [
      ...preflightSteps(42, 7, 1, 'year'),
      {
        path: '/web/dataset/call_kw/sale.order/fields_get',
        result: ownershipFieldDefinitions(),
      },
      {
        path: '/web/dataset/call_kw/sale.order.line/fields_get',
        result: lineFieldDefinitions(),
      },
      ...resolutionSteps,
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [5],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_response' } });
    expect(
      (fetcher as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).endsWith('/sale.order/prepare_renewal_order'),
      ),
    ).toBe(false);
    expect(steps).toHaveLength(0);
  });

  it('preserves a commercial line that uses the discount product without native markers', async () => {
    const ownership = new RenewalOwnershipRegistry();
    ownership.register(clientId, runId, 82, ownedFingerprint(42, 12));
    const commercialDiscount = {
      ...line(101, 9, 'Localized discount', -10),
      sequence: 999,
      extra_tax_data: { tax_details: {} },
    };
    const steps: RpcStep[] = [
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
      ...quoteLinesSteps([101], [commercialDiscount]),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        { name: 'clearNativeMultiYearDiscount', quoteId: 82, runId },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({ ok: true, result: { removedLineCount: 0 } });
    expect(
      (fetcher as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).endsWith('/sale.order.line/unlink'),
      ),
    ).toBe(false);
    expect(steps).toHaveLength(0);
  });

  it('reconciles a unique immediate candidate on the mandatory zero-budget observation', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...nativeCreationPreludeSteps(),
      {
        path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
        error: new DOMException('', 'AbortError'),
      },
      ...linkedRenewalSteps([70, 71, 82]),
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [],
          requiresDiscount: true,
        },
        {
          fetcher,
          origin: ODOO_BRIDGE_ORIGIN,
          clientId,
          ownership,
          reconciliationDelayMs: 0,
          reconciliationTimeoutMs: 0,
          reconciliationPollIntervalMs: 1,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      result: { quoteId: 82, reconciledAfterTimeout: true },
    });
    expect(steps).toHaveLength(0);
  });

  it('recovers one late native quote after an uncertain transport failure without retrying Renew', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...nativeCreationPreludeSteps(),
      {
        path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
        error: new DOMException('', 'AbortError'),
      },
      ...linkedRenewalSteps([70, 71]),
      ...linkedRenewalSteps([70, 71, 82]),
      ...ownedQuoteVerificationSteps(82, 7, 1, 'year'),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [],
          requiresDiscount: true,
        },
        {
          fetcher,
          origin: ODOO_BRIDGE_ORIGIN,
          clientId,
          ownership,
          reconciliationDelayMs: 0,
          reconciliationTimeoutMs: 50,
          reconciliationPollIntervalMs: 1,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      result: { quoteId: 82, reconciledAfterTimeout: true },
    });
    const renewCalls = (fetcher as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).endsWith('/sale.order/prepare_renewal_order'),
    );
    expect(renewCalls).toHaveLength(1);
    expect(steps).toHaveLength(0);
  });

  it('does not reconcile or relabel a deterministic creation error as a timeout', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...nativeCreationPreludeSteps(),
      {
        path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
        error: bridgeFailure('access_denied'),
      },
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'access_denied' } });
    expect(ownership.getPendingCreation(clientId, runId)).toBeNull();
    expect(steps).toHaveLength(0);
  });

  it('returns a known quote ID as unknown when post-creation ownership validation fails', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...nativeCreationPreludeSteps(),
      {
        path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
        result: { type: 'ir.actions.act_window', res_model: 'sale.order', res_id: 82 },
      },
      {
        path: '/web/dataset/call_kw/sale.order/read',
        result: [
          {
            id: 82,
            state: 'draft',
            subscription_state: '2_renewal',
            is_subscription: true,
            subscription_id: [999, 'Wrong source'],
            partner_id: [20, 'Private customer'],
            company_id: [3, 'Odoo Inc.'],
            currency_id: [2, 'USD'],
            pricelist_id: [4, 'Private pricelist'],
            create_date: '2026-08-14 13:00:00',
            write_date: '2026-08-14 13:00:00',
            plan_id: [7, 'Private plan label'],
            order_line: [],
          },
        ],
      },
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({
      ok: true,
      result: { quoteId: 82, reconciledAfterValidationFailure: true },
    });
    expect(ownership.getPendingCreation(clientId, runId)).toBeNull();
    expect(steps).toHaveLength(0);
  });

  it('returns a known quote ID as unknown when its ultimate origin is not the source origin', async () => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...nativeCreationPreludeSteps(),
      {
        path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
        result: { type: 'ir.actions.act_window', res_model: 'sale.order', res_id: 82 },
      },
      {
        path: '/web/dataset/call_kw/sale.order/read',
        result: [
          {
            id: 82,
            state: 'draft',
            subscription_state: '2_renewal',
            is_subscription: true,
            subscription_id: [42, 'Private source'],
            origin_order_id: [999, 'Wrong ultimate origin'],
            partner_id: [20, 'Private customer'],
            company_id: [3, 'Odoo Inc.'],
            currency_id: [2, 'USD'],
            pricelist_id: [4, 'Private pricelist'],
            create_date: '2026-08-14 13:00:00',
            write_date: '2026-08-14 13:00:00',
            plan_id: [7, 'Private plan label'],
            sale_order_template_id: [87, 'Private template'],
            order_line: [],
          },
        ],
      },
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [],
          requiresDiscount: true,
        },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, clientId, ownership },
      ),
    ).resolves.toEqual({
      ok: true,
      result: { quoteId: 82, reconciledAfterValidationFailure: true },
    });
    expect(ownership.getPendingCreation(clientId, runId)).toBeNull();
    expect(steps).toHaveLength(0);
  });

  it.each([
    { label: 'no candidate', ids: [70, 71] },
    { label: 'ambiguous candidates', ids: [70, 71, 82, 83] },
  ])('reports an unknown timeout with $label and never guesses a quote', async ({ ids }) => {
    const ownership = new RenewalOwnershipRegistry();
    const steps: RpcStep[] = [
      ...nativeCreationPreludeSteps(),
      {
        path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
        error: new DOMException('', 'AbortError'),
      },
      ...linkedRenewalSteps(ids),
    ];
    const fetcher = queuedFetcher(steps);

    await expect(
      executeOdooRenewalOperation(
        {
          name: 'createNativeRenewal',
          sourceOrderId: 42,
          runId,
          expected: {
            planId: 7,
            currentContractMonths: 12,
            writeDate: '2026-08-14 12:00:00',
          },
          requiredCopyYears: [],
          requiresDiscount: true,
        },
        {
          fetcher,
          origin: ODOO_BRIDGE_ORIGIN,
          clientId,
          ownership,
          reconciliationDelayMs: 0,
          reconciliationTimeoutMs: 0,
          reconciliationPollIntervalMs: 1,
        },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'timeout' } });
    expect(ownership.getPendingCreation(clientId, runId)).toBeNull();
    expect(steps).toHaveLength(0);
  });

  it('always performs the mandatory first reconciliation read with a zero polling budget', async () => {
    const ownership = new RenewalOwnershipRegistry();

    for (let index = 0; index < 20; index += 1) {
      const stressRunId = `renewal-stress${String(index).padStart(4, '0')}`;
      const steps: RpcStep[] = [
        ...nativeCreationPreludeSteps(),
        {
          path: '/web/dataset/call_button/sale.order/prepare_renewal_order',
          error: new DOMException('', 'AbortError'),
        },
        ...linkedRenewalSteps([70, 71]),
      ];
      const fetcher = queuedFetcher(steps);

      await expect(
        executeOdooRenewalOperation(
          {
            name: 'createNativeRenewal',
            sourceOrderId: 42,
            runId: stressRunId,
            expected: {
              planId: 7,
              currentContractMonths: 12,
              writeDate: '2026-08-14 12:00:00',
            },
            requiredCopyYears: [],
            requiresDiscount: true,
          },
          {
            fetcher,
            origin: ODOO_BRIDGE_ORIGIN,
            clientId,
            ownership,
            reconciliationDelayMs: 0,
            reconciliationTimeoutMs: 0,
            reconciliationPollIntervalMs: 1,
          },
        ),
      ).resolves.toMatchObject({ ok: false, failure: { code: 'timeout' } });
      expect(steps).toHaveLength(0);
      expect(ownership.getPendingCreation(clientId, stressRunId)).toBeNull();
    }
  });

  it('uses one bounded attempt and reports a timeout without retrying', async () => {
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
      });
    });

    await expect(
      executeOdooRenewalOperation(
        { name: 'preflightRenewal', sourceOrderId: 42 },
        { fetcher, origin: ODOO_BRIDGE_ORIGIN, timeoutMs: 2, clientId },
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'timeout' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
