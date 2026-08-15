import { describe, expect, it } from 'vitest';

import {
  formatDiscountPercentage,
  formatRenewalLinks,
  formatRenewalLinksForClipboard,
  getRenewalLinkForClipboard,
} from '../src/features/renewals/clipboard';
import { normalizeDiscountTenths } from '../src/features/renewals/domain';
import type { RenewalQuoteResult, RenewalYears } from '../src/features/renewals/types';

function result(
  years: RenewalYears,
  discountTenthsValue: number,
  url = `https://www.odoo.com/quote/${years}`,
): RenewalQuoteResult {
  const discountTenths = normalizeDiscountTenths(discountTenthsValue);
  if (discountTenths === null) throw new Error('Invalid test discount.');

  return {
    years,
    discountTenths,
    quoteId: years,
    quoteName: `Q${years}`,
    url,
  };
}

describe('renewal clipboard formatting', () => {
  it('omits an unnecessary decimal for whole percentages', () => {
    expect(formatDiscountPercentage(0)).toBe('0%');
    expect(formatDiscountPercentage(30)).toBe('3%');
    expect(formatDiscountPercentage(100)).toBe('10%');
    expect(formatDiscountPercentage(65)).toBe('6.5%');
    // The new editor uses 0.5% steps, but an already-created historical result
    // must remain displayable and copyable at its exact recorded percentage.
    expect(formatDiscountPercentage(79)).toBe('7.9%');
  });

  it('sorts links by term and uses the exact two-line block format', () => {
    expect(
      formatRenewalLinksForClipboard([
        result(3, 65, 'https://www.odoo.com/three'),
        result(1, 0, 'https://www.odoo.com/one'),
        result(2, 30, 'https://www.odoo.com/two'),
      ]),
    ).toBe(
      [
        '1-year renewal',
        'https://www.odoo.com/one',
        '',
        '2-year renewal — 3% discount',
        'https://www.odoo.com/two',
        '',
        '3-year renewal — 6.5% discount',
        'https://www.odoo.com/three',
      ].join('\n'),
    );
  });

  it('omits the discount wording entirely when the recorded discount is zero', () => {
    expect(formatRenewalLinksForClipboard([result(1, 0)])).toBe(
      '1-year renewal\nhttps://www.odoo.com/quote/1',
    );
  });

  it('formats only the available results without a header or trailing newline', () => {
    const formatted = formatRenewalLinksForClipboard([result(5, 100)]);
    expect(formatted).toBe('5-year renewal — 10% discount\nhttps://www.odoo.com/quote/5');
    expect(formatted.endsWith('\n')).toBe(false);
    expect(formatRenewalLinksForClipboard([])).toBe('');
    expect(formatRenewalLinks([result(5, 100)])).toBe(formatted);
  });

  it('returns only the trimmed URL for an individual link', () => {
    expect(getRenewalLinkForClipboard(result(2, 30, '  https://www.odoo.com/two  '))).toBe(
      'https://www.odoo.com/two',
    );
  });

  it('fails closed for invalid discounts and empty links', () => {
    expect(() => formatDiscountPercentage(-1)).toThrow(RangeError);
    expect(() => formatDiscountPercentage(1_001)).toThrow(RangeError);
    expect(() => getRenewalLinkForClipboard(result(1, 0, '   '))).toThrow(TypeError);
  });
});
