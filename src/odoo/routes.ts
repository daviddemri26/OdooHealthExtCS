import type { SubscriptionRoute } from '../shared/types';

const ODOO_HOST = 'www.odoo.com';
const ODOO_PATH_PREFIX = '/odoo';

interface RouteCandidate {
  model: string;
  recordId: number;
}

export function isAllowedOdooLocation(location: Pick<Location, 'hostname' | 'pathname'>): boolean {
  return location.hostname === ODOO_HOST && location.pathname.startsWith(ODOO_PATH_PREFIX);
}

export function parseSubscriptionRoute(
  location: Pick<Location, 'hostname' | 'pathname'>,
): SubscriptionRoute | null {
  if (!isAllowedOdooLocation(location)) return null;

  const segments = location.pathname.split('/').filter(Boolean);
  const candidates: RouteCandidate[] = [];

  for (let index = 1; index < segments.length - 1; index += 1) {
    const token = segments[index];
    const recordId = Number(segments[index + 1]);
    if (!token || !Number.isSafeInteger(recordId) || recordId <= 0) continue;

    if (token === 'subscriptions') {
      candidates.push({ model: 'sale.order', recordId });
    } else if (token.includes('.')) {
      candidates.push({ model: token, recordId });
    }
  }

  const active = candidates.at(-1);
  if (!active || active.model !== 'sale.order') return null;

  return {
    model: 'sale.order',
    recordId: active.recordId,
    pathname: location.pathname,
  };
}

export function isRenderedSubscriptionForm(pathname: string, root: ParentNode = document): boolean {
  if (!root.querySelector('.o_form_view')) return false;
  if (!root.querySelector('[name="partner_id"]')) return false;
  return (
    pathname.includes('/subscriptions/') ||
    Boolean(root.querySelector('[name="subscription_state"]'))
  );
}

export function findOrderDateAnchor(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>('.o_form_view [name="date_order"]');
}
