import type {
  CompatibilityCode,
  OdooDomain,
  OdooFieldDefinition,
  OdooGateway,
  OdooRecord,
  OdooValues,
} from '../shared/types';
import {
  ODOO_BRIDGE_CHANNEL,
  ODOO_BRIDGE_ORIGIN,
  ODOO_BRIDGE_VERSION,
  bridgeFailure,
  isOdooBridgeResponse,
  type OdooBridgeCall,
  type OdooBridgeRequest,
} from './bridge-protocol';

interface BridgeWindow {
  readonly location: Pick<Location, 'origin'>;
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: OdooGatewayError) => void;
  timeout: ReturnType<typeof globalThis.setTimeout>;
}

export class OdooGatewayError extends Error {
  constructor(
    public readonly code: CompatibilityCode,
    message: string,
  ) {
    super(message);
    this.name = 'OdooGatewayError';
  }
}

function randomIdentifier(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class PageContextOdooGateway implements OdooGateway {
  private readonly clientId = randomIdentifier('client');
  private readonly pending = new Map<string, PendingRequest>();
  private readonly handleMessageBound = (event: MessageEvent): void => this.handleMessage(event);
  private readyPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly messageWindow: BridgeWindow = window,
    private readonly timeoutMs = 15_000,
    private readonly bridgeReadyTimeoutMs = 1_500,
  ) {
    this.messageWindow.addEventListener('message', this.handleMessageBound);
  }

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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.messageWindow.removeEventListener('message', this.handleMessageBound);
    const failure = bridgeFailure('bridge_unavailable');
    for (const request of this.pending.values()) {
      globalThis.clearTimeout(request.timeout);
      request.reject(new OdooGatewayError(failure.code, failure.message));
    }
    this.pending.clear();
    this.readyPromise = null;
  }

  private async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.sendRequest({ kind: 'ping' }, this.bridgeReadyTimeoutMs, true).then(
        () => undefined,
      );
    }
    try {
      await this.readyPromise;
    } catch (error) {
      this.readyPromise = null;
      throw error;
    }
  }

  private async callKw<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown>,
  ): Promise<T> {
    await this.ensureReady();
    const call: OdooBridgeCall = { model, method, args, kwargs };
    return (await this.sendRequest({ kind: 'call', call }, this.timeoutMs, false)) as T;
  }

  private sendRequest(
    requestBody: Pick<OdooBridgeRequest, 'kind'> &
      Partial<Pick<Extract<OdooBridgeRequest, { kind: 'call' }>, 'call'>>,
    timeoutMs: number,
    isReadyCheck: boolean,
  ): Promise<unknown> {
    if (this.disposed || this.messageWindow.location.origin !== ODOO_BRIDGE_ORIGIN) {
      const failure = bridgeFailure('bridge_unavailable');
      return Promise.reject(new OdooGatewayError(failure.code, failure.message));
    }

    const requestId = randomIdentifier('request');
    const request: OdooBridgeRequest =
      requestBody.kind === 'ping'
        ? {
            channel: ODOO_BRIDGE_CHANNEL,
            version: ODOO_BRIDGE_VERSION,
            direction: 'request',
            clientId: this.clientId,
            requestId,
            kind: 'ping',
          }
        : {
            channel: ODOO_BRIDGE_CHANNEL,
            version: ODOO_BRIDGE_VERSION,
            direction: 'request',
            clientId: this.clientId,
            requestId,
            kind: 'call',
            call: requestBody.call as OdooBridgeCall,
          };

    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        this.pending.delete(requestId);
        const failure = bridgeFailure(isReadyCheck ? 'bridge_unavailable' : 'timeout');
        reject(new OdooGatewayError(failure.code, failure.message));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      try {
        this.messageWindow.postMessage(request, ODOO_BRIDGE_ORIGIN);
      } catch {
        globalThis.clearTimeout(timeout);
        this.pending.delete(requestId);
        const failure = bridgeFailure('bridge_unavailable');
        reject(new OdooGatewayError(failure.code, failure.message));
      }
    });
  }

  private handleMessage(event: MessageEvent): void {
    if (
      event.source !== (this.messageWindow as unknown as MessageEventSource) ||
      event.origin !== ODOO_BRIDGE_ORIGIN ||
      !isOdooBridgeResponse(event.data) ||
      event.data.clientId !== this.clientId
    ) {
      return;
    }

    const request = this.pending.get(event.data.requestId);
    if (!request) return;
    this.pending.delete(event.data.requestId);
    globalThis.clearTimeout(request.timeout);
    if (event.data.ok) {
      request.resolve(event.data.result);
    } else {
      request.reject(new OdooGatewayError(event.data.failure.code, event.data.failure.message));
    }
  }
}
