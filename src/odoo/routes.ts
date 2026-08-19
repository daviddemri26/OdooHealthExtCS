import type { SubscriptionRoute } from '../shared/types';
import type { QuoteShareRoute, QuoteShareTarget } from './share-link-contracts';

const ODOO_HOST = 'www.odoo.com';
const ODOO_PATH_PREFIX = '/odoo';

interface RouteCandidate {
  model: string;
  recordId: number;
}

function routeCandidates(pathname: string, includeSalesAlias = false): RouteCandidate[] {
  const segments = pathname.split('/').filter(Boolean);
  const candidates: RouteCandidate[] = [];

  for (let index = 1; index < segments.length - 1; index += 1) {
    const token = segments[index];
    const recordId = Number(segments[index + 1]);
    if (!token || !Number.isSafeInteger(recordId) || recordId <= 0) continue;

    if (token === 'subscriptions' || (includeSalesAlias && token === 'sales')) {
      candidates.push({ model: 'sale.order', recordId });
    } else if (token.includes('.')) {
      candidates.push({ model: token, recordId });
    }
  }
  return candidates;
}

export function isAllowedOdooLocation(location: Pick<Location, 'hostname' | 'pathname'>): boolean {
  return location.hostname === ODOO_HOST && location.pathname.startsWith(ODOO_PATH_PREFIX);
}

export function parseSubscriptionRoute(
  location: Pick<Location, 'hostname' | 'pathname'>,
): SubscriptionRoute | null {
  if (!isAllowedOdooLocation(location)) return null;

  const candidates = routeCandidates(location.pathname);
  const active = candidates.at(-1);
  if (!active || active.model !== 'sale.order') return null;

  return {
    model: 'sale.order',
    recordId: active.recordId,
    pathname: location.pathname,
  };
}

export function parseQuoteShareRoutePathname(pathname: string): QuoteShareRoute | null {
  if (!pathname.startsWith(`${ODOO_PATH_PREFIX}/`) || pathname.length > 1_024) return null;
  const segments = pathname.split('/').filter(Boolean);
  const rootSection = segments[1];
  const target: QuoteShareTarget | null =
    rootSection === 'subscriptions' || rootSection === 'sale.order'
      ? 'renewal_quotation'
      : rootSection === 'sales'
        ? 'sales_quotation'
        : null;
  if (!target) return null;

  const active = routeCandidates(pathname, true).at(-1);
  if (!active || active.model !== 'sale.order') return null;
  return {
    model: 'sale.order',
    recordId: active.recordId,
    pathname,
    target,
  };
}

export function getRenderedQuoteShareRoute(
  location: Pick<Location, 'hostname' | 'pathname'>,
  root: ParentNode = document,
): QuoteShareRoute | null {
  if (!isAllowedOdooLocation(location)) return null;
  const route = parseQuoteShareRoutePathname(location.pathname);
  const form = root.querySelector('.o_form_view');
  if (!route || !form?.querySelector('[name="partner_id"]')) return null;
  return route;
}

export function isExactQuoteShareRoute(
  route: QuoteShareRoute | null,
  expected: QuoteShareRoute,
): boolean {
  return Boolean(
    route &&
    route.recordId === expected.recordId &&
    route.pathname === expected.pathname &&
    route.target === expected.target,
  );
}

export function isRenderedSubscriptionForm(pathname: string, root: ParentNode = document): boolean {
  if (!root.querySelector('.o_form_view')) return false;
  if (!root.querySelector('[name="partner_id"]')) return false;
  return (
    pathname.includes('/subscriptions/') ||
    Boolean(root.querySelector('[name="subscription_state"]'))
  );
}

/** Resolves the rendered subscription record without deciding feature eligibility. */
export function getRenderedSubscriptionRoute(
  location: Pick<Location, 'hostname' | 'pathname'>,
  root: ParentNode = document,
): SubscriptionRoute | null {
  const route = parseSubscriptionRoute(location);
  return route && isRenderedSubscriptionForm(route.pathname, root) ? route : null;
}

export function isExactSubscriptionRoute(
  route: SubscriptionRoute | null,
  recordId: number,
  pathname: string | null,
): boolean {
  return Boolean(route && route.recordId === recordId && route.pathname === pathname);
}

function normalizeStatusLabel(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

export function getRenderedSubscriptionStatusLabel(root: ParentNode = document): string | null {
  const fields = Array.from(
    root.querySelectorAll<HTMLElement>('.o_form_view [name="subscription_state"]'),
  );
  const labels = fields.flatMap((field) => {
    const badges = Array.from(field.querySelectorAll<HTMLElement>('.badge'));
    return (badges.length > 0 ? badges : [field])
      .map((label) => normalizeStatusLabel(label.textContent))
      .filter(Boolean);
  });
  const unique = [...new Set(labels)];
  return unique.length === 1 ? (unique[0] ?? null) : null;
}

export function hasInProgressSubscriptionBadge(root: ParentNode = document): boolean {
  return getRenderedSubscriptionStatusLabel(root) === 'In Progress';
}

export function findOrderDateAnchor(root: ParentNode = document): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('.o_form_view [name="date_order"]'),
  );
  return (
    candidates.find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    }) ??
    candidates[0] ??
    null
  );
}

export function findContractNumberAnchor(root: ParentNode = document): HTMLElement | null {
  const candidates = [
    ...root.querySelectorAll<HTMLElement>('.o_form_view h1 [name="client_order_ref"] span'),
    ...root.querySelectorAll<HTMLElement>('.o_form_view h1 [name="client_order_ref"]'),
    ...root.querySelectorAll<HTMLElement>('.o_form_view .o_form_sheet h1'),
  ];
  return (
    candidates.find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    }) ??
    candidates[0] ??
    null
  );
}
