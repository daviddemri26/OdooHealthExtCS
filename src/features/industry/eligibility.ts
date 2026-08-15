import { getRenderedSubscriptionStatusLabel } from '../../odoo/routes';

const INDUSTRY_ELIGIBLE_STATUSES = new Set(['In Progress', 'Paused']);

export function isIndustryEligibleSubscription(root: ParentNode = document): boolean {
  const status = getRenderedSubscriptionStatusLabel(root);
  return status !== null && INDUSTRY_ELIGIBLE_STATUSES.has(status);
}
