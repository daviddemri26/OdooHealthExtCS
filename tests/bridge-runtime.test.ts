import { describe, expect, it, vi } from 'vitest';

import {
  executeOdooBridgeCall,
  executeOdooConnectionProbe,
  installOdooBridge,
} from '../src/odoo/bridge-runtime';
import {
  ODOO_BRIDGE_CHANNEL,
  ODOO_BRIDGE_ORIGIN,
  ODOO_BRIDGE_VERSION,
  type OdooBridgeCall,
  type OdooBridgeRequest,
  type OdooBridgeResponse,
} from '../src/odoo/bridge-protocol';

function jsonResponse(value: unknown, options: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
}

const readTagsCall: OdooBridgeCall = {
  model: 'sale.order',
  method: 'read',
  args: [[42], ['tag_ids']],
  kwargs: {},
};

describe('MAIN-world Odoo bridge runtime', () => {
  it('replaces stale listeners and accepts messages only from the exact page source and origin', () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    const responses: OdooBridgeResponse[] = [];
    const pageWindow = {
      location: { origin: ODOO_BRIDGE_ORIGIN },
      addEventListener: (
        _type: string,
        listener: (event: MessageEvent) => void,
        options: AddEventListenerOptions,
      ) => {
        listeners.add(listener);
        options.signal?.addEventListener('abort', () => listeners.delete(listener));
      },
      postMessage: (message: OdooBridgeResponse) => responses.push(message),
    };
    const request: OdooBridgeRequest = {
      channel: ODOO_BRIDGE_CHANNEL,
      version: ODOO_BRIDGE_VERSION,
      direction: 'request',
      clientId: 'client-12345678',
      requestId: 'request-12345678',
      kind: 'ping',
    };
    const dispatch = (origin: string, source: unknown): void => {
      const event = { data: request, origin, source } as MessageEvent;
      for (const listener of listeners) listener(event);
    };

    installOdooBridge(pageWindow as unknown as Window);
    installOdooBridge(pageWindow as unknown as Window);
    expect(listeners).toHaveLength(1);
    dispatch('https://example.com', pageWindow);
    dispatch(ODOO_BRIDGE_ORIGIN, {});
    expect(responses).toHaveLength(0);
    dispatch(ODOO_BRIDGE_ORIGIN, pageWindow);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ ok: true, clientId: request.clientId });
  });

  it('uses the absolute same-origin endpoint and returns only allow-listed fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: 'request-12345678',
        result: [{ id: 42, tag_ids: [1, 2], secret_field: 'must not cross' }],
      }),
    );
    const result = await executeOdooBridgeCall(readTagsCall, {
      fetcher,
      origin: 'https://www.odoo.com',
      requestId: 'request-12345678',
    });

    expect(result).toEqual({ ok: true, result: [{ id: 42, tag_ids: [1, 2] }] });
    const [url, request] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('https://www.odoo.com/web/dataset/call_kw/sale.order/read');
    expect(request).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(request?.body))).toEqual({
      jsonrpc: '2.0',
      method: 'call',
      params: readTagsCall,
      id: 'request-12345678',
    });
  });

  it('accepts a signed linked partner and uses it for the bounded partner read', async () => {
    const readPartnerCall: OdooBridgeCall = {
      model: 'sale.order',
      method: 'read',
      args: [[42], ['partner_id']],
      kwargs: {},
    };
    const signedPartnerCall: OdooBridgeCall = {
      model: 'res.partner',
      method: 'read',
      args: [[-81], ['industry_id']],
      kwargs: {},
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: null,
          result: [{ id: 42, partner_id: [-81, 'Demo Customer'] }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: null,
          result: [{ id: -81, industry_id: [3, 'Demo Industry'] }],
        }),
      );

    await expect(
      executeOdooBridgeCall(readPartnerCall, { fetcher, origin: ODOO_BRIDGE_ORIGIN }),
    ).resolves.toEqual({
      ok: true,
      result: [{ id: 42, partner_id: [-81, 'Demo Customer'] }],
    });
    await expect(
      executeOdooBridgeCall(signedPartnerCall, { fetcher, origin: ODOO_BRIDGE_ORIGIN }),
    ).resolves.toEqual({
      ok: true,
      result: [{ id: -81, industry_id: [3, 'Demo Industry'] }],
    });

    expect(fetcher.mock.calls[1]?.[0]).toBe(
      'https://www.odoo.com/web/dataset/call_kw/res.partner/read',
    );
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      params: signedPartnerCall,
    });
  });

  it('sanitizes the bounded subscription list health response', async () => {
    const listCall: OdooBridgeCall = {
      model: 'sale.order',
      method: 'search_read',
      args: [[['name', 'in', ['SO2026/1']]]],
      kwargs: { fields: ['id', 'name', 'tag_ids'], limit: 2 },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: null,
        result: [
          {
            id: 42,
            name: 'SO2026/1',
            tag_ids: [11, 90],
            amount_total: 999,
            partner_id: [8, 'Private'],
          },
        ],
      }),
    );

    await expect(
      executeOdooBridgeCall(listCall, { fetcher, origin: ODOO_BRIDGE_ORIGIN }),
    ).resolves.toEqual({
      ok: true,
      result: [{ id: 42, name: 'SO2026/1', tag_ids: [11, 90] }],
    });
  });

  it('returns only the sanitized display name needed by the live connection UI', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: 'request-connection',
        result: {
          uid: 17,
          name: 'Private User',
          username: 'private@example.com',
          session_id: 'must-not-cross',
        },
      }),
    );

    const result = await executeOdooConnectionProbe({
      fetcher,
      origin: ODOO_BRIDGE_ORIGIN,
      requestId: 'request-connection',
    });

    expect(result).toEqual({
      ok: true,
      result: { authenticated: true, userDisplayName: 'Private User' },
    });
    expect(JSON.stringify(result)).not.toContain('private@example.com');
    expect(JSON.stringify(result)).not.toContain('must-not-cross');
    const [url, request] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('https://www.odoo.com/web/session/get_session_info');
    expect(request).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(request?.body))).toEqual({
      jsonrpc: '2.0',
      method: 'call',
      params: {},
      id: 'request-connection',
    });
  });

  it('sanitizes and bounds the connected user label', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: null,
        result: { uid: 17, name: `  Private\u202e   User ${'x'.repeat(140)}  ` },
      }),
    );

    const result = await executeOdooConnectionProbe({
      fetcher,
      origin: ODOO_BRIDGE_ORIGIN,
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('Expected a successful session probe.');
    const label = (result.result as { userDisplayName: string }).userDisplayName;
    expect(label).toMatch(/^Private User x+/);
    expect(label).not.toContain('\u202e');
    expect(label).toHaveLength(120);
  });

  it('distinguishes an expired session from an incompatible session response', async () => {
    const expiredFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jsonrpc: '2.0', id: null, result: { uid: false } }));
    await expect(
      executeOdooConnectionProbe({ fetcher: expiredFetcher, origin: ODOO_BRIDGE_ORIGIN }),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'session_expired' } });

    const incompatibleFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jsonrpc: '2.0', id: null, result: { company_id: 1 } }));
    await expect(
      executeOdooConnectionProbe({ fetcher: incompatibleFetcher, origin: ODOO_BRIDGE_ORIGIN }),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_response' } });
  });

  it('rejects invalid operations before contacting Odoo', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await executeOdooBridgeCall(
      { ...readTagsCall, model: 'res.users' },
      { fetcher, origin: 'https://www.odoo.com' },
    );
    expect(result).toMatchObject({ ok: false, failure: { code: 'incompatible_endpoint' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'session_expired'],
    [403, 'access_denied'],
    [404, 'incompatible_endpoint'],
    [500, 'server_error'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
    await expect(
      executeOdooBridgeCall(readTagsCall, { fetcher, origin: 'https://www.odoo.com' }),
    ).resolves.toMatchObject({ ok: false, failure: { code } });
  });

  it('treats redirects and successful HTML responses as expired sessions', async () => {
    const redirected = new Response('', { status: 200 });
    Object.defineProperty(redirected, 'redirected', { value: true });
    const redirectedFetcher = vi.fn<typeof fetch>().mockResolvedValue(redirected);
    await expect(
      executeOdooBridgeCall(readTagsCall, {
        fetcher: redirectedFetcher,
        origin: 'https://www.odoo.com',
      }),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'session_expired' } });

    const htmlFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>Sign in</html>', { status: 200 }));
    await expect(
      executeOdooBridgeCall(readTagsCall, {
        fetcher: htmlFetcher,
        origin: 'https://www.odoo.com',
      }),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'session_expired' } });
  });

  it('separates timeout, network, and sanitized server failures', async () => {
    const timeoutFetcher = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
      });
    });
    await expect(
      executeOdooBridgeCall(readTagsCall, {
        fetcher: timeoutFetcher,
        origin: 'https://www.odoo.com',
        timeoutMs: 2,
      }),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'timeout' } });

    const networkFetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private socket'));
    await expect(
      executeOdooBridgeCall(readTagsCall, {
        fetcher: networkFetcher,
        origin: 'https://www.odoo.com',
      }),
    ).resolves.toEqual({
      ok: false,
      failure: {
        code: 'network',
        message: 'The browser could not reach Odoo. Check your connection and retry.',
      },
    });

    const serverFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: null,
        error: {
          data: {
            name: 'odoo.exceptions.UserError',
            message: 'customer name and private stack trace',
          },
        },
      }),
    );
    const result = await executeOdooBridgeCall(readTagsCall, {
      fetcher: serverFetcher,
      origin: 'https://www.odoo.com',
    });
    expect(result).toEqual({
      ok: false,
      failure: { code: 'server_error', message: 'Odoo could not complete the request.' },
    });
    expect(JSON.stringify(result)).not.toContain('private stack');
  });

  it('fails closed on malformed successful result data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ jsonrpc: '2.0', id: null, result: [{ id: 42, tag_ids: ['not-an-id'] }] }),
      );
    await expect(
      executeOdooBridgeCall(readTagsCall, { fetcher, origin: 'https://www.odoo.com' }),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_response' } });
  });

  it.each([
    [
      { ...readTagsCall, args: [[42], ['partner_id']] },
      [{ id: 42, partner_id: [0, 'Zero Partner'] }],
    ],
    [readTagsCall, [{ id: -42, tag_ids: [] }]],
    [readTagsCall, [{ id: 42, tag_ids: [-11] }]],
    [
      { model: 'res.partner', method: 'read', args: [[-81], ['industry_id']], kwargs: {} },
      [{ id: -81, industry_id: [-3, 'Negative Industry'] }],
    ],
  ] satisfies [OdooBridgeCall, unknown][])(
    'keeps unrelated ID types positive',
    async (call, result) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ jsonrpc: '2.0', id: null, result }));

      await expect(
        executeOdooBridgeCall(call, { fetcher, origin: ODOO_BRIDGE_ORIGIN }),
      ).resolves.toMatchObject({ ok: false, failure: { code: 'incompatible_response' } });
    },
  );
});
