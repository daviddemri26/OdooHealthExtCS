import { describe, expect, it } from 'vitest';

import {
  ODOO_BRIDGE_CHANNEL,
  ODOO_BRIDGE_VERSION,
  isOdooBridgeRequest,
  isQuoteShareBridgeOperation,
  parseQuoteShareEligibilityResult,
  parseQuoteShareLinkResult,
} from '../src/odoo/bridge-protocol';

describe('Quote Share bridge protocol', () => {
  it('accepts only exact closed Share operations', () => {
    const operation = {
      name: 'getQuoteShareLink',
      quoteId: 8170012,
      target: 'sales_quotation',
      pathname: '/odoo/sales/8170012',
    } as const;
    expect(isQuoteShareBridgeOperation(operation)).toBe(true);
    expect(isQuoteShareBridgeOperation({ ...operation, model: 'sale.order' })).toBe(false);
    expect(isQuoteShareBridgeOperation({ ...operation, name: 'shareAnything' })).toBe(false);
    expect(isQuoteShareBridgeOperation({ ...operation, quoteId: -1 })).toBe(false);
    expect(isQuoteShareBridgeOperation({ ...operation, pathname: '/web/sales/8170012' })).toBe(
      false,
    );
  });

  it('accepts the exact versioned request envelope', () => {
    expect(
      isOdooBridgeRequest({
        channel: ODOO_BRIDGE_CHANNEL,
        version: ODOO_BRIDGE_VERSION,
        direction: 'request',
        clientId: 'client-12345678',
        requestId: 'request-12345678',
        kind: 'quoteShare',
        operation: {
          name: 'inspectQuoteShareTarget',
          quoteId: 42,
          target: 'renewal_quotation',
          pathname: '/odoo/subscriptions/10/sale.order/42',
        },
      }),
    ).toBe(true);
  });

  it('parses eligibility and validated Odoo Share links without widening their shape', () => {
    expect(
      parseQuoteShareEligibilityResult(
        { quoteId: 42, target: 'renewal_quotation', eligible: true },
        42,
        'renewal_quotation',
      ),
    ).toEqual({ quoteId: 42, target: 'renewal_quotation', eligible: true });
    expect(
      parseQuoteShareEligibilityResult(
        { quoteId: 42, target: 'renewal_quotation', eligible: true, state: 'draft' },
        42,
        'renewal_quotation',
      ),
    ).toBeNull();

    const shareLink =
      'https://www.odoo.com/mail/view?model=sale.order&res_id=42&access_token=secret';
    expect(
      parseQuoteShareLinkResult(
        { quoteId: 42, target: 'sales_quotation', shareLink },
        42,
        'sales_quotation',
      ),
    ).toEqual({ quoteId: 42, target: 'sales_quotation', shareLink });
    expect(
      parseQuoteShareLinkResult(
        {
          quoteId: 42,
          target: 'sales_quotation',
          shareLink: `${shareLink}&redirect=https://example.com`,
        },
        42,
        'sales_quotation',
      ),
    ).toBeNull();
  });
});
