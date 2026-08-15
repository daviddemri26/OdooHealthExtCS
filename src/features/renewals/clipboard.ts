import { normalizeDiscountTenths, isRenewalYears } from './domain';
import type { RenewalQuoteResult } from './types';

export function formatDiscountPercentage(discountTenths: number): string {
  const normalized = normalizeDiscountTenths(discountTenths);
  if (normalized === null)
    throw new RangeError('Discount tenths must be an integer from 0 to 1000.');

  const whole = Math.trunc(normalized / 10);
  const decimal = normalized % 10;
  return decimal === 0 ? `${whole}%` : `${whole}.${decimal}%`;
}

function normalizeLink(result: RenewalQuoteResult): string {
  if (!isRenewalYears(result.years)) throw new RangeError('Renewal years must be between 1 and 5.');
  if (normalizeDiscountTenths(result.discountTenths) === null) {
    throw new RangeError('Discount tenths must be an integer from 0 to 1000.');
  }

  const url = result.url.trim();
  if (!url) throw new TypeError('Renewal URL must not be empty.');
  return url;
}

export function formatRenewalLinkLabel(result: RenewalQuoteResult): string {
  normalizeLink(result);
  if (result.discountTenths === 0) return `${result.years}-year renewal`;
  return `${result.years}-year renewal — ${formatDiscountPercentage(result.discountTenths)} discount`;
}

export function getRenewalLinkForClipboard(result: RenewalQuoteResult): string {
  return normalizeLink(result);
}

export function formatRenewalLinksForClipboard(results: readonly RenewalQuoteResult[]): string {
  return [...results]
    .sort((left, right) => left.years - right.years)
    .map((result) => `${formatRenewalLinkLabel(result)}\n${normalizeLink(result)}`)
    .join('\n\n');
}

export function formatRenewalLinks(results: readonly RenewalQuoteResult[]): string {
  return formatRenewalLinksForClipboard(results);
}
