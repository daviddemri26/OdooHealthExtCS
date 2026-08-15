import { getRenderedSubscriptionStatusLabel } from '../../odoo/routes';

const HEALTH_ELIGIBLE_STATUSES = new Set(['In Progress', 'Paused']);

export function isHealthEligibleSubscription(root: ParentNode = document): boolean {
  const status = getRenderedSubscriptionStatusLabel(root);
  return status !== null && HEALTH_ELIGIBLE_STATUSES.has(status);
}
