import {
  ODOO_BRIDGE_CHANNEL,
  ODOO_BRIDGE_ORIGIN,
  ODOO_BRIDGE_VERSION,
  bridgeFailure,
  isOdooBridgeRequest,
  validateOdooBridgeCall,
  type OdooBridgeCall,
  type OdooBridgeFailure,
  type OdooBridgeResponse,
} from './bridge-protocol';

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

function sanitizeMany2One(value: unknown): false | [number, string] {
  if (value === false) return false;
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    isPositiveId(value[0]) &&
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

  return value.map((record) => {
    if (!isRecord(record) || !isPositiveId(record.id)) {
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
        sanitized.partner_id = sanitizeMany2One(record.partner_id);
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
        sanitized.industry_id = sanitizeMany2One(record.industry_id);
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
  if (call.method === 'search_read') return sanitizeNamedRecords(result);
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

export function installOdooBridge(pageWindow: Window = window): () => void {
  const previous = Reflect.get(pageWindow, BRIDGE_MARKER) as BridgeMarker | undefined;
  previous?.dispose();

  const controller = new AbortController();
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

    void executeOdooBridgeCall(request.call, { requestId: request.requestId }).then((result) => {
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
