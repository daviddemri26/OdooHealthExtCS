import {
  ODOO_BRIDGE_ORIGIN,
  bridgeFailure,
  isRenewalBridgeOperation,
  type OdooBridgeFailure,
} from './bridge-protocol';
import type {
  RenewalBillingUnit,
  RenewalBridgeOperation,
  RenewalPreflightResponse,
  RenewalQuoteLineSummary,
  RenewalQuoteSummary,
  RenewalTargetYears,
} from './renewal-contracts';
import {
  RENEWAL_RECONCILIATION_DELAY_MS,
  RENEWAL_RECONCILIATION_POLL_INTERVAL_MS,
  RENEWAL_RECONCILIATION_TIMEOUT_MS,
  RENEWAL_RUNTIME_TIMEOUT_MS,
} from './renewal-contracts';

type RenewalExecutionResult =
  { ok: true; result: unknown } | { ok: false; failure: OdooBridgeFailure };

interface JsonRpcError {
  jsonrpc: '2.0';
  error: {
    data?: {
      name?: string;
    };
  };
}

interface RenewalRpcContext {
  fetcher: typeof fetch;
  origin: string;
  requestId: string | null;
  signal: AbortSignal;
}

export type RenewalTemplateClass = 'standard' | 'custom';

export interface RenewalCommercialLineSnapshot {
  productId: number | null;
  displayType: string | null;
  name: string;
  sequence: number;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  total: number;
  taxIds: number[];
  isNativeGlobalDiscount: boolean;
}

export interface RenewalOwnedQuoteFingerprint {
  rootSourceOrderId: number;
  originRootOrderId: number;
  parentQuoteId: number;
  partnerId: number;
  companyId: number;
  currencyId: number;
  pricelistId: number;
  planId: number;
  templateId: number;
  templateClass: RenewalTemplateClass;
  currencyRounding: number;
  createDate: string;
  writeDate: string;
  currentContractMonths: number;
  lineFingerprint: string;
  commercialLines: RenewalCommercialLineSnapshot[];
}

type OwnedQuote = RenewalOwnedQuoteFingerprint;

const SOURCE_ORDER_FIELDS = [
  'state',
  'subscription_state',
  'is_subscription',
  'plan_id',
  'write_date',
  'renewal_count',
] as const;
const PLAN_FIELDS = ['billing_period_value', 'billing_period_unit'] as const;
const QUOTE_SUMMARY_FIELDS = [
  'name',
  'state',
  'subscription_state',
  'plan_id',
  'sale_order_template_id',
  'currency_id',
  'amount_untaxed',
  'amount_tax',
  'amount_total',
  'order_line',
] as const;
const ORDER_OWNERSHIP_FIELDS = [
  'state',
  'subscription_state',
  'is_subscription',
  'subscription_id',
  'origin_order_id',
  'partner_id',
  'company_id',
  'currency_id',
  'pricelist_id',
  'create_date',
  'write_date',
  'plan_id',
  'sale_order_template_id',
  'order_line',
] as const;
const SOURCE_COMMERCIAL_FIELDS = [
  'partner_id',
  'company_id',
  'currency_id',
  'pricelist_id',
  'origin_order_id',
  'plan_id',
  'sale_order_template_id',
  'order_line',
] as const;
const QUOTE_LINE_FIELDS = [
  'order_id',
  'product_id',
  'display_type',
  'name',
  'sequence',
  'product_uom_qty',
  'price_unit',
  'price_subtotal',
  'price_total',
  'tax_ids',
  'extra_tax_data',
  'write_date',
] as const;
const FIELD_DEFINITION_ATTRIBUTES = ['type', 'relation'] as const;
const DISCOUNT_WIZARD_FIELDS = [
  'sale_order_id',
  'discount_type',
  'discount_percentage',
  'discount_description',
] as const;
const DISCOUNT_WIZARD_FIELD_ATTRIBUTES = ['type', 'relation', 'required', 'selection'] as const;
const TARGET_YEARS = [1, 2, 3, 4, 5] as const;
const MAX_QUOTE_LINES = 500;
const MAX_LINE_TAXES = 100;
const MAX_QUOTES_PER_RUN = 8;
const MAX_LINKED_RENEWAL_QUOTES = 500;
const MAX_PLAN_TEMPLATES = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function sanitizeLabel(value: unknown, maximum = 160): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    hasControlCharacters(value)
  ) {
    throw bridgeFailure('incompatible_response');
  }
  return value;
}

function sanitizeBoundedText(value: unknown, maximum = 4_000): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw bridgeFailure('incompatible_response');
  }
  const hasUnsafeControl = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    );
  });
  if (hasUnsafeControl) throw bridgeFailure('incompatible_response');
  return value;
}

function sanitizeMany2One(value: unknown): false | [number, string] {
  if (value === false || value === null) return false;
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !isPositiveId(value[0]) ||
    typeof value[1] !== 'string'
  ) {
    throw bridgeFailure('incompatible_response');
  }
  return [value[0], sanitizeLabel(value[1])];
}

function sanitizeFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw bridgeFailure('incompatible_response');
  }
  return value;
}

function sanitizePositiveInteger(value: unknown, maximum = 1_200): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum) {
    throw bridgeFailure('incompatible_response');
  }
  return Number(value);
}

function sanitizeNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw bridgeFailure('incompatible_response');
  }
  return Number(value);
}

function sanitizeServerWriteDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)
  ) {
    throw bridgeFailure('incompatible_response');
  }
  return value;
}

function classifyJsonRpcError(error: JsonRpcError['error']): OdooBridgeFailure {
  const name = error.data?.name ?? '';
  if (/access(error|denied)/i.test(name)) return bridgeFailure('access_denied');
  if (/session|authentication/i.test(name)) return bridgeFailure('session_expired');
  if (/attributeerror|keyerror|missingerror|methodnotfound/i.test(name)) {
    return bridgeFailure('incompatible_response');
  }
  return bridgeFailure('server_error');
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return (
    isRecord(value) &&
    value.jsonrpc === '2.0' &&
    isRecord(value.error) &&
    (value.error.data === undefined || isRecord(value.error.data))
  );
}

async function postJsonRpc(
  rpc: RenewalRpcContext,
  path: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const response = await rpc.fetcher(new URL(path, rpc.origin).href, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params,
      id: rpc.requestId,
    }),
    signal: rpc.signal,
  });

  if (response.redirected || response.status === 401) throw bridgeFailure('session_expired');
  if (response.status === 403) throw bridgeFailure('access_denied');
  if (response.status === 404 || response.status === 405) {
    throw bridgeFailure('incompatible_endpoint');
  }
  if (!response.ok) throw bridgeFailure('server_error');

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLocaleLowerCase().includes('json')) {
    throw bridgeFailure('session_expired');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw bridgeFailure('incompatible_response');
  }
  if (isJsonRpcError(payload)) throw classifyJsonRpcError(payload.error);
  if (!isRecord(payload) || payload.jsonrpc !== '2.0' || !('result' in payload)) {
    throw bridgeFailure('incompatible_response');
  }
  return payload.result;
}

function callKw(
  rpc: RenewalRpcContext,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown>,
): Promise<unknown> {
  return postJsonRpc(rpc, `/web/dataset/call_kw/${model}/${method}`, {
    model,
    method,
    args,
    kwargs,
  });
}

function callButton(
  rpc: RenewalRpcContext,
  model: string,
  method: string,
  recordId: number,
): Promise<unknown> {
  return postJsonRpc(rpc, `/web/dataset/call_button/${model}/${method}`, {
    model,
    method,
    args: [[recordId]],
    kwargs: {},
  });
}

async function readOne(
  rpc: RenewalRpcContext,
  model: string,
  recordId: number,
  fields: readonly string[],
): Promise<Record<string, unknown>> {
  const result = await callKw(rpc, model, 'read', [[recordId], [...fields]], {});
  if (
    !Array.isArray(result) ||
    result.length !== 1 ||
    !isRecord(result[0]) ||
    result[0].id !== recordId
  ) {
    throw bridgeFailure('incompatible_response');
  }
  return result[0];
}

async function readMany(
  rpc: RenewalRpcContext,
  model: string,
  recordIds: number[],
  fields: readonly string[],
): Promise<Record<string, unknown>[]> {
  if (
    recordIds.length === 0 ||
    recordIds.length > MAX_QUOTE_LINES ||
    !recordIds.every(isPositiveId) ||
    new Set(recordIds).size !== recordIds.length
  ) {
    throw bridgeFailure('incompatible_response');
  }
  const result = await callKw(rpc, model, 'read', [recordIds, [...fields]], {});
  if (!Array.isArray(result) || result.length !== recordIds.length) {
    throw bridgeFailure('incompatible_response');
  }
  const expectedIds = new Set(recordIds);
  const records = result.map((record) => {
    if (!isRecord(record) || !isPositiveId(record.id) || !expectedIds.delete(record.id)) {
      throw bridgeFailure('incompatible_response');
    }
    return record;
  });
  if (expectedIds.size !== 0) throw bridgeFailure('incompatible_response');
  return records;
}

async function assertFieldDefinitions(
  rpc: RenewalRpcContext,
  model: string,
  expected: Record<string, { type: string; relation?: string }>,
): Promise<void> {
  const result = await callKw(rpc, model, 'fields_get', [], {
    allfields: Object.keys(expected),
    attributes: [...FIELD_DEFINITION_ATTRIBUTES],
  });
  if (!isRecord(result)) throw bridgeFailure('incompatible_response');
  for (const [field, definition] of Object.entries(expected)) {
    const actual = result[field];
    if (
      !isRecord(actual) ||
      actual.type !== definition.type ||
      (definition.relation !== undefined && actual.relation !== definition.relation)
    ) {
      throw bridgeFailure('incompatible_response');
    }
  }
}

async function readPlanPeriod(
  rpc: RenewalRpcContext,
  planId: number,
): Promise<{
  billingPeriodValue: number;
  billingPeriodUnit: RenewalBillingUnit;
  currentContractMonths: number;
}> {
  try {
    await assertFieldDefinitions(rpc, 'sale.subscription.plan', {
      billing_period_value: { type: 'integer' },
      billing_period_unit: { type: 'selection' },
    });
    const plan = await readOne(rpc, 'sale.subscription.plan', planId, PLAN_FIELDS);
    const billingPeriodValue = sanitizePositiveInteger(plan.billing_period_value);
    if (plan.billing_period_unit !== 'month' && plan.billing_period_unit !== 'year') {
      throw bridgeFailure('incompatible_response');
    }
    const billingPeriodUnit = plan.billing_period_unit;
    const currentContractMonths =
      billingPeriodUnit === 'year' ? billingPeriodValue * 12 : billingPeriodValue;
    if (!Number.isSafeInteger(currentContractMonths) || currentContractMonths > 1_200) {
      throw bridgeFailure('incompatible_response');
    }
    return { billingPeriodValue, billingPeriodUnit, currentContractMonths };
  } catch (error) {
    if (isRecord(error) && error.code === 'incompatible_response') {
      throw {
        code: 'incompatible_response',
        message: 'The current contract duration could not be verified. No quotation was created.',
      } satisfies OdooBridgeFailure;
    }
    throw error;
  }
}

async function readCurrencyRounding(rpc: RenewalRpcContext, currencyId: number): Promise<number> {
  await assertFieldDefinitions(rpc, 'res.currency', { rounding: { type: 'float' } });
  const currency = await readOne(rpc, 'res.currency', currencyId, ['rounding']);
  const rounding = sanitizeFiniteNumber(currency.rounding);
  if (rounding <= 0 || rounding > 1_000) throw bridgeFailure('incompatible_response');
  return rounding;
}

async function readPreflight(
  rpc: RenewalRpcContext,
  sourceOrderId: number,
): Promise<RenewalPreflightResponse> {
  await assertFieldDefinitions(rpc, 'sale.order', {
    state: { type: 'selection' },
    subscription_state: { type: 'selection' },
    is_subscription: { type: 'boolean' },
    plan_id: { type: 'many2one', relation: 'sale.subscription.plan' },
    write_date: { type: 'datetime' },
    renewal_count: { type: 'integer' },
  });
  const source = await readOne(rpc, 'sale.order', sourceOrderId, SOURCE_ORDER_FIELDS);
  if (
    source.state !== 'sale' ||
    source.subscription_state !== '3_progress' ||
    source.is_subscription !== true
  ) {
    return { eligible: false, sourceOrderId, reason: 'not-in-progress' };
  }
  const renewalQuoteCount = sanitizeNonNegativeInteger(source.renewal_count);
  const plan = sanitizeMany2One(source.plan_id);
  if (!plan) throw bridgeFailure('incompatible_response');
  const period = await readPlanPeriod(rpc, plan[0]);
  const writeDate = sanitizeServerWriteDate(source.write_date);
  const allowedTargetYears = TARGET_YEARS.filter(
    (years) => years * 12 >= period.currentContractMonths,
  );
  return {
    eligible: true,
    sourceOrderId,
    planId: plan[0],
    writeDate,
    renewalQuoteCount,
    ...period,
    allowedTargetYears,
  };
}

interface CommercialIdentity {
  partnerId: number;
  companyId: number;
  currencyId: number;
  pricelistId: number;
}

interface PendingQuoteCreation {
  rootSourceOrderId: number;
  originRootOrderId: number;
  parentQuoteId: number;
  expectedIdentity: CommercialIdentity;
  expectedMonths: number;
  sourceMonths: number;
  expectedTemplateClass: RenewalTemplateClass;
  expectedTemplateId: number | null;
  currencyRounding: number;
  sourceCommercialLines: RenewalCommercialLineSnapshot[];
  compareNativeDiscountLines: boolean;
  priceMode: 'same' | 'annual-reprice' | 'duration-scale';
  existingLinkedQuoteIds: Set<number>;
  responseReceived: boolean;
  returnedQuoteId: number | null;
}

function sanitizeCommercialIdentity(record: Record<string, unknown>): CommercialIdentity {
  const partner = sanitizeMany2One(record.partner_id);
  const company = sanitizeMany2One(record.company_id);
  const currency = sanitizeMany2One(record.currency_id);
  const pricelist = sanitizeMany2One(record.pricelist_id);
  if (!partner || !company || !currency || !pricelist) {
    throw bridgeFailure('incompatible_response');
  }
  return {
    partnerId: partner[0],
    companyId: company[0],
    currencyId: currency[0],
    pricelistId: pricelist[0],
  };
}

function sameCommercialIdentity(left: CommercialIdentity, right: CommercialIdentity): boolean {
  return (
    left.partnerId === right.partnerId &&
    left.companyId === right.companyId &&
    left.currencyId === right.currencyId &&
    left.pricelistId === right.pricelistId
  );
}

async function assertOwnershipFieldDefinitions(rpc: RenewalRpcContext): Promise<void> {
  await assertFieldDefinitions(rpc, 'sale.order', {
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
  });
  await assertFieldDefinitions(rpc, 'sale.order.line', {
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
  });
}

interface CommercialLineState {
  fingerprint: string;
  lines: RenewalCommercialLineSnapshot[];
}

function cloneCommercialLines(
  lines: readonly RenewalCommercialLineSnapshot[],
): RenewalCommercialLineSnapshot[] {
  return lines.map((line) => ({ ...line, taxIds: [...line.taxIds] }));
}

async function readCommercialLineState(
  rpc: RenewalRpcContext,
  quoteId: number,
  value: unknown,
): Promise<CommercialLineState> {
  const lineIds = sanitizeLineIds(value);
  if (lineIds.length === 0) return { fingerprint: '[]', lines: [] };
  const records = await readMany(rpc, 'sale.order.line', lineIds, QUOTE_LINE_FIELDS);
  const normalized = records
    .map((record) => {
      const order = sanitizeMany2One(record.order_id);
      const product = sanitizeMany2One(record.product_id);
      if (!order || order[0] !== quoteId || !isPositiveId(record.id)) {
        throw bridgeFailure('incompatible_response');
      }
      const displayType = record.display_type;
      if (displayType !== false && displayType !== null && typeof displayType !== 'string') {
        throw bridgeFailure('incompatible_response');
      }
      const normalizedDisplayType = typeof displayType === 'string' ? displayType : null;
      if (
        !Number.isSafeInteger(record.sequence) ||
        Number(record.sequence) < 0 ||
        Number(record.sequence) > 1_000_000
      ) {
        throw bridgeFailure('incompatible_response');
      }
      const name = sanitizeBoundedText(record.name);
      const quantity = sanitizeFiniteNumber(record.product_uom_qty);
      const unitPrice = sanitizeFiniteNumber(record.price_unit);
      const subtotal = sanitizeFiniteNumber(record.price_subtotal);
      const total = sanitizeFiniteNumber(record.price_total);
      const taxIds = sanitizeTaxIds(record.tax_ids);
      const extraTaxData = sanitizeExtraTaxData(record.extra_tax_data);
      const isNativeGlobalDiscount = Boolean(
        product &&
        extraTaxData.isNativeGlobalDiscount &&
        normalizedDisplayType === null &&
        record.sequence === 999,
      );
      return {
        id: Number(record.id),
        productId: product ? product[0] : null,
        displayType: normalizedDisplayType,
        name,
        sequence: Number(record.sequence),
        quantity,
        unitPrice,
        subtotal,
        total,
        taxIds,
        extraTaxData: extraTaxData.serialized,
        isNativeGlobalDiscount,
        writeDate: sanitizeServerWriteDate(record.write_date),
      };
    })
    .sort((left, right) => left.id - right.id);
  return {
    fingerprint: JSON.stringify(normalized),
    lines: normalized.map((line) => ({
      productId: line.productId,
      displayType: line.displayType,
      name: line.name,
      sequence: line.sequence,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      subtotal: line.subtotal,
      total: line.total,
      taxIds: [...line.taxIds],
      isNativeGlobalDiscount: line.isNativeGlobalDiscount,
    })),
  };
}

async function readSourceCreationFingerprint(
  rpc: RenewalRpcContext,
  sourceOrderId: number,
): Promise<{
  identity: CommercialIdentity;
  originRootOrderId: number;
  planId: number;
  templateId: number;
  lineFingerprint: string;
  commercialLines: RenewalCommercialLineSnapshot[];
}> {
  const source = await readOne(rpc, 'sale.order', sourceOrderId, SOURCE_COMMERCIAL_FIELDS);
  const origin = sanitizeMany2One(source.origin_order_id);
  const plan = sanitizeMany2One(source.plan_id);
  const template = sanitizeMany2One(source.sale_order_template_id);
  if (!plan || !template) throw bridgeFailure('incompatible_response');
  const lineState = await readCommercialLineState(rpc, sourceOrderId, source.order_line);
  return {
    identity: sanitizeCommercialIdentity(source),
    originRootOrderId: origin ? origin[0] : sourceOrderId,
    planId: plan[0],
    templateId: template[0],
    lineFingerprint: lineState.fingerprint,
    commercialLines: lineState.lines,
  };
}

async function validateUniqueTemplateForPlan(
  rpc: RenewalRpcContext,
  templateId: number,
  planId: number,
  expectedClass?: RenewalTemplateClass,
): Promise<RenewalTemplateClass> {
  await assertFieldDefinitions(rpc, 'sale.order.template', {
    plan_id: { type: 'many2one', relation: 'sale.subscription.plan' },
    custom_plan_id: { type: 'many2one', relation: 'sale.order.template' },
  });
  const result = await callKw(
    rpc,
    'sale.order.template',
    'search_read',
    [[['plan_id', '=', planId]]],
    {
      fields: ['id', 'plan_id', 'custom_plan_id'],
      limit: MAX_PLAN_TEMPLATES + 1,
      order: 'id asc',
    },
  );
  if (!Array.isArray(result) || result.length === 0 || result.length > MAX_PLAN_TEMPLATES) {
    throw bridgeFailure('incompatible_response');
  }

  const templates = result.map((candidate) => {
    if (!isRecord(candidate) || !isPositiveId(candidate.id)) {
      throw bridgeFailure('incompatible_response');
    }
    const candidatePlan = sanitizeMany2One(candidate.plan_id);
    const customPlan = sanitizeMany2One(candidate.custom_plan_id);
    if (!candidatePlan || candidatePlan[0] !== planId) {
      throw bridgeFailure('incompatible_response');
    }
    return {
      id: Number(candidate.id),
      templateClass: customPlan ? ('standard' as const) : ('custom' as const),
      customPlanId: customPlan ? customPlan[0] : null,
    };
  });
  if (new Set(templates.map(({ id }) => id)).size !== templates.length) {
    throw bridgeFailure('incompatible_response');
  }
  const selected = templates.find(({ id }) => id === templateId);
  if (!selected || (expectedClass !== undefined && selected.templateClass !== expectedClass)) {
    throw bridgeFailure('incompatible_response');
  }
  if (
    templates.filter(({ templateClass }) => templateClass === selected.templateClass).length !== 1
  ) {
    throw bridgeFailure('incompatible_response');
  }
  if (selected.templateClass === 'standard') {
    const linkedCustom = templates.find(({ id }) => id === selected.customPlanId);
    if (!linkedCustom || linkedCustom.templateClass !== 'custom') {
      throw bridgeFailure('incompatible_response');
    }
  }
  return selected.templateClass;
}

function commercialLineKey(
  line: RenewalCommercialLineSnapshot,
  includeNativeDetails: boolean,
): string {
  return JSON.stringify({
    productId: line.productId,
    displayType: line.displayType,
    ...(includeNativeDetails ? { name: line.name } : {}),
    sequence: line.sequence,
    quantity: line.quantity,
    taxIds: line.taxIds,
    ...(includeNativeDetails ? { isNativeGlobalDiscount: line.isNativeGlobalDiscount } : {}),
  });
}

function groupCommercialLineAmounts(
  lines: readonly RenewalCommercialLineSnapshot[],
  includeNativeDiscountLines: boolean,
): Map<string, [number, number, number][]> {
  const groups = new Map<string, [number, number, number][]>();
  for (const line of lines) {
    if (!includeNativeDiscountLines && line.isNativeGlobalDiscount) continue;
    const key = commercialLineKey(line, includeNativeDiscountLines);
    const amounts = groups.get(key) ?? [];
    amounts.push([line.unitPrice, line.subtotal, line.total]);
    groups.set(key, amounts);
  }
  for (const amounts of groups.values()) {
    amounts.sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]);
  }
  return groups;
}

function assertCommercialLineTransformation(
  sourceLines: readonly RenewalCommercialLineSnapshot[],
  targetLines: readonly RenewalCommercialLineSnapshot[],
  sourceMonths: number,
  targetMonths: number,
  currencyRounding: number,
  includeNativeDiscountLines: boolean,
  priceMode: PendingQuoteCreation['priceMode'],
): void {
  if (
    !Number.isSafeInteger(sourceMonths) ||
    sourceMonths <= 0 ||
    !Number.isSafeInteger(targetMonths) ||
    targetMonths < sourceMonths ||
    !Number.isFinite(currencyRounding) ||
    currencyRounding <= 0
  ) {
    throw bridgeFailure('incompatible_response');
  }
  const sourceGroups = groupCommercialLineAmounts(sourceLines, includeNativeDiscountLines);
  const targetGroups = groupCommercialLineAmounts(targetLines, includeNativeDiscountLines);
  if (sourceGroups.size !== targetGroups.size) throw bridgeFailure('incompatible_response');
  const multiplier = targetMonths / sourceMonths;
  const tolerance = currencyRounding + 1e-6;
  for (const [key, sourceAmounts] of sourceGroups) {
    const targetAmounts = targetGroups.get(key);
    if (!targetAmounts || targetAmounts.length !== sourceAmounts.length) {
      throw bridgeFailure('incompatible_response');
    }
    if (priceMode === 'annual-reprice') continue;
    const unmatchedTargets = [...targetAmounts];
    for (const source of sourceAmounts) {
      const targetIndex = unmatchedTargets.findIndex((target) => {
        const matchesMultiplier = (candidateMultiplier: number): boolean =>
          source.every(
            (amount, amountIndex) =>
              Math.abs((target[amountIndex] ?? Number.NaN) - amount * candidateMultiplier) <=
              tolerance,
          );
        if (priceMode === 'same') return matchesMultiplier(1);
        return source[0] < 0
          ? matchesMultiplier(1) || matchesMultiplier(multiplier)
          : matchesMultiplier(multiplier);
      });
      if (targetIndex < 0) throw bridgeFailure('incompatible_response');
      unmatchedTargets.splice(targetIndex, 1);
    }
  }
}

async function assertCreatedQuoteTransformation(
  rpc: RenewalRpcContext,
  fingerprint: RenewalOwnedQuoteFingerprint,
  pending: PendingQuoteCreation,
): Promise<void> {
  if (
    fingerprint.originRootOrderId !== pending.originRootOrderId ||
    fingerprint.templateClass !== pending.expectedTemplateClass ||
    fingerprint.currencyRounding !== pending.currencyRounding ||
    (pending.expectedTemplateId !== null && fingerprint.templateId !== pending.expectedTemplateId)
  ) {
    throw bridgeFailure('incompatible_response');
  }
  if (pending.expectedTemplateId === null) {
    const templateClass = await validateUniqueTemplateForPlan(
      rpc,
      fingerprint.templateId,
      fingerprint.planId,
      pending.expectedTemplateClass,
    );
    if (templateClass !== pending.expectedTemplateClass) {
      throw bridgeFailure('incompatible_response');
    }
  }
  assertCommercialLineTransformation(
    pending.sourceCommercialLines,
    fingerprint.commercialLines,
    pending.sourceMonths,
    pending.expectedMonths,
    pending.currencyRounding,
    pending.compareNativeDiscountLines,
    pending.priceMode,
  );
}

async function readLinkedRenewalQuoteIds(
  rpc: RenewalRpcContext,
  rootSourceOrderId: number,
): Promise<Set<number>> {
  const result = await callKw(
    rpc,
    'sale.order',
    'search_read',
    [[['subscription_id', '=', rootSourceOrderId]]],
    {
      fields: ['id'],
      limit: MAX_LINKED_RENEWAL_QUOTES + 1,
      order: 'id asc',
    },
  );
  if (!Array.isArray(result) || result.length > MAX_LINKED_RENEWAL_QUOTES) {
    throw bridgeFailure('incompatible_response');
  }
  const ids = new Set<number>();
  for (const record of result) {
    if (!isRecord(record) || !isPositiveId(record.id) || ids.has(record.id)) {
      throw bridgeFailure('incompatible_response');
    }
    ids.add(record.id);
  }
  return ids;
}

async function readVerifiedOwnedQuote(
  rpc: RenewalRpcContext,
  quoteId: number,
  rootSourceOrderId: number,
  originRootOrderId: number,
  parentQuoteId: number,
  expectedIdentity: CommercialIdentity,
  expectedMonths: number,
  expectedTemplateClass: RenewalTemplateClass,
  expectedTemplateId: number | null,
  currencyRounding: number,
): Promise<RenewalOwnedQuoteFingerprint> {
  const record = await readOne(rpc, 'sale.order', quoteId, ORDER_OWNERSHIP_FIELDS);
  const subscription = sanitizeMany2One(record.subscription_id);
  const origin = sanitizeMany2One(record.origin_order_id);
  const plan = sanitizeMany2One(record.plan_id);
  const template = sanitizeMany2One(record.sale_order_template_id);
  const commercialIdentity = sanitizeCommercialIdentity(record);
  if (
    record.state !== 'draft' ||
    record.subscription_state !== '2_renewal' ||
    record.is_subscription !== true ||
    !subscription ||
    subscription[0] !== rootSourceOrderId ||
    !origin ||
    origin[0] !== originRootOrderId ||
    !plan ||
    !template ||
    (expectedTemplateId !== null && template[0] !== expectedTemplateId) ||
    !sameCommercialIdentity(commercialIdentity, expectedIdentity)
  ) {
    throw bridgeFailure('incompatible_response');
  }
  const currentContractMonths = (await readPlanPeriod(rpc, plan[0])).currentContractMonths;
  if (currentContractMonths !== expectedMonths) {
    throw bridgeFailure('incompatible_response');
  }
  const lineState = await readCommercialLineState(rpc, quoteId, record.order_line);
  return {
    rootSourceOrderId,
    originRootOrderId,
    parentQuoteId,
    ...commercialIdentity,
    planId: plan[0],
    templateId: template[0],
    templateClass: expectedTemplateClass,
    currencyRounding,
    createDate: sanitizeServerWriteDate(record.create_date),
    writeDate: sanitizeServerWriteDate(record.write_date),
    currentContractMonths,
    lineFingerprint: lineState.fingerprint,
    commercialLines: lineState.lines,
  };
}

async function assertOwnedQuoteStillMatches(
  rpc: RenewalRpcContext,
  quoteId: number,
  ownedQuote: OwnedQuote,
): Promise<RenewalOwnedQuoteFingerprint> {
  const current = await readVerifiedOwnedQuote(
    rpc,
    quoteId,
    ownedQuote.rootSourceOrderId,
    ownedQuote.originRootOrderId,
    ownedQuote.parentQuoteId,
    ownedQuote,
    ownedQuote.currentContractMonths,
    ownedQuote.templateClass,
    ownedQuote.templateId,
    ownedQuote.currencyRounding,
  );
  if (
    current.createDate !== ownedQuote.createDate ||
    current.writeDate !== ownedQuote.writeDate ||
    current.planId !== ownedQuote.planId ||
    current.templateId !== ownedQuote.templateId ||
    current.lineFingerprint !== ownedQuote.lineFingerprint
  ) {
    throw bridgeFailure('incompatible_response');
  }
  return current;
}

async function refreshOwnedQuoteAfterMutation(
  rpc: RenewalRpcContext,
  quoteId: number,
  ownedQuote: OwnedQuote,
): Promise<void> {
  const current = await readVerifiedOwnedQuote(
    rpc,
    quoteId,
    ownedQuote.rootSourceOrderId,
    ownedQuote.originRootOrderId,
    ownedQuote.parentQuoteId,
    ownedQuote,
    ownedQuote.currentContractMonths,
    ownedQuote.templateClass,
    ownedQuote.templateId,
    ownedQuote.currencyRounding,
  );
  if (
    current.createDate !== ownedQuote.createDate ||
    current.planId !== ownedQuote.planId ||
    current.templateId !== ownedQuote.templateId
  ) {
    throw bridgeFailure('incompatible_response');
  }
  ownedQuote.writeDate = current.writeDate;
  ownedQuote.lineFingerprint = current.lineFingerprint;
  ownedQuote.commercialLines = cloneCommercialLines(current.commercialLines);
}

function sanitizeQuoteAction(result: unknown): number {
  if (
    !isRecord(result) ||
    result.type !== 'ir.actions.act_window' ||
    result.res_model !== 'sale.order' ||
    !isPositiveId(result.res_id)
  ) {
    throw bridgeFailure('incompatible_response');
  }
  return result.res_id;
}

function sanitizeDiscountWizardAction(result: unknown): void {
  if (
    !isRecord(result) ||
    result.type !== 'ir.actions.act_window' ||
    result.res_model !== 'sale.order.discount' ||
    result.target !== 'new'
  ) {
    throw bridgeFailure('incompatible_response');
  }
}

function hasDiscountTypeSelection(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every(
      (option) =>
        Array.isArray(option) &&
        option.length === 2 &&
        typeof option[0] === 'string' &&
        option[0].length > 0 &&
        option[0].length <= 100 &&
        typeof option[1] === 'string' &&
        option[1].length <= 1_000,
    ) &&
    value.some((option) => option[0] === 'so_discount')
  );
}

async function assertDiscountWizardFieldDefinitions(rpc: RenewalRpcContext): Promise<void> {
  const result = await callKw(rpc, 'sale.order.discount', 'fields_get', [], {
    allfields: [...DISCOUNT_WIZARD_FIELDS],
    attributes: [...DISCOUNT_WIZARD_FIELD_ATTRIBUTES],
  });
  if (
    !isRecord(result) ||
    !isRecord(result.sale_order_id) ||
    result.sale_order_id.type !== 'many2one' ||
    result.sale_order_id.relation !== 'sale.order' ||
    result.sale_order_id.required !== true ||
    !isRecord(result.discount_type) ||
    result.discount_type.type !== 'selection' ||
    !hasDiscountTypeSelection(result.discount_type.selection) ||
    !isRecord(result.discount_percentage) ||
    result.discount_percentage.type !== 'float' ||
    !isRecord(result.discount_description) ||
    result.discount_description.type !== 'text'
  ) {
    throw bridgeFailure('incompatible_response');
  }
}

async function assertDiscountWizardContract(
  rpc: RenewalRpcContext,
  sourceOrderId: number,
): Promise<void> {
  const wizardAction = await callButton(
    rpc,
    'sale.order',
    'action_open_discount_wizard',
    sourceOrderId,
  );
  sanitizeDiscountWizardAction(wizardAction);
  await assertDiscountWizardFieldDefinitions(rpc);
}

function copyActionName(years: RenewalTargetYears): string {
  return years === 1 ? 'Copy to Yearly' : `Copy to ${years} Years`;
}

function activeSaleOrderContext(recordId: number): Record<string, unknown> {
  return {
    lang: 'en_US',
    active_model: 'sale.order',
    active_id: recordId,
    active_ids: [recordId],
  };
}

function hasExpectedCopyBindingViews(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const views = value.split(',').map((view) => view.trim());
  return (
    views.length === 2 &&
    new Set(views).size === 2 &&
    views.includes('list') &&
    views.includes('form')
  );
}

function sanitizeOptionalXmlId(value: unknown): void {
  if (value === false || value === null || value === undefined || value === '') return;
  if (
    typeof value !== 'string' ||
    value.length > 255 ||
    !/^[A-Za-z0-9_]+\.[A-Za-z0-9_.-]+$/.test(value)
  ) {
    throw bridgeFailure('incompatible_response');
  }
}

async function resolveCopyActionIds(
  rpc: RenewalRpcContext,
  sourceQuoteId: number,
  requiredYears: readonly RenewalTargetYears[],
): Promise<Map<RenewalTargetYears, number>> {
  const bindings = await callKw(rpc, 'ir.actions.actions', 'get_bindings', ['sale.order'], {
    context: { lang: 'en_US' },
  });
  if (!isRecord(bindings) || !Array.isArray(bindings.action)) {
    throw bridgeFailure('incompatible_response');
  }

  const resolved = new Map<RenewalTargetYears, number>();
  for (const years of requiredYears) {
    const expectedName = copyActionName(years);
    const matches = bindings.action.filter(
      (binding) => isRecord(binding) && binding.name === expectedName,
    );
    if (matches.length !== 1) throw bridgeFailure('incompatible_response');
    const binding = matches[0];
    if (
      !isRecord(binding) ||
      !isPositiveId(binding.id) ||
      !hasExpectedCopyBindingViews(binding.binding_view_types)
    ) {
      throw bridgeFailure('incompatible_response');
    }
    resolved.set(years, binding.id);
  }
  if (resolved.size !== requiredYears.length || new Set(resolved.values()).size !== resolved.size) {
    throw bridgeFailure('incompatible_response');
  }

  const bindingModelIds = new Set<number>();
  for (const [years, actionId] of resolved) {
    const expectedName = copyActionName(years);
    const loaded = await postJsonRpc(rpc, '/web/action/load', {
      action_id: actionId,
      context: activeSaleOrderContext(sourceQuoteId),
    });
    const bindingModel = isRecord(loaded) ? sanitizeMany2One(loaded.binding_model_id) : false;
    if (
      !isRecord(loaded) ||
      loaded.id !== actionId ||
      loaded.type !== 'ir.actions.server' ||
      loaded.name !== expectedName ||
      loaded.model_name !== 'sale.order' ||
      loaded.binding_type !== 'action' ||
      !hasExpectedCopyBindingViews(loaded.binding_view_types) ||
      !bindingModel
    ) {
      throw bridgeFailure('incompatible_response');
    }
    sanitizeOptionalXmlId(loaded.xml_id);
    bindingModelIds.add(bindingModel[0]);
  }
  if (bindingModelIds.size !== 1) throw bridgeFailure('incompatible_response');
  return resolved;
}

function sanitizeLineIds(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_QUOTE_LINES ||
    !value.every(isPositiveId) ||
    new Set(value).size !== value.length
  ) {
    throw bridgeFailure('incompatible_response');
  }
  return [...value];
}

function sanitizeTaxIds(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_LINE_TAXES ||
    !value.every(isPositiveId) ||
    new Set(value).size !== value.length
  ) {
    throw bridgeFailure('incompatible_response');
  }
  return [...value].sort((left, right) => left - right);
}

function sanitizeExtraTaxData(value: unknown): {
  serialized: string;
  isNativeGlobalDiscount: boolean;
} {
  if (value === false || value === null) {
    return { serialized: 'null', isNativeGlobalDiscount: false };
  }
  if (!isRecord(value)) throw bridgeFailure('incompatible_response');
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw bridgeFailure('incompatible_response');
  }
  if (serialized.length > 100_000) throw bridgeFailure('incompatible_response');
  const computationKey = value.computation_key;
  return {
    serialized,
    isNativeGlobalDiscount:
      typeof computationKey === 'string' && /^global_discount,[1-9]\d*$/.test(computationKey),
  };
}

async function readQuoteLineIds(rpc: RenewalRpcContext, quoteId: number): Promise<number[]> {
  await assertFieldDefinitions(rpc, 'sale.order', {
    state: { type: 'selection' },
    order_line: { type: 'one2many', relation: 'sale.order.line' },
  });
  const quote = await readOne(rpc, 'sale.order', quoteId, ['state', 'order_line']);
  if (quote.state !== 'draft') {
    throw bridgeFailure('incompatible_response');
  }
  return sanitizeLineIds(quote.order_line);
}

function sanitizeQuoteLine(
  record: Record<string, unknown>,
  quoteId: number,
): RenewalQuoteLineSummary {
  const order = sanitizeMany2One(record.order_id);
  if (!order || order[0] !== quoteId || !isPositiveId(record.id)) {
    throw bridgeFailure('incompatible_response');
  }
  const product = sanitizeMany2One(record.product_id);
  if (
    record.display_type !== false &&
    record.display_type !== null &&
    typeof record.display_type !== 'string'
  ) {
    throw bridgeFailure('incompatible_response');
  }
  const displayType = record.display_type;
  const quantity = sanitizeFiniteNumber(record.product_uom_qty);
  const unitPrice = sanitizeFiniteNumber(record.price_unit);
  const subtotal = sanitizeFiniteNumber(record.price_subtotal);
  const total = sanitizeFiniteNumber(record.price_total);
  const sequence = record.sequence;
  if (!Number.isSafeInteger(sequence) || Number(sequence) < 0 || Number(sequence) > 1_000_000) {
    throw bridgeFailure('incompatible_response');
  }
  sanitizeBoundedText(record.name);
  sanitizeServerWriteDate(record.write_date);
  const taxIds = sanitizeTaxIds(record.tax_ids);
  const extraTaxData = sanitizeExtraTaxData(record.extra_tax_data);
  const isMultiYearDiscount = Boolean(
    product &&
    extraTaxData.isNativeGlobalDiscount &&
    (displayType === false || displayType === null) &&
    sequence === 999,
  );
  return {
    lineId: record.id,
    productId: product ? product[0] : null,
    sequence: Number(sequence),
    quantity,
    unitPrice,
    subtotal,
    total,
    taxIds,
    isMultiYearDiscount,
  };
}

async function readQuoteLines(
  rpc: RenewalRpcContext,
  quoteId: number,
): Promise<RenewalQuoteLineSummary[]> {
  const lineIds = await readQuoteLineIds(rpc, quoteId);
  if (lineIds.length === 0) return [];
  const lines = await readMany(rpc, 'sale.order.line', lineIds, QUOTE_LINE_FIELDS);
  return lines.map((line) => sanitizeQuoteLine(line, quoteId));
}

function sanitizeShareLink(value: unknown, quoteId: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw bridgeFailure('incompatible_response');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw bridgeFailure('incompatible_response');
  }
  if (
    url.origin !== ODOO_BRIDGE_ORIGIN ||
    url.pathname !== '/mail/view' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.searchParams.get('model') !== 'sale.order' ||
    url.searchParams.get('res_id') !== String(quoteId) ||
    !url.searchParams.get('access_token')
  ) {
    throw bridgeFailure('incompatible_response');
  }
  const allowedParameters = new Set(['model', 'res_id', 'access_token']);
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!allowedParameters.has(key) || seen.has(key)) {
      throw bridgeFailure('incompatible_response');
    }
    seen.add(key);
  }
  return url.href;
}

function isValidCommercialLineSnapshot(value: unknown): value is RenewalCommercialLineSnapshot {
  if (
    !isRecord(value) ||
    (value.productId !== null && !isPositiveId(value.productId)) ||
    (value.displayType !== null && typeof value.displayType !== 'string') ||
    typeof value.name !== 'string' ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 0 ||
    !Number.isFinite(value.quantity) ||
    !Number.isFinite(value.unitPrice) ||
    !Number.isFinite(value.subtotal) ||
    !Number.isFinite(value.total) ||
    !Array.isArray(value.taxIds) ||
    value.taxIds.length > MAX_LINE_TAXES ||
    !value.taxIds.every(isPositiveId) ||
    new Set(value.taxIds).size !== value.taxIds.length ||
    typeof value.isNativeGlobalDiscount !== 'boolean'
  ) {
    return false;
  }
  try {
    sanitizeBoundedText(value.name);
    return true;
  } catch {
    return false;
  }
}

export class RenewalOwnershipRegistry {
  private readonly clients = new Map<string, Map<string, Map<number, OwnedQuote>>>();
  private readonly pendingCreations = new Map<string, Map<string, PendingQuoteCreation>>();
  private readonly copyActions = new Map<string, Map<string, Map<RenewalTargetYears, number>>>();

  register(
    clientId: string,
    runId: string,
    quoteId: number,
    fingerprint: RenewalOwnedQuoteFingerprint,
  ): void {
    let runs = this.clients.get(clientId);
    if (!runs) {
      runs = new Map();
      this.clients.set(clientId, runs);
    }
    let quotes = runs.get(runId);
    if (!quotes) {
      quotes = new Map();
      runs.set(runId, quotes);
    }
    if (quotes.size >= MAX_QUOTES_PER_RUN || quotes.has(quoteId)) {
      throw bridgeFailure('incompatible_response');
    }
    if (
      fingerprint.parentQuoteId === quoteId ||
      !isPositiveId(fingerprint.rootSourceOrderId) ||
      !isPositiveId(fingerprint.originRootOrderId) ||
      !isPositiveId(fingerprint.parentQuoteId) ||
      !isPositiveId(fingerprint.partnerId) ||
      !isPositiveId(fingerprint.companyId) ||
      !isPositiveId(fingerprint.currencyId) ||
      !isPositiveId(fingerprint.pricelistId) ||
      !isPositiveId(fingerprint.planId) ||
      !isPositiveId(fingerprint.templateId) ||
      (fingerprint.templateClass !== 'standard' && fingerprint.templateClass !== 'custom') ||
      !Number.isFinite(fingerprint.currencyRounding) ||
      fingerprint.currencyRounding <= 0 ||
      !Number.isSafeInteger(fingerprint.currentContractMonths) ||
      fingerprint.currentContractMonths <= 0 ||
      typeof fingerprint.lineFingerprint !== 'string' ||
      fingerprint.lineFingerprint.length > 2_000_000 ||
      !Array.isArray(fingerprint.commercialLines) ||
      fingerprint.commercialLines.length > MAX_QUOTE_LINES ||
      !fingerprint.commercialLines.every(isValidCommercialLineSnapshot)
    ) {
      throw bridgeFailure('incompatible_response');
    }
    sanitizeServerWriteDate(fingerprint.createDate);
    sanitizeServerWriteDate(fingerprint.writeDate);
    quotes.set(quoteId, {
      ...fingerprint,
      commercialLines: cloneCommercialLines(fingerprint.commercialLines),
    });
  }

  require(clientId: string, runId: string, quoteId: number): OwnedQuote {
    const quote = this.clients.get(clientId)?.get(runId)?.get(quoteId);
    if (!quote) throw bridgeFailure('incompatible_endpoint');
    return quote;
  }

  registerCopyAction(
    clientId: string,
    runId: string,
    years: RenewalTargetYears,
    actionId: number,
  ): void {
    if (!isPositiveId(actionId)) throw bridgeFailure('incompatible_response');
    let runs = this.copyActions.get(clientId);
    if (!runs) {
      runs = new Map();
      this.copyActions.set(clientId, runs);
    }
    let actions = runs.get(runId);
    if (!actions) {
      actions = new Map();
      runs.set(runId, actions);
    }
    if (actions.has(years)) throw bridgeFailure('incompatible_response');
    actions.set(years, actionId);
  }

  requireCopyAction(clientId: string, runId: string, years: RenewalTargetYears): number {
    const actionId = this.copyActions.get(clientId)?.get(runId)?.get(years);
    if (!actionId) throw bridgeFailure('incompatible_endpoint');
    return actionId;
  }

  beginCreation(
    clientId: string,
    runId: string,
    pending: Omit<PendingQuoteCreation, 'responseReceived' | 'returnedQuoteId'>,
  ): void {
    let runs = this.pendingCreations.get(clientId);
    if (!runs) {
      runs = new Map();
      this.pendingCreations.set(clientId, runs);
    }
    if (runs.has(runId)) throw bridgeFailure('incompatible_endpoint');
    runs.set(runId, {
      ...pending,
      expectedIdentity: { ...pending.expectedIdentity },
      sourceCommercialLines: cloneCommercialLines(pending.sourceCommercialLines),
      existingLinkedQuoteIds: new Set(pending.existingLinkedQuoteIds),
      responseReceived: false,
      returnedQuoteId: null,
    });
  }

  markCreationResponseReceived(
    clientId: string,
    runId: string,
    returnedQuoteId: number | null = null,
  ): void {
    const pending = this.pendingCreations.get(clientId)?.get(runId);
    if (!pending) throw bridgeFailure('incompatible_endpoint');
    if (returnedQuoteId !== null && !isPositiveId(returnedQuoteId)) {
      throw bridgeFailure('incompatible_response');
    }
    pending.responseReceived = true;
    pending.returnedQuoteId = returnedQuoteId;
  }

  getPendingCreation(clientId: string, runId: string): PendingQuoteCreation | null {
    return this.pendingCreations.get(clientId)?.get(runId) ?? null;
  }

  finishCreation(clientId: string, runId: string): void {
    const runs = this.pendingCreations.get(clientId);
    if (!runs) return;
    runs.delete(runId);
    if (runs.size === 0) this.pendingCreations.delete(clientId);
  }

  finishRun(clientId: string, runId: string): void {
    const ownedRuns = this.clients.get(clientId);
    ownedRuns?.delete(runId);
    if (ownedRuns?.size === 0) this.clients.delete(clientId);

    const pendingRuns = this.pendingCreations.get(clientId);
    pendingRuns?.delete(runId);
    if (pendingRuns?.size === 0) this.pendingCreations.delete(clientId);

    const actionRuns = this.copyActions.get(clientId);
    actionRuns?.delete(runId);
    if (actionRuns?.size === 0) this.copyActions.delete(clientId);
  }
}

async function executeRenewalOperation(
  operation: RenewalBridgeOperation,
  clientId: string,
  ownership: RenewalOwnershipRegistry,
  rpc: RenewalRpcContext,
): Promise<unknown> {
  if (operation.name === 'preflightRenewal') {
    return readPreflight(rpc, operation.sourceOrderId);
  }

  if (operation.name === 'finishRenewalRun') {
    ownership.finishRun(clientId, operation.runId);
    return true;
  }

  if (operation.name === 'createNativeRenewal') {
    const current = await readPreflight(rpc, operation.sourceOrderId);
    if (
      !current.eligible ||
      current.planId !== operation.expected.planId ||
      current.currentContractMonths !== operation.expected.currentContractMonths ||
      current.writeDate !== operation.expected.writeDate
    ) {
      throw bridgeFailure('incompatible_response');
    }
    await assertOwnershipFieldDefinitions(rpc);
    if (operation.requiredCopyYears.length > 0) {
      const copyActions = await resolveCopyActionIds(
        rpc,
        operation.sourceOrderId,
        operation.requiredCopyYears,
      );
      for (const [years, actionId] of copyActions) {
        ownership.registerCopyAction(clientId, operation.runId, years, actionId);
      }
    }
    if (operation.requiresDiscount) {
      await assertDiscountWizardContract(rpc, operation.sourceOrderId);
    }
    const sourceBeforeMutation = await readSourceCreationFingerprint(rpc, operation.sourceOrderId);
    const existingLinkedQuotes = await readLinkedRenewalQuoteIds(rpc, operation.sourceOrderId);
    const finalPreflight = await readPreflight(rpc, operation.sourceOrderId);
    const sourceAtMutation = await readSourceCreationFingerprint(rpc, operation.sourceOrderId);
    if (
      !finalPreflight.eligible ||
      finalPreflight.planId !== operation.expected.planId ||
      finalPreflight.currentContractMonths !== operation.expected.currentContractMonths ||
      finalPreflight.writeDate !== operation.expected.writeDate ||
      !sameCommercialIdentity(sourceBeforeMutation.identity, sourceAtMutation.identity) ||
      sourceBeforeMutation.originRootOrderId !== sourceAtMutation.originRootOrderId ||
      sourceBeforeMutation.planId !== sourceAtMutation.planId ||
      sourceAtMutation.planId !== finalPreflight.planId ||
      sourceBeforeMutation.templateId !== sourceAtMutation.templateId ||
      sourceBeforeMutation.lineFingerprint !== sourceAtMutation.lineFingerprint
    ) {
      throw bridgeFailure('incompatible_response');
    }
    const sourceTemplateClass = await validateUniqueTemplateForPlan(
      rpc,
      sourceAtMutation.templateId,
      sourceAtMutation.planId,
    );
    const currencyRounding = await readCurrencyRounding(rpc, sourceAtMutation.identity.currencyId);
    ownership.beginCreation(clientId, operation.runId, {
      rootSourceOrderId: operation.sourceOrderId,
      originRootOrderId: sourceAtMutation.originRootOrderId,
      parentQuoteId: operation.sourceOrderId,
      expectedIdentity: sourceAtMutation.identity,
      expectedMonths: current.currentContractMonths,
      sourceMonths: current.currentContractMonths,
      expectedTemplateClass: sourceTemplateClass,
      expectedTemplateId: sourceAtMutation.templateId,
      currencyRounding,
      sourceCommercialLines: sourceAtMutation.commercialLines,
      compareNativeDiscountLines: true,
      priceMode: 'same',
      existingLinkedQuoteIds: existingLinkedQuotes,
    });
    const action = await callButton(
      rpc,
      'sale.order',
      'prepare_renewal_order',
      operation.sourceOrderId,
    );
    ownership.markCreationResponseReceived(clientId, operation.runId);
    const quoteId = sanitizeQuoteAction(action);
    if (quoteId === operation.sourceOrderId || existingLinkedQuotes.has(quoteId)) {
      throw bridgeFailure('incompatible_response');
    }
    ownership.markCreationResponseReceived(clientId, operation.runId, quoteId);
    const fingerprint = await readVerifiedOwnedQuote(
      rpc,
      quoteId,
      operation.sourceOrderId,
      sourceAtMutation.originRootOrderId,
      operation.sourceOrderId,
      sourceAtMutation.identity,
      current.currentContractMonths,
      sourceTemplateClass,
      sourceAtMutation.templateId,
      currencyRounding,
    );
    const pending = ownership.getPendingCreation(clientId, operation.runId);
    if (!pending) throw bridgeFailure('incompatible_endpoint');
    await assertCreatedQuoteTransformation(rpc, fingerprint, pending);
    ownership.register(clientId, operation.runId, quoteId, fingerprint);
    ownership.finishCreation(clientId, operation.runId);
    return { quoteId };
  }

  if (operation.name === 'copyNativePlan') {
    const sourceOwnedQuote = ownership.require(clientId, operation.runId, operation.sourceQuoteId);
    const sourceMonths = sourceOwnedQuote.currentContractMonths;
    const targetMonths = operation.years * 12;
    if (targetMonths <= sourceMonths) throw bridgeFailure('incompatible_endpoint');
    const expectedActionId = ownership.requireCopyAction(
      clientId,
      operation.runId,
      operation.years,
    );
    await assertOwnedQuoteStillMatches(rpc, operation.sourceQuoteId, sourceOwnedQuote);
    const existingLinkedQuotes = await readLinkedRenewalQuoteIds(
      rpc,
      sourceOwnedQuote.rootSourceOrderId,
    );
    await assertOwnedQuoteStillMatches(rpc, operation.sourceQuoteId, sourceOwnedQuote);
    ownership.beginCreation(clientId, operation.runId, {
      rootSourceOrderId: sourceOwnedQuote.rootSourceOrderId,
      originRootOrderId: sourceOwnedQuote.originRootOrderId,
      parentQuoteId: operation.sourceQuoteId,
      expectedIdentity: sourceOwnedQuote,
      expectedMonths: targetMonths,
      sourceMonths,
      expectedTemplateClass: sourceOwnedQuote.templateClass,
      expectedTemplateId: null,
      currencyRounding: sourceOwnedQuote.currencyRounding,
      sourceCommercialLines: sourceOwnedQuote.commercialLines,
      compareNativeDiscountLines: false,
      priceMode: sourceMonths < 12 && targetMonths === 12 ? 'annual-reprice' : 'duration-scale',
      existingLinkedQuoteIds: existingLinkedQuotes,
    });
    const action = await postJsonRpc(rpc, '/web/action/run', {
      action_id: expectedActionId,
      context: activeSaleOrderContext(operation.sourceQuoteId),
    });
    ownership.markCreationResponseReceived(clientId, operation.runId);
    const quoteId = sanitizeQuoteAction(action);
    if (quoteId === operation.sourceQuoteId || existingLinkedQuotes.has(quoteId)) {
      throw bridgeFailure('incompatible_response');
    }
    ownership.markCreationResponseReceived(clientId, operation.runId, quoteId);
    const fingerprint = await readVerifiedOwnedQuote(
      rpc,
      quoteId,
      sourceOwnedQuote.rootSourceOrderId,
      sourceOwnedQuote.originRootOrderId,
      operation.sourceQuoteId,
      sourceOwnedQuote,
      targetMonths,
      sourceOwnedQuote.templateClass,
      null,
      sourceOwnedQuote.currencyRounding,
    );
    const pending = ownership.getPendingCreation(clientId, operation.runId);
    if (!pending) throw bridgeFailure('incompatible_endpoint');
    await assertCreatedQuoteTransformation(rpc, fingerprint, pending);
    ownership.register(clientId, operation.runId, quoteId, fingerprint);
    ownership.finishCreation(clientId, operation.runId);
    return { quoteId };
  }

  const ownedQuote = ownership.require(clientId, operation.runId, operation.quoteId);
  await assertOwnedQuoteStillMatches(rpc, operation.quoteId, ownedQuote);

  if (operation.name === 'clearNativeMultiYearDiscount') {
    const lines = await readQuoteLines(rpc, operation.quoteId);
    const discountLineIds = lines
      .filter((line) => line.isMultiYearDiscount)
      .map((line) => line.lineId);
    if (discountLineIds.length === 0) return { removedLineCount: 0 };
    await assertOwnedQuoteStillMatches(rpc, operation.quoteId, ownedQuote);
    const removed = await callKw(rpc, 'sale.order.line', 'unlink', [discountLineIds], {});
    if (removed !== true) throw bridgeFailure('incompatible_response');
    await refreshOwnedQuoteAfterMutation(rpc, operation.quoteId, ownedQuote);
    const remaining = await readQuoteLines(rpc, operation.quoteId);
    if (remaining.some((line) => line.isMultiYearDiscount)) {
      throw bridgeFailure('incompatible_response');
    }
    return { removedLineCount: discountLineIds.length };
  }

  if (operation.name === 'applyNativeGlobalDiscount') {
    const existing = await readQuoteLines(rpc, operation.quoteId);
    if (existing.some((line) => line.isMultiYearDiscount)) {
      throw bridgeFailure('incompatible_endpoint');
    }
    const wizardAction = await callButton(
      rpc,
      'sale.order',
      'action_open_discount_wizard',
      operation.quoteId,
    );
    sanitizeDiscountWizardAction(wizardAction);
    await assertDiscountWizardFieldDefinitions(rpc);
    const wizardValues: Record<string, unknown> = {
      sale_order_id: operation.quoteId,
      discount_type: 'so_discount',
      discount_percentage: operation.percentageTenths / 1_000,
      discount_description: '',
    };
    const wizardId = await callKw(rpc, 'sale.order.discount', 'create', [wizardValues], {});
    if (!isPositiveId(wizardId)) throw bridgeFailure('incompatible_response');
    await assertOwnedQuoteStillMatches(rpc, operation.quoteId, ownedQuote);
    const applied = await callButton(rpc, 'sale.order.discount', 'action_apply_discount', wizardId);
    if (applied !== false) throw bridgeFailure('incompatible_response');
    await refreshOwnedQuoteAfterMutation(rpc, operation.quoteId, ownedQuote);
    const created = (await readQuoteLines(rpc, operation.quoteId)).filter(
      (line) => line.isMultiYearDiscount,
    );
    if (created.length === 0) throw bridgeFailure('incompatible_response');
    return { createdLineCount: created.length };
  }

  if (operation.name === 'getNativeShareLink') {
    const lineFingerprintBeforeShare = ownedQuote.lineFingerprint;
    const defaults = await callKw(rpc, 'portal.share', 'default_get', [['share_link']], {
      context: activeSaleOrderContext(operation.quoteId),
    });
    if (!isRecord(defaults)) throw bridgeFailure('incompatible_response');
    await refreshOwnedQuoteAfterMutation(rpc, operation.quoteId, ownedQuote);
    if (ownedQuote.lineFingerprint !== lineFingerprintBeforeShare) {
      throw bridgeFailure('incompatible_response');
    }
    return {
      quoteId: operation.quoteId,
      shareLink: sanitizeShareLink(defaults.share_link, operation.quoteId),
    };
  }

  const quote = await readOne(rpc, 'sale.order', operation.quoteId, QUOTE_SUMMARY_FIELDS);
  const name = sanitizeLabel(quote.name);
  const state = sanitizeLabel(quote.state, 40);
  const subscriptionState =
    quote.subscription_state === false || quote.subscription_state === null
      ? null
      : sanitizeLabel(quote.subscription_state, 40);
  const plan = sanitizeMany2One(quote.plan_id);
  const template = sanitizeMany2One(quote.sale_order_template_id);
  const currency = sanitizeMany2One(quote.currency_id);
  if (!plan || !currency) throw bridgeFailure('incompatible_response');
  const period = await readPlanPeriod(rpc, plan[0]);
  const currencyRounding = await readCurrencyRounding(rpc, currency[0]);
  const lines = await readQuoteLines(rpc, operation.quoteId);
  const summary: RenewalQuoteSummary = {
    quoteId: operation.quoteId,
    createdFromQuoteId: ownedQuote.parentQuoteId,
    name,
    state,
    subscriptionState,
    planId: plan[0],
    ...period,
    templateId: template ? template[0] : null,
    currencyId: currency[0],
    currencyRounding,
    amountUntaxed: sanitizeFiniteNumber(quote.amount_untaxed),
    amountTax: sanitizeFiniteNumber(quote.amount_tax),
    amountTotal: sanitizeFiniteNumber(quote.amount_total),
    lineCount: lines.length,
    multiYearDiscountLineCount: lines.filter((line) => line.isMultiYearDiscount).length,
    lines,
  };
  return summary;
}

function creationRunId(operation: RenewalBridgeOperation): string | null {
  return operation.name === 'createNativeRenewal' || operation.name === 'copyNativePlan'
    ? operation.runId
    : null;
}

function waitForReconciliation(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (isRecord(error) && error.name === 'AbortError')
  );
}

function isUncertainTransportError(error: unknown): boolean {
  return isAbortError(error) || error instanceof TypeError;
}

type ReconciliationAttempt =
  { kind: 'found'; quoteId: number } | { kind: 'retry' } | { kind: 'terminal' };

async function attemptPendingCreationReconciliation(
  ownership: RenewalOwnershipRegistry,
  clientId: string,
  runId: string,
  pending: PendingQuoteCreation,
  rpc: RenewalRpcContext,
): Promise<ReconciliationAttempt> {
  try {
    const linkedQuoteIds = await readLinkedRenewalQuoteIds(rpc, pending.rootSourceOrderId);
    const candidates = [...linkedQuoteIds].filter(
      (quoteId) => !pending.existingLinkedQuoteIds.has(quoteId),
    );
    // More than one new quote is ambiguous and must never be guessed.
    if (candidates.length > 1) return { kind: 'terminal' };
    const quoteId = candidates[0];
    if (!quoteId || quoteId === pending.parentQuoteId) return { kind: 'retry' };

    const fingerprint = await readVerifiedOwnedQuote(
      rpc,
      quoteId,
      pending.rootSourceOrderId,
      pending.originRootOrderId,
      pending.parentQuoteId,
      pending.expectedIdentity,
      pending.expectedMonths,
      pending.expectedTemplateClass,
      pending.expectedTemplateId,
      pending.currencyRounding,
    );
    await assertCreatedQuoteTransformation(rpc, fingerprint, pending);
    ownership.register(clientId, runId, quoteId, fingerprint);
    ownership.finishCreation(clientId, runId);
    return { kind: 'found', quoteId };
  } catch (error) {
    return isUncertainTransportError(error) ? { kind: 'retry' } : { kind: 'terminal' };
  }
}

async function reconcilePendingCreation(
  ownership: RenewalOwnershipRegistry,
  clientId: string,
  runId: string,
  options: {
    fetcher: typeof fetch;
    origin: string;
    requestId: string | null;
    delayMs: number;
    timeoutMs: number;
    pollIntervalMs: number;
  },
): Promise<number | null> {
  const pending = ownership.getPendingCreation(clientId, runId);
  if (!pending) return null;
  await waitForReconciliation(options.delayMs);

  const controller = new AbortController();
  const timeoutMs = Math.max(0, options.timeoutMs);
  const deadline = Date.now() + timeoutMs;
  const rpc: RenewalRpcContext = {
    fetcher: options.fetcher,
    origin: options.origin,
    requestId: options.requestId,
    signal: controller.signal,
  };
  // Start the first read before arming even a zero-millisecond timeout. This guarantees one
  // reconciliation observation without extending the bounded timeout around a stalled fetch.
  const firstAttempt = attemptPendingCreationReconciliation(
    ownership,
    clientId,
    runId,
    pending,
    rpc,
  );
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    let attempt = await firstAttempt;
    while (true) {
      if (attempt.kind === 'found') return attempt.quoteId;
      if (attempt.kind === 'terminal') return null;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0 || controller.signal.aborted) return null;
      await waitForReconciliation(Math.min(options.pollIntervalMs, remainingMs));
      if (controller.signal.aborted || Date.now() > deadline) return null;
      attempt = await attemptPendingCreationReconciliation(
        ownership,
        clientId,
        runId,
        pending,
        rpc,
      );
    }
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function executeOdooRenewalOperation(
  operation: RenewalBridgeOperation,
  options: {
    fetcher?: typeof fetch;
    origin?: string;
    timeoutMs?: number;
    requestId?: string;
    clientId?: string;
    ownership?: RenewalOwnershipRegistry;
    reconciliationDelayMs?: number;
    reconciliationTimeoutMs?: number;
    reconciliationPollIntervalMs?: number;
  } = {},
): Promise<RenewalExecutionResult> {
  if (!isRenewalBridgeOperation(operation)) {
    return { ok: false, failure: bridgeFailure('incompatible_endpoint') };
  }
  const origin = options.origin ?? window.location.origin;
  if (origin !== ODOO_BRIDGE_ORIGIN) {
    return { ok: false, failure: bridgeFailure('incompatible_endpoint') };
  }
  const controller = new AbortController();
  const fetcher = options.fetcher ?? window.fetch.bind(window);
  const clientId = options.clientId ?? 'client-direct-renewal';
  const ownership = options.ownership ?? new RenewalOwnershipRegistry();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? RENEWAL_RUNTIME_TIMEOUT_MS,
  );
  const rpc: RenewalRpcContext = {
    fetcher,
    origin,
    requestId: options.requestId ?? null,
    signal: controller.signal,
  };
  try {
    const result = await executeRenewalOperation(operation, clientId, ownership, rpc);
    return { ok: true, result };
  } catch (error) {
    const pendingRunId = creationRunId(operation);
    const pendingCreation = pendingRunId
      ? ownership.getPendingCreation(clientId, pendingRunId)
      : null;
    const uncertainTransport = isUncertainTransportError(error);

    // The Odoo action returned a concrete new quote ID, but a later local ownership
    // check failed. Expose the ID only as an unknown result and stop the controller;
    // never authorize subsequent mutation or Share calls for this unverified quote.
    if (pendingRunId && pendingCreation?.responseReceived && pendingCreation.returnedQuoteId) {
      ownership.finishCreation(clientId, pendingRunId);
      return {
        ok: true,
        result: {
          quoteId: pendingCreation.returnedQuoteId,
          reconciledAfterValidationFailure: true,
        },
      };
    }

    if (
      pendingRunId &&
      pendingCreation &&
      (uncertainTransport || pendingCreation.responseReceived)
    ) {
      const reconciledQuoteId = await reconcilePendingCreation(ownership, clientId, pendingRunId, {
        fetcher,
        origin,
        requestId: options.requestId ?? null,
        delayMs: options.reconciliationDelayMs ?? RENEWAL_RECONCILIATION_DELAY_MS,
        timeoutMs: options.reconciliationTimeoutMs ?? RENEWAL_RECONCILIATION_TIMEOUT_MS,
        pollIntervalMs:
          options.reconciliationPollIntervalMs ?? RENEWAL_RECONCILIATION_POLL_INTERVAL_MS,
      });
      if (reconciledQuoteId) {
        return {
          ok: true,
          result: uncertainTransport
            ? { quoteId: reconciledQuoteId, reconciledAfterTimeout: true }
            : { quoteId: reconciledQuoteId, reconciledAfterValidationFailure: true },
        };
      }
      ownership.finishCreation(clientId, pendingRunId);
      if (uncertainTransport) return { ok: false, failure: bridgeFailure('timeout') };
    }
    if (pendingRunId && pendingCreation) ownership.finishCreation(clientId, pendingRunId);
    if (isAbortError(error)) {
      return { ok: false, failure: bridgeFailure('timeout') };
    }
    if (isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string') {
      return { ok: false, failure: error as unknown as OdooBridgeFailure };
    }
    return { ok: false, failure: bridgeFailure('network') };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
