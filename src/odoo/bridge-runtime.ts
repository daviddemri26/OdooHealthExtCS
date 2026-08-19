import {
  ODOO_BRIDGE_CHANNEL,
  ODOO_BRIDGE_ORIGIN,
  ODOO_BRIDGE_VERSION,
  CANONICAL_HEALTH_NAMES,
  bridgeFailure,
  isOdooBridgeRequest,
  validateOdooBridgeCall,
  type OdooBridgeCall,
  type OdooBridgeFailure,
  type OdooBridgeResponse,
} from './bridge-protocol';
import {
  CUSTOMER_DATA_RPC_TIMEOUT_MS,
  type CustomerDataBridgeOperation,
  type CustomerDataSubscriptionState,
} from './customer-data-contracts';
import { RenewalOwnershipRegistry, executeOdooRenewalOperation } from './renewal-runtime';
import { executeOdooQuoteShareOperation } from './share-link-runtime';

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: unknown;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: unknown;
  error: {
    data?: {
      name?: string;
    };
  };
}

type BridgeExecutionResult =
  { ok: true; result: unknown } | { ok: false; failure: OdooBridgeFailure };

interface BridgeMarker {
  version: number;
  dispose: () => void;
}

const BRIDGE_MARKER = '__ODOO_HEALTH_EXT_CS_RPC_BRIDGE__';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isSignedNonzeroId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) !== 0;
}

function sanitizeUserDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const withoutControls = Array.from(value.normalize('NFKC'))
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return !(
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069)
      );
    })
    .join('');
  const sanitized = withoutControls.replace(/\s+/g, ' ').trim().slice(0, 120);
  return sanitized || null;
}

function sanitizeMany2One(
  value: unknown,
  isAllowedId: (candidate: unknown) => candidate is number,
): false | [number, string] {
  if (value === false) return false;
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    isAllowedId(value[0]) &&
    typeof value[1] === 'string'
  ) {
    return [value[0], value[1]];
  }
  throw bridgeFailure('incompatible_response');
}

function sanitizeFieldDefinition(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw bridgeFailure('incompatible_response');
  const sanitized: Record<string, unknown> = {};
  if (typeof value.type === 'string') sanitized.type = value.type;
  if (typeof value.relation === 'string') sanitized.relation = value.relation;
  if (typeof value.readonly === 'boolean') sanitized.readonly = value.readonly;
  if (typeof value.string === 'string') sanitized.string = value.string;
  return sanitized;
}

function sanitizeRecordResult(call: OdooBridgeCall, value: unknown): unknown[] {
  if (!Array.isArray(value)) throw bridgeFailure('incompatible_response');
  const fields = call.args[1];
  if (!Array.isArray(fields)) throw bridgeFailure('incompatible_response');
  const isAllowedRecordId = call.model === 'res.partner' ? isSignedNonzeroId : isPositiveId;

  return value.map((record) => {
    if (!isRecord(record) || !isAllowedRecordId(record.id)) {
      throw bridgeFailure('incompatible_response');
    }
    const sanitized: Record<string, unknown> = { id: record.id };
    for (const field of fields) {
      if (field === 'tag_ids') {
        if (!Array.isArray(record.tag_ids) || !record.tag_ids.every(isPositiveId)) {
          throw bridgeFailure('incompatible_response');
        }
        sanitized.tag_ids = [...record.tag_ids];
      } else if (field === 'partner_id') {
        sanitized.partner_id = sanitizeMany2One(record.partner_id, isSignedNonzeroId);
      } else if (field === 'subscription_state') {
        if (
          record.subscription_state !== false &&
          record.subscription_state !== null &&
          typeof record.subscription_state !== 'string'
        ) {
          throw bridgeFailure('incompatible_response');
        }
        sanitized.subscription_state = record.subscription_state;
      } else if (field === 'industry_id') {
        sanitized.industry_id = sanitizeMany2One(record.industry_id, isPositiveId);
      }
    }
    return sanitized;
  });
}

function sanitizeNamedRecords(value: unknown): { id: number; name: string }[] {
  if (!Array.isArray(value)) throw bridgeFailure('incompatible_response');
  return value.map((record) => {
    if (!isRecord(record) || !isPositiveId(record.id) || typeof record.name !== 'string') {
      throw bridgeFailure('incompatible_response');
    }
    return { id: record.id, name: record.name };
  });
}

function sanitizeSubscriptionListRecords(
  value: unknown,
): { id: number; name: string; tag_ids: number[] }[] {
  if (!Array.isArray(value)) throw bridgeFailure('incompatible_response');
  return value.map((record) => {
    if (
      !isRecord(record) ||
      !isPositiveId(record.id) ||
      typeof record.name !== 'string' ||
      record.name.length === 0 ||
      record.name.length > 160 ||
      !Array.isArray(record.tag_ids) ||
      !record.tag_ids.every(isPositiveId)
    ) {
      throw bridgeFailure('incompatible_response');
    }
    return { id: record.id, name: record.name, tag_ids: [...record.tag_ids] };
  });
}

function sanitizeResult(call: OdooBridgeCall, result: unknown): unknown {
  if (call.method === 'write') {
    if (typeof result !== 'boolean') throw bridgeFailure('incompatible_response');
    return result;
  }
  if (call.method === 'fields_get') {
    if (!isRecord(result)) throw bridgeFailure('incompatible_response');
    const field = call.model === 'sale.order' ? 'tag_ids' : 'industry_id';
    return { [field]: sanitizeFieldDefinition(result[field]) };
  }
  if (call.method === 'search_read') {
    return call.model === 'sale.order'
      ? sanitizeSubscriptionListRecords(result)
      : sanitizeNamedRecords(result);
  }
  if (call.method === 'read') return sanitizeRecordResult(call, result);
  throw bridgeFailure('incompatible_endpoint');
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

function isJsonRpcSuccess(value: unknown): value is JsonRpcSuccess {
  return isRecord(value) && value.jsonrpc === '2.0' && 'result' in value && !('error' in value);
}

export async function executeOdooBridgeCall(
  call: OdooBridgeCall,
  options: {
    fetcher?: typeof fetch;
    origin?: string;
    timeoutMs?: number;
    requestId?: string;
  } = {},
): Promise<BridgeExecutionResult> {
  const validation = validateOdooBridgeCall(call);
  if (!validation.ok) return validation;

  return executeTrustedOdooBridgeCall(call, options);
}

async function executeTrustedOdooBridgeCall(
  call: OdooBridgeCall,
  options: {
    fetcher?: typeof fetch;
    origin?: string;
    timeoutMs?: number;
    requestId?: string;
  } = {},
): Promise<BridgeExecutionResult> {
  const origin = options.origin ?? window.location.origin;
  if (origin !== ODOO_BRIDGE_ORIGIN) {
    return { ok: false, failure: bridgeFailure('incompatible_endpoint') };
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const fetcher = options.fetcher ?? window.fetch.bind(window);

  try {
    const endpoint = new URL(
      `/web/dataset/call_kw/${encodeURIComponent(call.model)}/${encodeURIComponent(call.method)}`,
      origin,
    ).href;
    const response = await fetcher(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: call,
        id: options.requestId ?? null,
      }),
      signal: controller.signal,
    });

    if (response.redirected || response.status === 401) {
      return { ok: false, failure: bridgeFailure('session_expired') };
    }
    if (response.status === 403) {
      return { ok: false, failure: bridgeFailure('access_denied') };
    }
    if (response.status === 404 || response.status === 405) {
      return { ok: false, failure: bridgeFailure('incompatible_endpoint') };
    }
    if (!response.ok) {
      return { ok: false, failure: bridgeFailure('server_error') };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLocaleLowerCase().includes('json')) {
      return { ok: false, failure: bridgeFailure('session_expired') };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, failure: bridgeFailure('incompatible_response') };
    }
    if (isJsonRpcError(payload)) {
      return { ok: false, failure: classifyJsonRpcError(payload.error) };
    }
    if (!isJsonRpcSuccess(payload)) {
      return { ok: false, failure: bridgeFailure('incompatible_response') };
    }

    try {
      return { ok: true, result: sanitizeResult(call, payload.result) };
    } catch (failure) {
      return {
        ok: false,
        failure:
          isRecord(failure) && typeof failure.code === 'string'
            ? (failure as unknown as OdooBridgeFailure)
            : bridgeFailure('incompatible_response'),
      };
    }
  } catch (error) {
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (isRecord(error) && error.name === 'AbortError')
    ) {
      return { ok: false, failure: bridgeFailure('timeout') };
    }
    return { ok: false, failure: bridgeFailure('network') };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

const CUSTOMER_DATA_ALLOWED_STATES = new Set<CustomerDataSubscriptionState>([
  '3_progress',
  '4_paused',
]);

interface CustomerDataRuntimeOptions {
  fetcher?: typeof fetch;
  origin?: string;
  timeoutMs?: number;
  requestId?: string;
}

function isBridgeFailure(value: unknown): value is OdooBridgeFailure {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

async function customerDataCall(
  call: OdooBridgeCall,
  options: CustomerDataRuntimeOptions,
): Promise<unknown> {
  const result = await executeTrustedOdooBridgeCall(call, {
    ...options,
    timeoutMs: options.timeoutMs ?? CUSTOMER_DATA_RPC_TIMEOUT_MS,
  });
  if (!result.ok) throw result.failure;
  return result.result;
}

function exactSingleRecord(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw bridgeFailure('incompatible_response');
  }
  return value[0];
}

function getAllowedSubscriptionState(
  record: Record<string, unknown>,
): CustomerDataSubscriptionState {
  const state = record.subscription_state;
  if (
    typeof state !== 'string' ||
    !CUSTOMER_DATA_ALLOWED_STATES.has(state as CustomerDataSubscriptionState)
  ) {
    throw bridgeFailure('access_denied');
  }
  return state as CustomerDataSubscriptionState;
}

function exactPositiveIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every(isPositiveId) || new Set(value).size !== value.length) {
    throw bridgeFailure('incompatible_response');
  }
  return [...value];
}

async function resolveCanonicalHealthTags(
  options: CustomerDataRuntimeOptions,
): Promise<Record<'high' | 'medium' | 'low', number>> {
  const records = await customerDataCall(
    {
      model: 'crm.tag',
      method: 'search_read',
      args: [[['name', 'in', [...CANONICAL_HEALTH_NAMES]]]],
      kwargs: { fields: ['id', 'name'], limit: 20 },
    },
    options,
  );
  if (!Array.isArray(records)) throw bridgeFailure('incompatible_response');
  const byName = (name: string): number => {
    const matches = records.filter(
      (record) => isRecord(record) && record.name === name && isPositiveId(record.id),
    );
    if (matches.length !== 1 || !matches[0] || !isPositiveId(matches[0].id)) {
      throw bridgeFailure('incompatible_response');
    }
    return matches[0].id;
  };
  return {
    high: byName('Health - High'),
    medium: byName('Health - Medium'),
    low: byName('Health - Low'),
  };
}

async function readHealthOrder(
  sourceOrderId: number,
  options: CustomerDataRuntimeOptions,
): Promise<{ tagIds: number[]; state: CustomerDataSubscriptionState }> {
  const result = await customerDataCall(
    {
      model: 'sale.order',
      method: 'read',
      args: [[sourceOrderId], ['tag_ids', 'subscription_state']],
      kwargs: {},
    },
    options,
  );
  const record = exactSingleRecord(result);
  return {
    tagIds: exactPositiveIds(record.tag_ids),
    state: getAllowedSubscriptionState(record),
  };
}

function healthRelationCommands(canonicalIds: number[], restoreIds: number[]): number[][] {
  return [...canonicalIds.map((id) => [3, id]), ...restoreIds.map((id) => [4, id])];
}

function sameIdSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort((a, b) => a - b);
  const rightSorted = [...right].sort((a, b) => a - b);
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function requireCanonicalSubset(ids: number[], canonicalIds: number[]): void {
  const allowed = new Set(canonicalIds);
  if (ids.length > canonicalIds.length || ids.some((id) => !allowed.has(id))) {
    throw bridgeFailure('incompatible_response');
  }
}

function linkedPartnerId(record: Record<string, unknown>): number {
  const partner = record.partner_id;
  if (!Array.isArray(partner) || partner.length !== 2 || !isSignedNonzeroId(partner[0])) {
    throw bridgeFailure('incompatible_response');
  }
  return partner[0];
}

async function readIndustryOrder(
  sourceOrderId: number,
  options: CustomerDataRuntimeOptions,
): Promise<{ partnerId: number; state: CustomerDataSubscriptionState }> {
  const result = await customerDataCall(
    {
      model: 'sale.order',
      method: 'read',
      args: [[sourceOrderId], ['partner_id', 'subscription_state']],
      kwargs: {},
    },
    options,
  );
  const record = exactSingleRecord(result);
  return {
    partnerId: linkedPartnerId(record),
    state: getAllowedSubscriptionState(record),
  };
}

function many2OneId(value: unknown): number | null {
  if (value === false) return null;
  if (Array.isArray(value) && value.length === 2 && isPositiveId(value[0])) return value[0];
  throw bridgeFailure('incompatible_response');
}

async function readPartnerIndustry(
  partnerId: number,
  options: CustomerDataRuntimeOptions,
): Promise<number | null> {
  const result = await customerDataCall(
    {
      model: 'res.partner',
      method: 'read',
      args: [[partnerId], ['industry_id']],
      kwargs: {},
    },
    options,
  );
  return many2OneId(exactSingleRecord(result).industry_id);
}

async function requireIndustryExists(
  industryId: number | null,
  options: CustomerDataRuntimeOptions,
): Promise<void> {
  if (industryId === null) return;
  const result = await customerDataCall(
    {
      model: 'res.partner.industry',
      method: 'read',
      args: [[industryId], ['name']],
      kwargs: {},
    },
    options,
  );
  const record = exactSingleRecord(result);
  if (record.id !== industryId) throw bridgeFailure('incompatible_response');
}

async function requireSuccessfulWrite(
  call: OdooBridgeCall,
  options: CustomerDataRuntimeOptions,
): Promise<void> {
  const result = await customerDataCall(call, options);
  if (result !== true) throw bridgeFailure('server_error');
}

export async function executeOdooCustomerDataOperation(
  operation: CustomerDataBridgeOperation,
  options: CustomerDataRuntimeOptions = {},
): Promise<BridgeExecutionResult> {
  try {
    if (operation.name === 'applyHealthState') {
      const [tags, order] = await Promise.all([
        resolveCanonicalHealthTags(options),
        readHealthOrder(operation.sourceOrderId, options),
      ]);
      const canonicalIds = [tags.high, tags.medium, tags.low];
      const beforeHealthTagIds = order.tagIds.filter((id) => canonicalIds.includes(id));
      const appliedHealthTagIds = operation.nextState ? [tags[operation.nextState]] : [];
      await requireSuccessfulWrite(
        {
          model: 'sale.order',
          method: 'write',
          args: [
            [operation.sourceOrderId],
            { tag_ids: healthRelationCommands(canonicalIds, appliedHealthTagIds) },
          ],
          kwargs: {},
        },
        options,
      );
      return {
        ok: true,
        result: {
          sourceOrderId: operation.sourceOrderId,
          beforeHealthTagIds,
          appliedHealthTagIds,
          state: operation.nextState,
        },
      };
    }

    if (operation.name === 'undoHealthState') {
      const [tags, order] = await Promise.all([
        resolveCanonicalHealthTags(options),
        readHealthOrder(operation.sourceOrderId, options),
      ]);
      const canonicalIds = [tags.high, tags.medium, tags.low];
      requireCanonicalSubset(operation.expectedAppliedHealthTagIds, canonicalIds);
      requireCanonicalSubset(operation.restoreHealthTagIds, canonicalIds);
      const currentHealthTagIds = order.tagIds.filter((id) => canonicalIds.includes(id));
      if (!sameIdSet(currentHealthTagIds, operation.expectedAppliedHealthTagIds)) {
        return { ok: true, result: { restored: false } };
      }
      await requireSuccessfulWrite(
        {
          model: 'sale.order',
          method: 'write',
          args: [
            [operation.sourceOrderId],
            { tag_ids: healthRelationCommands(canonicalIds, operation.restoreHealthTagIds) },
          ],
          kwargs: {},
        },
        options,
      );
      return { ok: true, result: { restored: true } };
    }

    if (operation.name === 'applyIndustry') {
      const order = await readIndustryOrder(operation.sourceOrderId, options);
      if (order.partnerId !== operation.expectedPartnerId) throw bridgeFailure('access_denied');
      const [beforeIndustryId] = await Promise.all([
        readPartnerIndustry(order.partnerId, options),
        requireIndustryExists(operation.nextIndustryId, options),
      ]);
      await requireSuccessfulWrite(
        {
          model: 'res.partner',
          method: 'write',
          args: [[order.partnerId], { industry_id: operation.nextIndustryId ?? false }],
          kwargs: {},
        },
        options,
      );
      return {
        ok: true,
        result: {
          sourceOrderId: operation.sourceOrderId,
          partnerId: order.partnerId,
          beforeIndustryId,
          appliedIndustryId: operation.nextIndustryId,
        },
      };
    }

    const order = await readIndustryOrder(operation.sourceOrderId, options);
    if (order.partnerId !== operation.expectedPartnerId) {
      return { ok: true, result: { restored: false } };
    }
    const [currentIndustryId] = await Promise.all([
      readPartnerIndustry(order.partnerId, options),
      requireIndustryExists(operation.restoreIndustryId, options),
    ]);
    if (currentIndustryId !== operation.expectedAppliedIndustryId) {
      return { ok: true, result: { restored: false } };
    }
    await requireSuccessfulWrite(
      {
        model: 'res.partner',
        method: 'write',
        args: [[order.partnerId], { industry_id: operation.restoreIndustryId ?? false }],
        kwargs: {},
      },
      options,
    );
    return { ok: true, result: { restored: true } };
  } catch (failure) {
    return {
      ok: false,
      failure: isBridgeFailure(failure) ? failure : bridgeFailure('server_error'),
    };
  }
}

export async function executeOdooConnectionProbe(
  options: {
    fetcher?: typeof fetch;
    origin?: string;
    timeoutMs?: number;
    requestId?: string;
  } = {},
): Promise<BridgeExecutionResult> {
  const origin = options.origin ?? window.location.origin;
  if (origin !== ODOO_BRIDGE_ORIGIN) {
    return { ok: false, failure: bridgeFailure('incompatible_endpoint') };
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const fetcher = options.fetcher ?? window.fetch.bind(window);

  try {
    const endpoint = new URL('/web/session/get_session_info', origin).href;
    const response = await fetcher(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: {},
        id: options.requestId ?? null,
      }),
      signal: controller.signal,
    });

    if (response.redirected || response.status === 401) {
      return { ok: false, failure: bridgeFailure('session_expired') };
    }
    if (response.status === 403) {
      return { ok: false, failure: bridgeFailure('access_denied') };
    }
    if (response.status === 404 || response.status === 405) {
      return { ok: false, failure: bridgeFailure('incompatible_endpoint') };
    }
    if (!response.ok) {
      return { ok: false, failure: bridgeFailure('server_error') };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLocaleLowerCase().includes('json')) {
      return { ok: false, failure: bridgeFailure('session_expired') };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, failure: bridgeFailure('incompatible_response') };
    }
    if (isJsonRpcError(payload)) {
      return { ok: false, failure: classifyJsonRpcError(payload.error) };
    }
    if (!isJsonRpcSuccess(payload) || !isRecord(payload.result)) {
      return { ok: false, failure: bridgeFailure('incompatible_response') };
    }

    const session = payload.result;
    const hasUserIdentifier = 'uid' in session || 'user_id' in session;
    const userIdentifier = session.uid ?? session.user_id;
    if (!hasUserIdentifier) {
      return { ok: false, failure: bridgeFailure('incompatible_response') };
    }
    if (!isPositiveId(userIdentifier)) {
      return { ok: false, failure: bridgeFailure('session_expired') };
    }

    const userDisplayName = sanitizeUserDisplayName(session.name ?? session.username);
    return {
      ok: true,
      result: {
        authenticated: true,
        ...(userDisplayName ? { userDisplayName } : {}),
      },
    };
  } catch (error) {
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (isRecord(error) && error.name === 'AbortError')
    ) {
      return { ok: false, failure: bridgeFailure('timeout') };
    }
    return { ok: false, failure: bridgeFailure('network') };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function installOdooBridge(pageWindow: Window = window): () => void {
  const previous = Reflect.get(pageWindow, BRIDGE_MARKER) as BridgeMarker | undefined;
  previous?.dispose();

  const controller = new AbortController();
  const renewalOwnership = new RenewalOwnershipRegistry();
  const handleMessage = (event: MessageEvent): void => {
    if (
      pageWindow.location.origin !== ODOO_BRIDGE_ORIGIN ||
      event.source !== pageWindow ||
      event.origin !== ODOO_BRIDGE_ORIGIN ||
      !isOdooBridgeRequest(event.data)
    ) {
      return;
    }

    const request = event.data;
    if (request.kind === 'ping') {
      const response: OdooBridgeResponse = {
        channel: ODOO_BRIDGE_CHANNEL,
        version: ODOO_BRIDGE_VERSION,
        direction: 'response',
        clientId: request.clientId,
        requestId: request.requestId,
        ok: true,
        result: { ready: true },
      };
      pageWindow.postMessage(response, ODOO_BRIDGE_ORIGIN);
      return;
    }

    const execution =
      request.kind === 'probe'
        ? executeOdooConnectionProbe({ requestId: request.requestId })
        : request.kind === 'customerData'
          ? executeOdooCustomerDataOperation(request.operation, { requestId: request.requestId })
          : request.kind === 'quoteShare'
            ? executeOdooQuoteShareOperation(request.operation, {
                requestId: request.requestId,
                getPathname: () => pageWindow.location.pathname,
              })
            : request.kind === 'renewal'
              ? executeOdooRenewalOperation(request.operation, {
                  requestId: request.requestId,
                  clientId: request.clientId,
                  ownership: renewalOwnership,
                })
              : executeOdooBridgeCall(request.call, { requestId: request.requestId });
    void execution.then((result) => {
      if (controller.signal.aborted) return;
      const response: OdooBridgeResponse = {
        channel: ODOO_BRIDGE_CHANNEL,
        version: ODOO_BRIDGE_VERSION,
        direction: 'response',
        clientId: request.clientId,
        requestId: request.requestId,
        ...result,
      };
      pageWindow.postMessage(response, ODOO_BRIDGE_ORIGIN);
    });
  };

  pageWindow.addEventListener('message', handleMessage, { signal: controller.signal });
  const dispose = (): void => controller.abort();
  const marker: BridgeMarker = { version: ODOO_BRIDGE_VERSION, dispose };
  Reflect.set(pageWindow, BRIDGE_MARKER, marker);
  return dispose;
}
