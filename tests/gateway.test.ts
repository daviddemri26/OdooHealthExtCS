import { describe, expect, it, vi } from 'vitest';

import {
  ODOO_BRIDGE_CHANNEL,
  ODOO_BRIDGE_ORIGIN,
  ODOO_BRIDGE_VERSION,
  type OdooBridgeRequest,
  type OdooBridgeResponse,
} from '../src/odoo/bridge-protocol';
import {
  OdooGatewayError,
  PageContextOdooGateway,
  RENEWAL_GATEWAY_TIMEOUT_MS,
} from '../src/odoo/gateway';
import type { RenewalGateway } from '../src/odoo/renewal-contracts';

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

  fail(request: OdooBridgeRequest, code: 'timeout' | 'incompatible_response'): void {
    this.emit({
      channel: ODOO_BRIDGE_CHANNEL,
      version: ODOO_BRIDGE_VERSION,
      direction: 'response',
      clientId: request.clientId,
      requestId: request.requestId,
      ok: false,
      failure: {
        code,
        message:
          code === 'timeout'
            ? 'The Odoo request timed out. Please retry.'
            : 'This Odoo version returned an unsupported response.',
      },
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

async function waitForRenewals(
  window: FakeBridgeWindow,
  count: number,
): Promise<OdooBridgeRequest[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const requests = window.posted.filter((request) => request.kind === 'renewal');
    if (requests.length === count) return requests;
    await Promise.resolve();
  }
  throw new Error(`Expected ${count} renewal bridge requests.`);
}

async function waitForCustomerData(
  window: FakeBridgeWindow,
  count: number,
): Promise<OdooBridgeRequest[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const requests = window.posted.filter((request) => request.kind === 'customerData');
    if (requests.length === count) return requests;
    await Promise.resolve();
  }
  throw new Error(`Expected ${count} customer-data bridge requests.`);
}

describe('page-context Odoo gateway', () => {
  it('does not expose the retired generic write authority', () => {
    const gateway = new PageContextOdooGateway(new FakeBridgeWindow());
    expect('write' in gateway).toBe(false);
    gateway.dispose();
  });

  it('checks the general Odoo session independently from feature RPC calls', async () => {
    const bridgeWindow = new FakeBridgeWindow();
    bridgeWindow.responder = (request) => {
      if (request.kind === 'ping') bridgeWindow.respond(request, { ready: true });
      if (request.kind === 'probe') bridgeWindow.respond(request, { authenticated: true });
    };
    const gateway = new PageContextOdooGateway(bridgeWindow);

    await expect(gateway.checkConnection()).resolves.toEqual({ authenticated: true });
    expect(bridgeWindow.posted.map((request) => request.kind)).toEqual(['ping', 'probe']);
    expect(bridgeWindow.posted.some((request) => request.kind === 'call')).toBe(false);
    gateway.dispose();
  });

  it('returns the connected user label and rejects malformed probe results', async () => {
    const bridgeWindow = new FakeBridgeWindow();
    bridgeWindow.responder = (request) => {
      if (request.kind === 'ping') bridgeWindow.respond(request, { ready: true });
      if (request.kind === 'probe') {
        bridgeWindow.respond(request, { authenticated: true, userDisplayName: 'Demo User' });
      }
    };
    const gateway = new PageContextOdooGateway(bridgeWindow);
    await expect(gateway.checkConnection()).resolves.toEqual({
      authenticated: true,
      userDisplayName: 'Demo User',
    });
    gateway.dispose();

    const malformedWindow = new FakeBridgeWindow();
    malformedWindow.responder = (request) => {
      if (request.kind === 'ping') malformedWindow.respond(request, { ready: true });
      if (request.kind === 'probe') {
        malformedWindow.respond(request, { authenticated: true, userDisplayName: 17 });
      }
    };
    const malformedGateway = new PageContextOdooGateway(malformedWindow);
    await expect(malformedGateway.checkConnection()).rejects.toMatchObject({
      code: 'incompatible_response',
    });
    malformedGateway.dispose();
  });

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

  it('sends renewal work through the closed operation envelope', async () => {
    const bridgeWindow = new FakeBridgeWindow();
    enablePing(bridgeWindow);
    const gateway = new PageContextOdooGateway(bridgeWindow);

    const pending = gateway.copyNativePlan(81, 5, 'renewal-12345678');
    const [request] = await waitForRenewals(bridgeWindow, 1);
    expect(request).toMatchObject({
      kind: 'renewal',
      operation: {
        name: 'copyNativePlan',
        sourceQuoteId: 81,
        years: 5,
        runId: 'renewal-12345678',
      },
    });
    bridgeWindow.respond(request!, { quoteId: 82 });

    await expect(pending).resolves.toEqual({ quoteId: 82 });
    expect(bridgeWindow.posted.some((posted) => posted.kind === 'call')).toBe(false);
    gateway.dispose();
  });

  it('sends customer mutations through exact closed operation envelopes', async () => {
    const bridgeWindow = new FakeBridgeWindow();
    enablePing(bridgeWindow);
    const gateway = new PageContextOdooGateway(bridgeWindow);

    const pending = gateway.applyHealthState(42, 'low');
    const [request] = await waitForCustomerData(bridgeWindow, 1);
    expect(request).toMatchObject({
      kind: 'customerData',
      operation: { name: 'applyHealthState', sourceOrderId: 42, nextState: 'low' },
    });
    bridgeWindow.respond(request!, {
      sourceOrderId: 42,
      beforeHealthTagIds: [11],
      appliedHealthTagIds: [13],
      state: 'low',
    });

    await expect(pending).resolves.toEqual({
      sourceOrderId: 42,
      beforeHealthTagIds: [11],
      appliedHealthTagIds: [13],
      state: 'low',
    });
    expect(bridgeWindow.posted.some((posted) => posted.kind === 'call')).toBe(false);
    gateway.dispose();
  });

  it('includes the frozen Discount requirement in the closed native Renew operation', async () => {
    const bridgeWindow = new FakeBridgeWindow();
    enablePing(bridgeWindow);
    const gateway = new PageContextOdooGateway(bridgeWindow);

    const pending = gateway.createNativeRenewal(
      42,
      'renewal-12345678',
      {
        planId: 7,
        currentContractMonths: 12,
        writeDate: '2026-08-14 12:00:00',
      },
      [1, 5],
      true,
    );
    const [request] = await waitForRenewals(bridgeWindow, 1);
    expect(request).toMatchObject({
      kind: 'renewal',
      operation: {
        name: 'createNativeRenewal',
        sourceOrderId: 42,
        runId: 'renewal-12345678',
        expected: {
          planId: 7,
          currentContractMonths: 12,
          writeDate: '2026-08-14 12:00:00',
        },
        requiredCopyYears: [1, 5],
        requiresDiscount: true,
      },
    });
    bridgeWindow.respond(request!, { quoteId: 82 });

    await expect(pending).resolves.toEqual({ quoteId: 82 });
    expect(bridgeWindow.posted.some((posted) => posted.kind === 'call')).toBe(false);
    gateway.dispose();
  });

  it('sends run cleanup through its exact closed renewal operation', async () => {
    const bridgeWindow = new FakeBridgeWindow();
    enablePing(bridgeWindow);
    const gateway = new PageContextOdooGateway(bridgeWindow);

    const pending = gateway.finishRenewalRun('renewal-12345678');
    const [request] = await waitForRenewals(bridgeWindow, 1);
    expect(request).toMatchObject({
      kind: 'renewal',
      operation: { name: 'finishRenewalRun', runId: 'renewal-12345678' },
    });
    bridgeWindow.respond(request!, true);

    await expect(pending).resolves.toBeUndefined();
    expect(bridgeWindow.posted.some((posted) => posted.kind === 'call')).toBe(false);
    gateway.dispose();
  });

  it('rejects malformed results independently for every renewal operation', async () => {
    const cases: {
      invoke: (gateway: RenewalGateway) => Promise<unknown>;
      invalidResult: unknown;
    }[] = [
      {
        invoke: (gateway) => gateway.preflightRenewal(42),
        invalidResult: {
          eligible: true,
          sourceOrderId: 42,
          planId: 7,
          renewalQuoteCount: 6,
          writeDate: '2026-08-14 12:00:00',
          billingPeriodValue: 1,
          billingPeriodUnit: 'year',
          currentContractMonths: 12,
          allowedTargetYears: [2, 3, 4, 5],
        },
      },
      {
        invoke: (gateway) =>
          gateway.createNativeRenewal(
            42,
            'renewal-12345678',
            {
              planId: 7,
              currentContractMonths: 12,
              writeDate: '2026-08-14 12:00:00',
            },
            [],
            false,
          ),
        invalidResult: { quoteId: 42 },
      },
      {
        invoke: (gateway) => gateway.copyNativePlan(81, 5, 'renewal-12345678'),
        invalidResult: { quoteId: 81 },
      },
      {
        invoke: (gateway) => gateway.clearNativeMultiYearDiscount(82, 'renewal-12345678'),
        invalidResult: { removedLineCount: -1 },
      },
      {
        invoke: (gateway) => gateway.applyNativeGlobalDiscount(82, 65, 'renewal-12345678'),
        invalidResult: { createdLineCount: 0 },
      },
      {
        invoke: (gateway) => gateway.getNativeShareLink(82, 'renewal-12345678'),
        invalidResult: {
          quoteId: 82,
          shareLink: 'https://example.com/mail/view?model=sale.order&res_id=82&access_token=x',
        },
      },
      {
        invoke: (gateway) => gateway.readRenewalQuoteSummary(82, 'renewal-12345678'),
        invalidResult: {
          quoteId: 82,
          createdFromQuoteId: 42,
          name: 'SO2026/82',
          state: 'draft',
          subscriptionState: '2_renewal',
          planId: 8,
          billingPeriodValue: 5,
          billingPeriodUnit: 'year',
          currentContractMonths: 60,
          templateId: 11,
          currencyId: 2,
          currencyRounding: 0.01,
          amountUntaxed: 90,
          amountTax: 0,
          amountTotal: 90,
          lineCount: 1,
          multiYearDiscountLineCount: 0,
          lines: [],
        },
      },
      {
        invoke: (gateway) => gateway.finishRenewalRun('renewal-12345678'),
        invalidResult: { finished: true },
      },
    ];

    for (const scenario of cases) {
      const bridgeWindow = new FakeBridgeWindow();
      enablePing(bridgeWindow);
      const gateway = new PageContextOdooGateway(bridgeWindow);
      const pending = scenario.invoke(gateway);
      const [request] = await waitForRenewals(bridgeWindow, 1);
      bridgeWindow.respond(request!, scenario.invalidResult);
      await expect(pending).rejects.toMatchObject({ code: 'incompatible_response' });
      gateway.dispose();
    }
  });

  it('waits for the runtime renewal timeout response without retrying', async () => {
    vi.useFakeTimers();
    const bridgeWindow = new FakeBridgeWindow();
    enablePing(bridgeWindow);
    const gateway = new PageContextOdooGateway(bridgeWindow, 5, 20);
    let settlement: unknown = 'pending';

    try {
      const pending = gateway.preflightRenewal(42).then(
        (result) => {
          settlement = result;
        },
        (error: unknown) => {
          settlement = error;
        },
      );
      const [request] = await waitForRenewals(bridgeWindow, 1);

      await vi.advanceTimersByTimeAsync(15_500);
      expect(settlement).toBe('pending');
      expect(RENEWAL_GATEWAY_TIMEOUT_MS).toBeGreaterThan(15_500);
      expect(bridgeWindow.posted.filter((posted) => posted.kind === 'renewal')).toHaveLength(1);

      bridgeWindow.fail(request!, 'timeout');
      await pending;
      expect(settlement).toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(RENEWAL_GATEWAY_TIMEOUT_MS);
      expect(bridgeWindow.posted.filter((posted) => posted.kind === 'renewal')).toHaveLength(1);
    } finally {
      gateway.dispose();
      vi.useRealTimers();
    }
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

    const gateway = new PageContextOdooGateway(bridgeWindow);
    await expect(gateway.applyIndustry(42, 81, null)).rejects.toEqual(
      expect.objectContaining<Partial<OdooGatewayError>>({
        code: 'access_denied',
        message: 'Odoo did not allow this action. Check your record permissions.',
      }),
    );
    gateway.dispose();
  });
});
