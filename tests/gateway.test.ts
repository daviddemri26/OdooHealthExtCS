import { describe, expect, it } from 'vitest';

import {
  ODOO_BRIDGE_CHANNEL,
  ODOO_BRIDGE_ORIGIN,
  ODOO_BRIDGE_VERSION,
  type OdooBridgeRequest,
  type OdooBridgeResponse,
} from '../src/odoo/bridge-protocol';
import { OdooGatewayError, PageContextOdooGateway } from '../src/odoo/gateway';

class FakeBridgeWindow {
  readonly location = { origin: ODOO_BRIDGE_ORIGIN };
  readonly posted: OdooBridgeRequest[] = [];
  responder: ((request: OdooBridgeRequest) => void) | null = null;
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  postMessage(message: unknown): void {
    const request = message as OdooBridgeRequest;
    this.posted.push(request);
    this.responder?.(request);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  emit(
    data: OdooBridgeResponse | Record<string, unknown>,
    options: { origin?: string; source?: unknown } = {},
  ): void {
    const event = {
      data,
      origin: options.origin ?? ODOO_BRIDGE_ORIGIN,
      source: options.source ?? this,
    } as MessageEvent;
    for (const listener of this.listeners) listener(event);
  }

  respond(request: OdooBridgeRequest, result: unknown): void {
    this.emit({
      channel: ODOO_BRIDGE_CHANNEL,
      version: ODOO_BRIDGE_VERSION,
      direction: 'response',
      clientId: request.clientId,
      requestId: request.requestId,
      ok: true,
      result,
    });
  }
}

function enablePing(window: FakeBridgeWindow): void {
  window.responder = (request) => {
    if (request.kind === 'ping') window.respond(request, { ready: true });
  };
}

async function waitForCalls(window: FakeBridgeWindow, count: number): Promise<OdooBridgeRequest[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const calls = window.posted.filter((request) => request.kind === 'call');
    if (calls.length === count) return calls;
    await Promise.resolve();
  }
  throw new Error(`Expected ${count} bridge calls.`);
}

describe('page-context Odoo gateway', () => {
  it('handshakes and correlates concurrent calls returned out of order', async () => {
    const bridgeWindow = new FakeBridgeWindow();
    enablePing(bridgeWindow);
    const gateway = new PageContextOdooGateway(bridgeWindow);

    const first = gateway.read('sale.order', [41], ['tag_ids']);
    const second = gateway.read('sale.order', [42], ['partner_id']);
    const [firstRequest, secondRequest] = await waitForCalls(bridgeWindow, 2);
    expect(firstRequest?.requestId).not.toBe(secondRequest?.requestId);

    bridgeWindow.respond(secondRequest!, [{ id: 42, partner_id: [7, 'Demo'] }]);
    bridgeWindow.respond(firstRequest!, [{ id: 41, tag_ids: [1, 2] }]);

    await expect(first).resolves.toEqual([{ id: 41, tag_ids: [1, 2] }]);
    await expect(second).resolves.toEqual([{ id: 42, partner_id: [7, 'Demo'] }]);
    expect(bridgeWindow.posted.filter((request) => request.kind === 'ping')).toHaveLength(1);
    gateway.dispose();
  });

  it('ignores foreign origins, clients, and stale request IDs', async () => {
    const bridgeWindow = new FakeBridgeWindow();
    enablePing(bridgeWindow);
    const gateway = new PageContextOdooGateway(bridgeWindow, 100);
    const pending = gateway.read('sale.order', [42], ['tag_ids']);
    const [request] = await waitForCalls(bridgeWindow, 1);
    const base = {
      channel: ODOO_BRIDGE_CHANNEL,
      version: ODOO_BRIDGE_VERSION,
      direction: 'response' as const,
      clientId: request!.clientId,
      requestId: request!.requestId,
      ok: true as const,
      result: [{ id: 42, tag_ids: [] }],
    };

    bridgeWindow.emit(base, { origin: 'https://example.com' });
    bridgeWindow.emit(base, { source: {} });
    bridgeWindow.emit({ ...base, version: 99 });
    bridgeWindow.emit({ ...base, result: undefined });
    bridgeWindow.emit({ ...base, clientId: 'client-foreign-id' });
    bridgeWindow.emit({ ...base, requestId: 'request-stale-id' });
    bridgeWindow.respond(request!, [{ id: 42, tag_ids: [] }]);

    await expect(pending).resolves.toEqual([{ id: 42, tag_ids: [] }]);
    gateway.dispose();
  });

  it('reports a missing bridge separately from an Odoo request timeout', async () => {
    const unavailableWindow = new FakeBridgeWindow();
    await expect(
      new PageContextOdooGateway(unavailableWindow, 20, 5).read('sale.order', [42], ['tag_ids']),
    ).rejects.toMatchObject({ code: 'bridge_unavailable' });

    const timeoutWindow = new FakeBridgeWindow();
    enablePing(timeoutWindow);
    const gateway = new PageContextOdooGateway(timeoutWindow, 5, 20);
    await expect(gateway.read('sale.order', [42], ['tag_ids'])).rejects.toMatchObject({
      code: 'timeout',
    });
    gateway.dispose();
  });

  it('rejects pending calls and ignores later responses after disposal', async () => {
    const bridgeWindow = new FakeBridgeWindow();
    enablePing(bridgeWindow);
    const gateway = new PageContextOdooGateway(bridgeWindow, 100);
    const pending = gateway.read('sale.order', [42], ['tag_ids']);
    const [request] = await waitForCalls(bridgeWindow, 1);
    gateway.dispose();
    bridgeWindow.respond(request!, [{ id: 42, tag_ids: [] }]);

    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<OdooGatewayError>>({ code: 'bridge_unavailable' }),
    );
  });

  it('maps sanitized bridge failures without exposing server details', async () => {
    const bridgeWindow = new FakeBridgeWindow();
    bridgeWindow.responder = (request) => {
      if (request.kind === 'ping') {
        bridgeWindow.respond(request, { ready: true });
        return;
      }
      bridgeWindow.emit({
        channel: ODOO_BRIDGE_CHANNEL,
        version: ODOO_BRIDGE_VERSION,
        direction: 'response',
        clientId: request.clientId,
        requestId: request.requestId,
        ok: false,
        failure: {
          code: 'access_denied',
          message: 'Odoo did not allow this action. Check your record permissions.',
        },
      });
    };

    await expect(
      new PageContextOdooGateway(bridgeWindow).write('res.partner', [42], {
        industry_id: false,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<OdooGatewayError>>({
        code: 'access_denied',
        message: 'Odoo did not allow this action. Check your record permissions.',
      }),
    );
  });
});
