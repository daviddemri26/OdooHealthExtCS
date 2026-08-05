import type {
  CompatibilityCode,
  OdooDomain,
  OdooFieldDefinition,
  OdooGateway,
  OdooRecord,
  OdooValues,
} from '../shared/types';

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: number | null;
  result: T;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: number | null;
  error: {
    code?: number;
    message?: string;
    data?: {
      name?: string;
      message?: string;
    };
  };
}

type JsonRpcEnvelope<T> = JsonRpcSuccess<T> | JsonRpcError;

let requestId = 0;

export class OdooGatewayError extends Error {
  constructor(
    public readonly code: CompatibilityCode,
    message: string,
  ) {
    super(message);
    this.name = 'OdooGatewayError';
  }
}

function classifyServerError(error: JsonRpcError['error']): OdooGatewayError {
  const name = error.data?.name ?? '';
  if (/access(error|denied)/i.test(name)) {
    return new OdooGatewayError(
      'access_denied',
      'Odoo did not allow this change. Check your record permissions.',
    );
  }
  if (/session|authentication/i.test(name)) {
    return new OdooGatewayError(
      'session_expired',
      'Your Odoo session has expired. Sign in again and retry.',
    );
  }
  if (/attributeerror|keyerror|missingerror/i.test(name)) {
    return new OdooGatewayError(
      'incompatible_response',
      'This Odoo version is not currently compatible with the extension.',
    );
  }
  return new OdooGatewayError('server_error', 'Odoo could not complete the request.');
}

export class SameSessionOdooGateway implements OdooGateway {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  async read<T extends OdooRecord>(model: string, ids: number[], fields: string[]): Promise<T[]> {
    return this.callKw<T[]>(model, 'read', [ids, fields], {});
  }

  async fieldsGet(
    model: string,
    fields: string[],
    attributes = ['type', 'relation', 'readonly', 'string'],
  ): Promise<Record<string, OdooFieldDefinition>> {
    return this.callKw(model, 'fields_get', [], {
      allfields: fields,
      attributes,
    });
  }

  async searchRead<T extends OdooRecord>(
    model: string,
    domain: OdooDomain,
    fields: string[],
    options: { limit?: number; order?: string } = {},
  ): Promise<T[]> {
    return this.callKw<T[]>(model, 'search_read', [domain], {
      fields,
      limit: options.limit ?? 100,
      ...(options.order ? { order: options.order } : {}),
    });
  }

  async write(model: string, ids: number[], values: OdooValues): Promise<boolean> {
    return this.callKw<boolean>(model, 'write', [ids, values], {});
  }

  private async callKw<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(
        `/web/dataset/call_kw/${encodeURIComponent(model)}/${encodeURIComponent(method)}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'call',
            params: { model, method, args, kwargs },
            id: ++requestId,
          }),
          signal: controller.signal,
        },
      );

      const contentType = response.headers.get('content-type') ?? '';
      if (response.redirected || (!contentType.includes('json') && response.ok)) {
        throw new OdooGatewayError(
          'session_expired',
          'Your Odoo session has expired. Sign in again and retry.',
        );
      }
      if (!response.ok) {
        throw new OdooGatewayError('network', 'Odoo is temporarily unreachable.');
      }

      const payload = (await response.json()) as JsonRpcEnvelope<T>;
      if ('error' in payload) throw classifyServerError(payload.error);
      if (!('result' in payload)) {
        throw new OdooGatewayError(
          'incompatible_response',
          'Odoo returned an unsupported response.',
        );
      }
      return payload.result;
    } catch (error) {
      if (error instanceof OdooGatewayError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new OdooGatewayError('network', 'The Odoo request timed out.');
      }
      throw new OdooGatewayError('network', 'Odoo is temporarily unreachable.');
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
