import {
  ODOO_BRIDGE_ORIGIN,
  bridgeFailure,
  isQuoteShareBridgeOperation,
  parseQuoteShareLink,
  type OdooBridgeFailure,
} from './bridge-protocol';
import { parseQuoteShareRoutePathname } from './routes';
import {
  QUOTE_SHARE_RUNTIME_TIMEOUT_MS,
  type QuoteShareBridgeOperation,
  type QuoteShareTarget,
} from './share-link-contracts';

type QuoteShareExecutionResult =
  { ok: true; result: unknown } | { ok: false; failure: OdooBridgeFailure };

interface JsonRpcError {
  jsonrpc: '2.0';
  error: { data?: { name?: string } };
}

interface QuoteShareRpcContext {
  fetcher: typeof fetch;
  origin: string;
  requestId: string | null;
  signal: AbortSignal;
}

interface QuoteState {
  state: 'draft' | 'sent' | 'other';
  subscriptionState: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBridgeFailure(value: unknown): value is OdooBridgeFailure {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
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
  rpc: QuoteShareRpcContext,
  path: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const response = await rpc.fetcher(new URL(path, rpc.origin).href, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
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
  rpc: QuoteShareRpcContext,
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

async function assertQuoteFieldContract(rpc: QuoteShareRpcContext): Promise<void> {
  const result = await callKw(rpc, 'sale.order', 'fields_get', [], {
    allfields: ['state', 'subscription_state'],
    attributes: ['type'],
  });
  if (
    !isRecord(result) ||
    !isRecord(result.state) ||
    result.state.type !== 'selection' ||
    !isRecord(result.subscription_state) ||
    result.subscription_state.type !== 'selection'
  ) {
    throw bridgeFailure('incompatible_response');
  }
}

async function readQuoteState(rpc: QuoteShareRpcContext, quoteId: number): Promise<QuoteState> {
  const result = await callKw(
    rpc,
    'sale.order',
    'read',
    [[quoteId], ['state', 'subscription_state']],
    {},
  );
  if (
    !Array.isArray(result) ||
    result.length !== 1 ||
    !isRecord(result[0]) ||
    result[0].id !== quoteId
  ) {
    throw bridgeFailure('incompatible_response');
  }
  const rawState = result[0].state;
  if (typeof rawState !== 'string') throw bridgeFailure('incompatible_response');
  const rawSubscriptionState = result[0].subscription_state;
  if (
    rawSubscriptionState !== false &&
    rawSubscriptionState !== null &&
    typeof rawSubscriptionState !== 'string'
  ) {
    throw bridgeFailure('incompatible_response');
  }
  return {
    state: rawState === 'draft' || rawState === 'sent' ? rawState : 'other',
    subscriptionState:
      rawSubscriptionState === false || rawSubscriptionState === null ? null : rawSubscriptionState,
  };
}

function isEligibleQuote(state: QuoteState, target: QuoteShareTarget): boolean {
  if (state.state !== 'draft' && state.state !== 'sent') return false;
  return target === 'sales_quotation' || state.subscriptionState === '2_renewal';
}

function requireCurrentRoute(operation: QuoteShareBridgeOperation, pathname: string): void {
  if (pathname !== operation.pathname) throw bridgeFailure('access_denied');
  const route = parseQuoteShareRoutePathname(pathname);
  if (
    !route ||
    route.recordId !== operation.quoteId ||
    route.target !== operation.target ||
    route.pathname !== operation.pathname
  ) {
    throw bridgeFailure('access_denied');
  }
}

function activeSaleOrderContext(recordId: number): Record<string, unknown> {
  return {
    lang: 'en_US',
    active_model: 'sale.order',
    active_id: recordId,
    active_ids: [recordId],
  };
}

export async function executeOdooQuoteShareOperation(
  operation: QuoteShareBridgeOperation,
  options: {
    fetcher?: typeof fetch;
    origin?: string;
    timeoutMs?: number;
    requestId?: string;
    getPathname?: () => string;
  } = {},
): Promise<QuoteShareExecutionResult> {
  if (!isQuoteShareBridgeOperation(operation)) {
    return { ok: false, failure: bridgeFailure('incompatible_endpoint') };
  }
  const origin = options.origin ?? window.location.origin;
  if (origin !== ODOO_BRIDGE_ORIGIN) {
    return { ok: false, failure: bridgeFailure('incompatible_endpoint') };
  }

  const getPathname = options.getPathname ?? (() => window.location.pathname);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? QUOTE_SHARE_RUNTIME_TIMEOUT_MS,
  );
  const rpc: QuoteShareRpcContext = {
    fetcher: options.fetcher ?? window.fetch.bind(window),
    origin,
    requestId: options.requestId ?? null,
    signal: controller.signal,
  };

  try {
    requireCurrentRoute(operation, getPathname());
    await assertQuoteFieldContract(rpc);
    const before = await readQuoteState(rpc, operation.quoteId);
    const eligible = isEligibleQuote(before, operation.target);
    if (operation.name === 'inspectQuoteShareTarget') {
      return {
        ok: true,
        result: { quoteId: operation.quoteId, target: operation.target, eligible },
      };
    }
    if (!eligible) throw bridgeFailure('access_denied');

    requireCurrentRoute(operation, getPathname());
    const defaults = await callKw(rpc, 'portal.share', 'default_get', [['share_link']], {
      context: activeSaleOrderContext(operation.quoteId),
    });
    if (!isRecord(defaults)) throw bridgeFailure('incompatible_response');
    requireCurrentRoute(operation, getPathname());
    const after = await readQuoteState(rpc, operation.quoteId);
    if (!isEligibleQuote(after, operation.target)) throw bridgeFailure('access_denied');
    const shareLink = parseQuoteShareLink(defaults.share_link, operation.quoteId);
    if (!shareLink) throw bridgeFailure('incompatible_response');
    return {
      ok: true,
      result: { quoteId: operation.quoteId, target: operation.target, shareLink },
    };
  } catch (error) {
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (isRecord(error) && error.name === 'AbortError')
    ) {
      return { ok: false, failure: bridgeFailure('timeout') };
    }
    return {
      ok: false,
      failure: isBridgeFailure(error) ? error : bridgeFailure('network'),
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
