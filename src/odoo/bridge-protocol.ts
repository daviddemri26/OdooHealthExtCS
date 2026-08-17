import type { CompatibilityCode } from '../shared/types';
import type {
  CustomerDataBridgeOperation,
  CustomerDataUndoResult,
  HealthMutationResult,
  IndustryMutationResult,
} from './customer-data-contracts';
import type {
  RenewalBridgeOperation,
  RenewalCreatedQuoteResult,
  RenewalDiscountApplyResult,
  RenewalDiscountClearResult,
  RenewalIntermediateCancellationResult,
  RenewalPreflightResponse,
  RenewalQuoteLineSummary,
  RenewalQuoteSummary,
  RenewalShareLinkResult,
  RenewalTargetYears,
} from './renewal-contracts';

export const ODOO_BRIDGE_CHANNEL = 'odoo-health-ext-cs:rpc';
export const ODOO_BRIDGE_VERSION = 6 as const;
export const ODOO_BRIDGE_ORIGIN = 'https://www.odoo.com';
export const MAX_SUBSCRIPTION_LIST_BATCH = 100;

export const CANONICAL_HEALTH_NAMES = ['Health - High', 'Health - Medium', 'Health - Low'] as const;

export type OdooBridgeFailureCode = Extract<
  CompatibilityCode,
  | 'bridge_unavailable'
  | 'timeout'
  | 'network'
  | 'session_expired'
  | 'access_denied'
  | 'incompatible_endpoint'
  | 'incompatible_response'
  | 'server_error'
>;

export interface OdooBridgeFailure {
  code: OdooBridgeFailureCode;
  message: string;
}

export interface OdooConnectionProbeResult {
  authenticated: true;
  userDisplayName?: string;
}

export interface OdooBridgeCall {
  model: string;
  method: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
}

interface OdooBridgeRequestBase {
  channel: typeof ODOO_BRIDGE_CHANNEL;
  version: typeof ODOO_BRIDGE_VERSION;
  direction: 'request';
  clientId: string;
  requestId: string;
}

export type OdooBridgeRequest = OdooBridgeRequestBase &
  (
    | { kind: 'ping' }
    | { kind: 'probe' }
    | {
        kind: 'call';
        call: OdooBridgeCall;
      }
    | {
        kind: 'renewal';
        operation: RenewalBridgeOperation;
      }
    | {
        kind: 'customerData';
        operation: CustomerDataBridgeOperation;
      }
  );

interface OdooBridgeResponseBase {
  channel: typeof ODOO_BRIDGE_CHANNEL;
  version: typeof ODOO_BRIDGE_VERSION;
  direction: 'response';
  clientId: string;
  requestId: string;
}

export type OdooBridgeResponse = OdooBridgeResponseBase &
  (
    | { ok: true; result: unknown }
    | {
        ok: false;
        failure: OdooBridgeFailure;
      }
  );

export type BridgeCallValidation = { ok: true } | { ok: false; failure: OdooBridgeFailure };

const FAILURE_MESSAGES: Record<OdooBridgeFailureCode, string> = {
  bridge_unavailable: 'The extension connection is unavailable. Reload this Odoo tab.',
  timeout: 'The Odoo request timed out. Please retry.',
  network: 'The browser could not reach Odoo. Check your connection and retry.',
  session_expired: 'Your Odoo session has expired. Sign in again and retry.',
  access_denied: 'Odoo did not allow this action. Check your record permissions.',
  incompatible_endpoint: 'This Odoo endpoint is not compatible with the extension.',
  incompatible_response: 'This Odoo version returned an unsupported response.',
  server_error: 'Odoo could not complete the request.',
};

export function bridgeFailure(code: OdooBridgeFailureCode): OdooBridgeFailure {
  return { code, message: FAILURE_MESSAGES[code] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,128}$/.test(value);
}

function isServerWriteDate(value: unknown): value is string {
  return (
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)
  );
}

function isPositiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isSignedNonzeroId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) !== 0;
}

function isIdList(value: unknown, maximum = 1): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximum &&
    value.every(isPositiveId) &&
    new Set(value).size === value.length
  );
}

function isSignedNonzeroIdList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 1 && value.every(isSignedNonzeroId);
}

function hasExactStringArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function isAllowedFieldsGet(call: OdooBridgeCall): boolean {
  if (call.method !== 'fields_get' || call.args.length !== 0) return false;
  if (!hasExactKeys(call.kwargs, ['allfields', 'attributes'])) return false;
  if (!hasExactStringArray(call.kwargs.attributes, ['type', 'relation', 'readonly', 'string'])) {
    return false;
  }
  return (
    (call.model === 'sale.order' && hasExactStringArray(call.kwargs.allfields, ['tag_ids'])) ||
    (call.model === 'res.partner' && hasExactStringArray(call.kwargs.allfields, ['industry_id']))
  );
}

function isAllowedRead(call: OdooBridgeCall): boolean {
  if (call.method !== 'read' || call.args.length !== 2 || !isEmptyRecord(call.kwargs)) {
    return false;
  }
  const ids = call.args[0];
  const fields = call.args[1];
  if (call.model === 'sale.order') {
    return (
      isIdList(ids) &&
      (hasExactStringArray(fields, ['tag_ids']) || hasExactStringArray(fields, ['partner_id']))
    );
  }
  return (
    call.model === 'res.partner' &&
    isSignedNonzeroIdList(ids) &&
    hasExactStringArray(fields, ['industry_id'])
  );
}

function isHealthDomain(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const clause = value[0];
  return (
    Array.isArray(clause) &&
    clause.length === 3 &&
    clause[0] === 'name' &&
    clause[1] === 'in' &&
    hasExactStringArray(clause[2], CANONICAL_HEALTH_NAMES)
  );
}

function getSubscriptionListNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const clause = value[0];
  if (
    !Array.isArray(clause) ||
    clause.length !== 3 ||
    clause[0] !== 'name' ||
    clause[1] !== 'in' ||
    !Array.isArray(clause[2]) ||
    clause[2].length === 0 ||
    clause[2].length > MAX_SUBSCRIPTION_LIST_BATCH
  ) {
    return null;
  }
  const names = clause[2];
  if (
    !names.every(
      (name) =>
        typeof name === 'string' &&
        name.length > 0 &&
        name.length <= 160 &&
        name.trim() === name &&
        !hasControlCharacters(name),
    ) ||
    new Set(names).size !== names.length
  ) {
    return null;
  }
  return names as string[];
}

function isAllowedSearchRead(call: OdooBridgeCall): boolean {
  if (call.method !== 'search_read' || call.args.length !== 1) return false;
  if (call.model === 'crm.tag') {
    return (
      isHealthDomain(call.args[0]) &&
      hasExactKeys(call.kwargs, ['fields', 'limit']) &&
      hasExactStringArray(call.kwargs.fields, ['id', 'name']) &&
      call.kwargs.limit === 20
    );
  }
  if (call.model === 'sale.order') {
    const names = getSubscriptionListNames(call.args[0]);
    return Boolean(
      names &&
      hasExactKeys(call.kwargs, ['fields', 'limit']) &&
      hasExactStringArray(call.kwargs.fields, ['id', 'name', 'tag_ids']) &&
      call.kwargs.limit === names.length * 2,
    );
  }
  return (
    call.model === 'res.partner.industry' &&
    Array.isArray(call.args[0]) &&
    call.args[0].length === 0 &&
    hasExactKeys(call.kwargs, ['fields', 'limit', 'order']) &&
    hasExactStringArray(call.kwargs.fields, ['id', 'name']) &&
    call.kwargs.limit === 500 &&
    call.kwargs.order === 'name asc'
  );
}

export function validateOdooBridgeCall(call: OdooBridgeCall): BridgeCallValidation {
  if (
    !isRecord(call) ||
    !hasExactKeys(call, ['model', 'method', 'args', 'kwargs']) ||
    typeof call.model !== 'string' ||
    typeof call.method !== 'string' ||
    !Array.isArray(call.args) ||
    !isRecord(call.kwargs)
  ) {
    return { ok: false, failure: bridgeFailure('incompatible_response') };
  }
  if (isAllowedFieldsGet(call) || isAllowedRead(call) || isAllowedSearchRead(call)) {
    return { ok: true };
  }
  return { ok: false, failure: bridgeFailure('incompatible_endpoint') };
}

function isHealthState(value: unknown): value is 'high' | 'medium' | 'low' | null {
  return value === null || value === 'high' || value === 'medium' || value === 'low';
}

function isOptionalPositiveId(value: unknown): value is number | null {
  return value === null || isPositiveId(value);
}

function isCanonicalHealthTagIdList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= 3 &&
    value.every(isPositiveId) &&
    new Set(value).size === value.length
  );
}

export function isCustomerDataBridgeOperation(
  value: unknown,
): value is CustomerDataBridgeOperation {
  if (!isRecord(value) || typeof value.name !== 'string') return false;
  if (value.name === 'applyHealthState') {
    return (
      hasExactKeys(value, ['name', 'sourceOrderId', 'nextState']) &&
      isPositiveId(value.sourceOrderId) &&
      isHealthState(value.nextState)
    );
  }
  if (value.name === 'undoHealthState') {
    return (
      hasExactKeys(value, [
        'name',
        'sourceOrderId',
        'expectedAppliedHealthTagIds',
        'restoreHealthTagIds',
      ]) &&
      isPositiveId(value.sourceOrderId) &&
      isCanonicalHealthTagIdList(value.expectedAppliedHealthTagIds) &&
      isCanonicalHealthTagIdList(value.restoreHealthTagIds)
    );
  }
  if (value.name === 'applyIndustry') {
    return (
      hasExactKeys(value, ['name', 'sourceOrderId', 'expectedPartnerId', 'nextIndustryId']) &&
      isPositiveId(value.sourceOrderId) &&
      isSignedNonzeroId(value.expectedPartnerId) &&
      isOptionalPositiveId(value.nextIndustryId)
    );
  }
  if (value.name === 'undoIndustry') {
    return (
      hasExactKeys(value, [
        'name',
        'sourceOrderId',
        'expectedPartnerId',
        'expectedAppliedIndustryId',
        'restoreIndustryId',
      ]) &&
      isPositiveId(value.sourceOrderId) &&
      isSignedNonzeroId(value.expectedPartnerId) &&
      isOptionalPositiveId(value.expectedAppliedIndustryId) &&
      isOptionalPositiveId(value.restoreIndustryId)
    );
  }
  return false;
}

export function parseHealthMutationResult(
  value: unknown,
  expectedSourceOrderId: number,
): HealthMutationResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['sourceOrderId', 'beforeHealthTagIds', 'appliedHealthTagIds', 'state']) ||
    value.sourceOrderId !== expectedSourceOrderId ||
    !isCanonicalHealthTagIdList(value.beforeHealthTagIds) ||
    !isCanonicalHealthTagIdList(value.appliedHealthTagIds) ||
    !isHealthState(value.state) ||
    (value.state === null && value.appliedHealthTagIds.length !== 0) ||
    (value.state !== null && value.appliedHealthTagIds.length !== 1)
  ) {
    return null;
  }
  return {
    sourceOrderId: expectedSourceOrderId,
    beforeHealthTagIds: [...value.beforeHealthTagIds],
    appliedHealthTagIds: [...value.appliedHealthTagIds],
    state: value.state,
  };
}

export function parseCustomerDataUndoResult(value: unknown): CustomerDataUndoResult | null {
  return isRecord(value) && hasExactKeys(value, ['restored']) && typeof value.restored === 'boolean'
    ? { restored: value.restored }
    : null;
}

export function parseIndustryMutationResult(
  value: unknown,
  expectedSourceOrderId: number,
  expectedPartnerId: number,
): IndustryMutationResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['sourceOrderId', 'partnerId', 'beforeIndustryId', 'appliedIndustryId']) ||
    value.sourceOrderId !== expectedSourceOrderId ||
    value.partnerId !== expectedPartnerId ||
    !isOptionalPositiveId(value.beforeIndustryId) ||
    !isOptionalPositiveId(value.appliedIndustryId)
  ) {
    return null;
  }
  return {
    sourceOrderId: expectedSourceOrderId,
    partnerId: expectedPartnerId,
    beforeIndustryId: value.beforeIndustryId,
    appliedIndustryId: value.appliedIndustryId,
  };
}

function isRenewalTargetYears(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

function isNonNegativeSafeInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeLabel(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !hasControlCharacters(value)
  );
}

function parseRenewalPeriod(value: Record<string, unknown>): {
  billingPeriodValue: number;
  billingPeriodUnit: 'month' | 'year';
  currentContractMonths: number;
} | null {
  if (
    !Number.isSafeInteger(value.billingPeriodValue) ||
    Number(value.billingPeriodValue) <= 0 ||
    Number(value.billingPeriodValue) > 1_200 ||
    (value.billingPeriodUnit !== 'month' && value.billingPeriodUnit !== 'year') ||
    !Number.isSafeInteger(value.currentContractMonths) ||
    Number(value.currentContractMonths) <= 0 ||
    Number(value.currentContractMonths) > 1_200
  ) {
    return null;
  }
  const billingPeriodValue = Number(value.billingPeriodValue);
  const currentContractMonths = Number(value.currentContractMonths);
  if (
    currentContractMonths !==
    (value.billingPeriodUnit === 'year' ? billingPeriodValue * 12 : billingPeriodValue)
  ) {
    return null;
  }
  return {
    billingPeriodValue,
    billingPeriodUnit: value.billingPeriodUnit,
    currentContractMonths,
  };
}

export function parseRenewalPreflightResult(
  value: unknown,
  expectedSourceOrderId: number,
): RenewalPreflightResponse | null {
  if (
    isRecord(value) &&
    hasExactKeys(value, ['eligible', 'sourceOrderId', 'reason']) &&
    value.eligible === false &&
    value.sourceOrderId === expectedSourceOrderId &&
    value.reason === 'not-in-progress'
  ) {
    return {
      eligible: false,
      sourceOrderId: expectedSourceOrderId,
      reason: 'not-in-progress',
    };
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'eligible',
      'sourceOrderId',
      'planId',
      'writeDate',
      'renewalQuoteCount',
      'billingPeriodValue',
      'billingPeriodUnit',
      'currentContractMonths',
      'allowedTargetYears',
    ]) ||
    value.eligible !== true ||
    value.sourceOrderId !== expectedSourceOrderId ||
    !isPositiveId(value.planId) ||
    !isServerWriteDate(value.writeDate) ||
    !Number.isSafeInteger(value.renewalQuoteCount) ||
    Number(value.renewalQuoteCount) < 0 ||
    !Array.isArray(value.allowedTargetYears) ||
    !value.allowedTargetYears.every(isRenewalTargetYears) ||
    new Set(value.allowedTargetYears).size !== value.allowedTargetYears.length
  ) {
    return null;
  }
  const period = parseRenewalPeriod(value);
  if (!period) return null;
  const allowedTargetYears = value.allowedTargetYears.filter(isRenewalTargetYears);
  const expectedTargetYears = [1, 2, 3, 4, 5].filter(
    (years): years is RenewalTargetYears => years * 12 >= period.currentContractMonths,
  );
  if (
    allowedTargetYears.length !== expectedTargetYears.length ||
    allowedTargetYears.some((years, index) => years !== expectedTargetYears[index])
  ) {
    return null;
  }
  return {
    eligible: true,
    sourceOrderId: expectedSourceOrderId,
    planId: value.planId,
    writeDate: value.writeDate,
    renewalQuoteCount: Number(value.renewalQuoteCount),
    ...period,
    allowedTargetYears: [...allowedTargetYears],
  };
}

export function parseRenewalCreatedQuoteResult(
  value: unknown,
  sourceRecordId: number,
): RenewalCreatedQuoteResult | null {
  const hasTimeoutReconciliation = isRecord(value) && 'reconciledAfterTimeout' in value;
  const hasValidationReconciliation =
    isRecord(value) && 'reconciledAfterValidationFailure' in value;
  if (
    !isRecord(value) ||
    (!hasExactKeys(value, ['quoteId']) &&
      !hasExactKeys(value, ['quoteId', 'reconciledAfterTimeout']) &&
      !hasExactKeys(value, ['quoteId', 'reconciledAfterValidationFailure'])) ||
    !isPositiveId(value.quoteId) ||
    value.quoteId === sourceRecordId ||
    (hasTimeoutReconciliation && value.reconciledAfterTimeout !== true) ||
    (hasValidationReconciliation && value.reconciledAfterValidationFailure !== true) ||
    (hasTimeoutReconciliation && hasValidationReconciliation)
  ) {
    return null;
  }
  return {
    quoteId: value.quoteId,
    ...(hasTimeoutReconciliation ? { reconciledAfterTimeout: true as const } : {}),
    ...(hasValidationReconciliation ? { reconciledAfterValidationFailure: true as const } : {}),
  };
}

export function parseRenewalDiscountClearResult(value: unknown): RenewalDiscountClearResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['removedLineCount']) ||
    !isNonNegativeSafeInteger(value.removedLineCount, 500)
  ) {
    return null;
  }
  return { removedLineCount: value.removedLineCount };
}

export function parseRenewalDiscountApplyResult(value: unknown): RenewalDiscountApplyResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['createdLineCount']) ||
    !Number.isSafeInteger(value.createdLineCount) ||
    Number(value.createdLineCount) <= 0 ||
    Number(value.createdLineCount) > 500
  ) {
    return null;
  }
  return { createdLineCount: Number(value.createdLineCount) };
}

export function parseRenewalIntermediateCancellationResult(
  value: unknown,
): RenewalIntermediateCancellationResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['cancelledQuoteIds', 'alreadyCancelledQuoteIds']) ||
    !Array.isArray(value.cancelledQuoteIds) ||
    !Array.isArray(value.alreadyCancelledQuoteIds) ||
    value.cancelledQuoteIds.length > 8 ||
    value.alreadyCancelledQuoteIds.length > 8 ||
    !value.cancelledQuoteIds.every(isPositiveId) ||
    !value.alreadyCancelledQuoteIds.every(isPositiveId)
  ) {
    return null;
  }
  const cancelledQuoteIds = value.cancelledQuoteIds as number[];
  const alreadyCancelledQuoteIds = value.alreadyCancelledQuoteIds as number[];
  const allQuoteIds = [...cancelledQuoteIds, ...alreadyCancelledQuoteIds];
  if (
    new Set(cancelledQuoteIds).size !== cancelledQuoteIds.length ||
    new Set(alreadyCancelledQuoteIds).size !== alreadyCancelledQuoteIds.length ||
    new Set(allQuoteIds).size !== allQuoteIds.length ||
    cancelledQuoteIds.some(
      (quoteId, index) => index > 0 && cancelledQuoteIds[index - 1]! >= quoteId,
    ) ||
    alreadyCancelledQuoteIds.some(
      (quoteId, index) => index > 0 && alreadyCancelledQuoteIds[index - 1]! >= quoteId,
    )
  ) {
    return null;
  }
  return {
    cancelledQuoteIds: [...cancelledQuoteIds],
    alreadyCancelledQuoteIds: [...alreadyCancelledQuoteIds],
  };
}

function parseRenewalShareLink(value: unknown, expectedQuoteId: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.origin !== ODOO_BRIDGE_ORIGIN ||
    url.pathname !== '/mail/view' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.searchParams.get('model') !== 'sale.order' ||
    url.searchParams.get('res_id') !== String(expectedQuoteId) ||
    !url.searchParams.get('access_token')
  ) {
    return null;
  }
  const allowedParameters = new Set(['model', 'res_id', 'access_token']);
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!allowedParameters.has(key) || seen.has(key)) return null;
    seen.add(key);
  }
  return url.href;
}

export function parseRenewalShareLinkResult(
  value: unknown,
  expectedQuoteId: number,
): RenewalShareLinkResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['quoteId', 'shareLink']) ||
    value.quoteId !== expectedQuoteId
  ) {
    return null;
  }
  const shareLink = parseRenewalShareLink(value.shareLink, expectedQuoteId);
  return shareLink ? { quoteId: expectedQuoteId, shareLink } : null;
}

function parseRenewalQuoteLine(value: unknown): RenewalQuoteLineSummary | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'lineId',
      'productId',
      'sequence',
      'quantity',
      'unitPrice',
      'subtotal',
      'total',
      'taxIds',
      'isMultiYearDiscount',
    ]) ||
    !isPositiveId(value.lineId) ||
    (value.productId !== null && !isPositiveId(value.productId)) ||
    !isNonNegativeSafeInteger(value.sequence, 1_000_000) ||
    !isFiniteNumber(value.quantity) ||
    !isFiniteNumber(value.unitPrice) ||
    !isFiniteNumber(value.subtotal) ||
    !isFiniteNumber(value.total) ||
    !Array.isArray(value.taxIds) ||
    value.taxIds.length > 100 ||
    !value.taxIds.every(isPositiveId) ||
    new Set(value.taxIds).size !== value.taxIds.length ||
    typeof value.isMultiYearDiscount !== 'boolean'
  ) {
    return null;
  }
  return {
    lineId: value.lineId,
    productId: value.productId,
    sequence: value.sequence,
    quantity: value.quantity,
    unitPrice: value.unitPrice,
    subtotal: value.subtotal,
    total: value.total,
    taxIds: [...value.taxIds],
    isMultiYearDiscount: value.isMultiYearDiscount,
  };
}

export function parseRenewalQuoteSummary(
  value: unknown,
  expectedQuoteId: number,
): RenewalQuoteSummary | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'quoteId',
      'createdFromQuoteId',
      'name',
      'state',
      'subscriptionState',
      'planId',
      'billingPeriodValue',
      'billingPeriodUnit',
      'currentContractMonths',
      'templateId',
      'currencyId',
      'currencyRounding',
      'amountUntaxed',
      'amountTax',
      'amountTotal',
      'lineCount',
      'multiYearDiscountLineCount',
      'lines',
    ]) ||
    value.quoteId !== expectedQuoteId ||
    !isPositiveId(value.createdFromQuoteId) ||
    !isSafeLabel(value.name, 160) ||
    !isSafeLabel(value.state, 40) ||
    (value.subscriptionState !== null && !isSafeLabel(value.subscriptionState, 40)) ||
    !isPositiveId(value.planId) ||
    (value.templateId !== null && !isPositiveId(value.templateId)) ||
    !isPositiveId(value.currencyId) ||
    !isFiniteNumber(value.currencyRounding) ||
    value.currencyRounding <= 0 ||
    value.currencyRounding > 1_000 ||
    !isFiniteNumber(value.amountUntaxed) ||
    !isFiniteNumber(value.amountTax) ||
    !isFiniteNumber(value.amountTotal) ||
    !isNonNegativeSafeInteger(value.lineCount, 500) ||
    !isNonNegativeSafeInteger(value.multiYearDiscountLineCount, 500) ||
    !Array.isArray(value.lines) ||
    value.lines.length !== value.lineCount
  ) {
    return null;
  }
  const period = parseRenewalPeriod(value);
  if (!period) return null;
  const lines: RenewalQuoteLineSummary[] = [];
  const lineIds = new Set<number>();
  for (const candidate of value.lines) {
    const line = parseRenewalQuoteLine(candidate);
    if (!line || lineIds.has(line.lineId)) return null;
    lineIds.add(line.lineId);
    lines.push(line);
  }
  if (
    value.multiYearDiscountLineCount > value.lineCount ||
    lines.filter((line) => line.isMultiYearDiscount).length !== value.multiYearDiscountLineCount
  ) {
    return null;
  }
  return {
    quoteId: expectedQuoteId,
    createdFromQuoteId: value.createdFromQuoteId,
    name: value.name,
    state: value.state,
    subscriptionState: value.subscriptionState,
    planId: value.planId,
    ...period,
    templateId: value.templateId,
    currencyId: value.currencyId,
    currencyRounding: value.currencyRounding,
    amountUntaxed: value.amountUntaxed,
    amountTax: value.amountTax,
    amountTotal: value.amountTotal,
    lineCount: value.lineCount,
    multiYearDiscountLineCount: value.multiYearDiscountLineCount,
    lines,
  };
}

function isRenewalRunId(value: unknown): value is string {
  return isIdentifier(value) && String(value).startsWith('renewal-');
}

function isSourceFingerprint(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['planId', 'currentContractMonths', 'writeDate']) &&
    isPositiveId(value.planId) &&
    Number.isSafeInteger(value.currentContractMonths) &&
    Number(value.currentContractMonths) > 0 &&
    Number(value.currentContractMonths) <= 1_200 &&
    isServerWriteDate(value.writeDate)
  );
}

function isRenewalTargetYearList(value: unknown): value is RenewalTargetYears[] {
  return (
    Array.isArray(value) &&
    value.length <= 5 &&
    value.every(isRenewalTargetYears) &&
    new Set(value).size === value.length &&
    value.every((years, index) => index === 0 || Number(value[index - 1]) < years)
  );
}

export function isRenewalBridgeOperation(value: unknown): value is RenewalBridgeOperation {
  if (!isRecord(value) || typeof value.name !== 'string') return false;

  if (value.name === 'preflightRenewal') {
    return hasExactKeys(value, ['name', 'sourceOrderId']) && isPositiveId(value.sourceOrderId);
  }
  if (value.name === 'createNativeRenewal') {
    return (
      hasExactKeys(value, [
        'name',
        'sourceOrderId',
        'runId',
        'expected',
        'requiredCopyYears',
        'requiresDiscount',
        'retention',
      ]) &&
      isPositiveId(value.sourceOrderId) &&
      isRenewalRunId(value.runId) &&
      isSourceFingerprint(value.expected) &&
      isRenewalTargetYearList(value.requiredCopyYears) &&
      typeof value.requiresDiscount === 'boolean' &&
      (value.retention === 'selected' || value.retention === 'intermediate')
    );
  }
  if (value.name === 'copyNativePlan') {
    return (
      hasExactKeys(value, ['name', 'sourceQuoteId', 'years', 'runId', 'retention']) &&
      isPositiveId(value.sourceQuoteId) &&
      isRenewalTargetYears(value.years) &&
      isRenewalRunId(value.runId) &&
      (value.retention === 'selected' || value.retention === 'intermediate')
    );
  }
  if (value.name === 'clearNativeMultiYearDiscount') {
    return (
      hasExactKeys(value, ['name', 'quoteId', 'runId']) &&
      isPositiveId(value.quoteId) &&
      isRenewalRunId(value.runId)
    );
  }
  if (value.name === 'applyNativeGlobalDiscount') {
    return (
      hasExactKeys(value, ['name', 'quoteId', 'percentageTenths', 'runId']) &&
      isPositiveId(value.quoteId) &&
      Number.isSafeInteger(value.percentageTenths) &&
      Number(value.percentageTenths) >= 1 &&
      Number(value.percentageTenths) <= 1_000 &&
      isRenewalRunId(value.runId)
    );
  }
  if (value.name === 'getNativeShareLink' || value.name === 'readRenewalQuoteSummary') {
    return (
      hasExactKeys(value, ['name', 'quoteId', 'runId']) &&
      isPositiveId(value.quoteId) &&
      isRenewalRunId(value.runId)
    );
  }
  if (value.name === 'finishRenewalRun') {
    return hasExactKeys(value, ['name', 'runId']) && isRenewalRunId(value.runId);
  }
  if (value.name === 'cancelIntermediateRenewalQuotes') {
    return hasExactKeys(value, ['name', 'runId']) && isRenewalRunId(value.runId);
  }
  return false;
}

export function isOdooBridgeRequest(value: unknown): value is OdooBridgeRequest {
  if (!isRecord(value)) return false;
  if (
    value.channel !== ODOO_BRIDGE_CHANNEL ||
    value.version !== ODOO_BRIDGE_VERSION ||
    value.direction !== 'request' ||
    !isIdentifier(value.clientId) ||
    !isIdentifier(value.requestId)
  ) {
    return false;
  }
  if (value.kind === 'ping' || value.kind === 'probe')
    return hasExactKeys(value, [
      'channel',
      'version',
      'direction',
      'clientId',
      'requestId',
      'kind',
    ]);
  if (value.kind === 'call') {
    return (
      hasExactKeys(value, [
        'channel',
        'version',
        'direction',
        'clientId',
        'requestId',
        'kind',
        'call',
      ]) && isRecord(value.call)
    );
  }
  if (value.kind === 'renewal') {
    return (
      hasExactKeys(value, [
        'channel',
        'version',
        'direction',
        'clientId',
        'requestId',
        'kind',
        'operation',
      ]) && isRenewalBridgeOperation(value.operation)
    );
  }
  return (
    value.kind === 'customerData' &&
    hasExactKeys(value, [
      'channel',
      'version',
      'direction',
      'clientId',
      'requestId',
      'kind',
      'operation',
    ]) &&
    isCustomerDataBridgeOperation(value.operation)
  );
}

const FAILURE_CODES = new Set<OdooBridgeFailureCode>([
  'bridge_unavailable',
  'timeout',
  'network',
  'session_expired',
  'access_denied',
  'incompatible_endpoint',
  'incompatible_response',
  'server_error',
]);

export function isOdooBridgeResponse(value: unknown): value is OdooBridgeResponse {
  if (!isRecord(value)) return false;
  if (
    value.channel !== ODOO_BRIDGE_CHANNEL ||
    value.version !== ODOO_BRIDGE_VERSION ||
    value.direction !== 'response' ||
    !isIdentifier(value.clientId) ||
    !isIdentifier(value.requestId)
  ) {
    return false;
  }
  if (value.ok === true) {
    return (
      value.result !== undefined &&
      hasExactKeys(value, [
        'channel',
        'version',
        'direction',
        'clientId',
        'requestId',
        'ok',
        'result',
      ])
    );
  }
  if (value.ok !== false || !isRecord(value.failure)) return false;
  return (
    hasExactKeys(value, [
      'channel',
      'version',
      'direction',
      'clientId',
      'requestId',
      'ok',
      'failure',
    ]) &&
    hasExactKeys(value.failure, ['code', 'message']) &&
    typeof value.failure.code === 'string' &&
    FAILURE_CODES.has(value.failure.code as OdooBridgeFailureCode) &&
    typeof value.failure.message === 'string' &&
    value.failure.message.length > 0 &&
    value.failure.message.length <= 160
  );
}
