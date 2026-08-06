import type { CompatibilityCode } from '../shared/types';

export const ODOO_BRIDGE_CHANNEL = 'odoo-health-ext-cs:rpc';
export const ODOO_BRIDGE_VERSION = 1 as const;
export const ODOO_BRIDGE_ORIGIN = 'https://www.odoo.com';

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
    | {
        kind: 'call';
        call: OdooBridgeCall;
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

function isPositiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
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
  if (
    call.method !== 'read' ||
    call.args.length !== 2 ||
    !isIdList(call.args[0]) ||
    !isEmptyRecord(call.kwargs)
  ) {
    return false;
  }
  const fields = call.args[1];
  if (call.model === 'sale.order') {
    return (
      hasExactStringArray(fields, ['tag_ids', 'partner_id', 'subscription_state']) ||
      hasExactStringArray(fields, ['tag_ids']) ||
      hasExactStringArray(fields, ['partner_id'])
    );
  }
  return call.model === 'res.partner' && hasExactStringArray(fields, ['industry_id']);
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

function isTagReplacement(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const command = value[0];
  return (
    Array.isArray(command) &&
    command.length === 3 &&
    command[0] === 6 &&
    command[1] === 0 &&
    (Array.isArray(command[2]) && command[2].length === 0 ? true : isIdList(command[2], 500))
  );
}

function isAllowedWrite(call: OdooBridgeCall): boolean {
  if (
    call.method !== 'write' ||
    call.args.length !== 2 ||
    !isIdList(call.args[0]) ||
    !isEmptyRecord(call.kwargs) ||
    !isRecord(call.args[1])
  ) {
    return false;
  }
  const values = call.args[1];
  if (call.model === 'sale.order') {
    return hasExactKeys(values, ['tag_ids']) && isTagReplacement(values.tag_ids);
  }
  return (
    call.model === 'res.partner' &&
    hasExactKeys(values, ['industry_id']) &&
    (values.industry_id === false || isPositiveId(values.industry_id))
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
  if (
    isAllowedFieldsGet(call) ||
    isAllowedRead(call) ||
    isAllowedSearchRead(call) ||
    isAllowedWrite(call)
  ) {
    return { ok: true };
  }
  return { ok: false, failure: bridgeFailure('incompatible_endpoint') };
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
  if (value.kind === 'ping')
    return hasExactKeys(value, [
      'channel',
      'version',
      'direction',
      'clientId',
      'requestId',
      'kind',
    ]);
  return (
    value.kind === 'call' &&
    hasExactKeys(value, [
      'channel',
      'version',
      'direction',
      'clientId',
      'requestId',
      'kind',
      'call',
    ]) &&
    isRecord(value.call)
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
