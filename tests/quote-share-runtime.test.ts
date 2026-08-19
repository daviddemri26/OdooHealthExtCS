import { describe, expect, it, vi } from 'vitest';

import { executeOdooQuoteShareOperation } from '../src/odoo/share-link-runtime';

function rpcResult(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'share-test', result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const fieldDefinitions = {
  state: { type: 'selection' },
  subscription_state: { type: 'selection' },
};

describe('closed Quote Share runtime', () => {
  it.each([
    {
      target: 'renewal_quotation' as const,
      pathname: '/odoo/subscriptions/6690030/sale.order/sale.order/8169620',
      quoteId: 8169620,
      record: { id: 8169620, state: 'draft', subscription_state: '2_renewal' },
    },
    {
      target: 'sales_quotation' as const,
      pathname: '/odoo/sales/8170012',
      quoteId: 8170012,
      record: { id: 8170012, state: 'sent', subscription_state: false },
    },
    {
      target: 'renewal_quotation' as const,
      pathname: '/odoo/sale.order/7199099/sale.order/8175629',
      quoteId: 8175629,
      record: { id: 8175629, state: 'draft', subscription_state: '2_renewal' },
    },
  ])('recognizes an eligible $target using only bounded server fields', async (fixture) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rpcResult(fieldDefinitions))
      .mockResolvedValueOnce(rpcResult([fixture.record]));

    const result = await executeOdooQuoteShareOperation(
      {
        name: 'inspectQuoteShareTarget',
        quoteId: fixture.quoteId,
        target: fixture.target,
        pathname: fixture.pathname,
      },
      {
        fetcher,
        origin: 'https://www.odoo.com',
        getPathname: () => fixture.pathname,
      },
    );

    expect(result).toEqual({
      ok: true,
      result: { quoteId: fixture.quoteId, target: fixture.target, eligible: true },
    });
    const fieldRequest = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(fieldRequest.params).toEqual({
      model: 'sale.order',
      method: 'fields_get',
      args: [],
      kwargs: {
        allfields: ['state', 'subscription_state'],
        attributes: ['type'],
      },
    });
  });

  it('fails closed for confirmed orders and non-renewal subscription quotations', async () => {
    for (const record of [
      { id: 42, state: 'sale', subscription_state: false },
      { id: 42, state: 'draft', subscription_state: '3_progress' },
    ]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(rpcResult(fieldDefinitions))
        .mockResolvedValueOnce(rpcResult([record]));
      const result = await executeOdooQuoteShareOperation(
        {
          name: 'inspectQuoteShareTarget',
          quoteId: 42,
          target: 'renewal_quotation',
          pathname: '/odoo/subscriptions/10/sale.order/42',
        },
        {
          fetcher,
          origin: 'https://www.odoo.com',
          getPathname: () => '/odoo/subscriptions/10/sale.order/42',
        },
      );
      expect(result).toEqual({
        ok: true,
        result: { quoteId: 42, target: 'renewal_quotation', eligible: false },
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it('uses portal.share default_get and returns only the validated current-record link', async () => {
    const pathname = '/odoo/sales/8170012';
    const record = { id: 8170012, state: 'draft', subscription_state: false };
    const shareLink =
      'https://www.odoo.com/mail/view?model=sale.order&res_id=8170012&access_token=secret';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rpcResult(fieldDefinitions))
      .mockResolvedValueOnce(rpcResult([record]))
      .mockResolvedValueOnce(rpcResult({ share_link: shareLink }))
      .mockResolvedValueOnce(rpcResult([record]));

    const result = await executeOdooQuoteShareOperation(
      {
        name: 'getQuoteShareLink',
        quoteId: 8170012,
        target: 'sales_quotation',
        pathname,
      },
      { fetcher, origin: 'https://www.odoo.com', getPathname: () => pathname },
    );

    expect(result).toEqual({
      ok: true,
      result: { quoteId: 8170012, target: 'sales_quotation', shareLink },
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      'https://www.odoo.com/web/dataset/call_kw/portal.share/default_get',
    );
    const shareRequest = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
    expect(shareRequest.params).toEqual({
      model: 'portal.share',
      method: 'default_get',
      args: [['share_link']],
      kwargs: {
        context: {
          lang: 'en_US',
          active_model: 'sale.order',
          active_id: 8170012,
          active_ids: [8170012],
        },
      },
    });
  });

  it('does not contact Odoo when the requested record is not the current route', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await executeOdooQuoteShareOperation(
      {
        name: 'getQuoteShareLink',
        quoteId: 42,
        target: 'sales_quotation',
        pathname: '/odoo/sales/42',
      },
      {
        fetcher,
        origin: 'https://www.odoo.com',
        getPathname: () => '/odoo/sales/43',
      },
    );
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'access_denied' }),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a malformed or foreign Share link', async () => {
    const pathname = '/odoo/sales/42';
    const record = { id: 42, state: 'draft', subscription_state: false };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rpcResult(fieldDefinitions))
      .mockResolvedValueOnce(rpcResult([record]))
      .mockResolvedValueOnce(
        rpcResult({
          share_link:
            'https://example.com/mail/view?model=sale.order&res_id=42&access_token=secret',
        }),
      )
      .mockResolvedValueOnce(rpcResult([record]));
    const result = await executeOdooQuoteShareOperation(
      {
        name: 'getQuoteShareLink',
        quoteId: 42,
        target: 'sales_quotation',
        pathname,
      },
      { fetcher, origin: 'https://www.odoo.com', getPathname: () => pathname },
    );
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'incompatible_response' }),
    });
  });
});
