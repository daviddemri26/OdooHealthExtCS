import { describe, expect, it, vi } from 'vitest';

import { OdooGatewayError, SameSessionOdooGateway } from '../src/odoo/gateway';

function jsonResponse(value: unknown, options: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
}

describe('same-session Odoo gateway', () => {
  it('uses the relative call_kw endpoint and same-origin credentials', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: [{ id: 42, tag_ids: [] }] }),
      );
    const gateway = new SameSessionOdooGateway(fetcher);
    await gateway.read('sale.order', [42], ['tag_ids']);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('/web/dataset/call_kw/sale.order/read');
    expect(request).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      params: { model: 'sale.order', method: 'read', args: [[42], ['tag_ids']] },
    });
  });

  it('maps access errors to a sanitized public message', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        error: { data: { name: 'odoo.exceptions.AccessError', message: 'private stack trace' } },
      }),
    );
    await expect(new SameSessionOdooGateway(fetcher).write('sale.order', [42], {})).rejects.toEqual(
      expect.objectContaining<Partial<OdooGatewayError>>({
        code: 'access_denied',
        message: 'Odoo did not allow this change. Check your record permissions.',
      }),
    );
  });

  it('treats an HTML response as an expired session', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html>Sign in</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    await expect(
      new SameSessionOdooGateway(fetcher).read('sale.order', [42], []),
    ).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('sanitizes network failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket details'));
    await expect(
      new SameSessionOdooGateway(fetcher).read('sale.order', [42], []),
    ).rejects.toMatchObject({
      code: 'network',
      message: 'Odoo is temporarily unreachable.',
    });
  });
});
