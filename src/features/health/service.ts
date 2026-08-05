import type { HealthState, Many2OneValue, OdooGateway, OdooRecord } from '../../shared/types';
import { OdooGatewayError } from '../../odoo/gateway';

export const HEALTH_TAG_NAMES: Record<Exclude<HealthState, null>, string> = {
  high: 'Health - High',
  medium: 'Health - Medium',
  low: 'Health - Low',
};

interface SaleOrderRecord extends OdooRecord {
  tag_ids: number[];
  partner_id: Many2OneValue;
  subscription_state?: string | false;
}

interface TagRecord extends OdooRecord {
  name: string;
}

export interface HealthTagMap {
  high: number;
  medium: number;
  low: number;
}

export interface HealthSnapshot {
  tagIds: number[];
  state: HealthState;
  duplicate: boolean;
}

export interface HealthContext {
  tags: HealthTagMap;
  snapshot: HealthSnapshot;
}

export interface AppliedHealthChange {
  before: number[];
  applied: number[];
  state: HealthState;
}

export function sameIdSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

export function getHealthSnapshot(tagIds: number[], tags: HealthTagMap): HealthSnapshot {
  const entries = (Object.entries(tags) as [Exclude<HealthState, null>, number][]).filter(
    ([, id]) => tagIds.includes(id),
  );
  return {
    tagIds: [...tagIds],
    state: entries.length === 1 ? (entries[0]?.[0] ?? null) : null,
    duplicate: entries.length > 1,
  };
}

export function prepareHealthTagIds(
  currentIds: number[],
  tags: HealthTagMap,
  next: HealthState,
): number[] {
  const healthIds = new Set(Object.values(tags));
  const unrelated = currentIds.filter((id) => !healthIds.has(id));
  return next ? [...unrelated, tags[next]] : unrelated;
}

export async function resolveHealthTags(gateway: OdooGateway): Promise<HealthTagMap> {
  const fields = await gateway.fieldsGet('sale.order', ['tag_ids']);
  const definition = fields.tag_ids;
  if (definition?.type !== 'many2many' || !definition.relation) {
    throw new OdooGatewayError(
      'missing_fields',
      'The subscription health field is not available in this Odoo version.',
    );
  }

  const expectedNames = Object.values(HEALTH_TAG_NAMES);
  const records = await gateway.searchRead<TagRecord>(
    definition.relation,
    [['name', 'in', expectedNames]],
    ['id', 'name'],
    { limit: 20 },
  );

  const resolve = (state: Exclude<HealthState, null>): number => {
    const exact = records.filter(
      (record) =>
        typeof record.name === 'string' &&
        record.name.trim() === HEALTH_TAG_NAMES[state] &&
        Number.isSafeInteger(record.id) &&
        record.id > 0,
    );
    if (exact.length !== 1 || !exact[0]) {
      throw new OdooGatewayError(
        'missing_health_tags',
        'The three canonical health tags could not be identified safely.',
      );
    }
    return exact[0].id;
  };

  return { high: resolve('high'), medium: resolve('medium'), low: resolve('low') };
}

export async function loadHealthContext(
  gateway: OdooGateway,
  orderId: number,
): Promise<HealthContext> {
  const [tags, orders] = await Promise.all([
    resolveHealthTags(gateway),
    gateway.read<SaleOrderRecord>(
      'sale.order',
      [orderId],
      ['tag_ids', 'partner_id', 'subscription_state'],
    ),
  ]);
  const order = orders[0];
  if (
    !order ||
    !Array.isArray(order.tag_ids) ||
    !order.tag_ids.every((id) => Number.isSafeInteger(id) && id > 0)
  ) {
    throw new OdooGatewayError(
      'incompatible_response',
      'The subscription record could not be read safely.',
    );
  }
  return { tags, snapshot: getHealthSnapshot(order.tag_ids, tags) };
}

export async function applyHealthChange(
  gateway: OdooGateway,
  orderId: number,
  tags: HealthTagMap,
  currentIds: number[],
  next: HealthState,
): Promise<AppliedHealthChange> {
  const applied = prepareHealthTagIds(currentIds, tags, next);
  const success = await gateway.write('sale.order', [orderId], {
    tag_ids: [[6, 0, applied]],
  });
  if (!success) throw new OdooGatewayError('server_error', 'Odoo did not save the health change.');
  return { before: [...currentIds], applied, state: next };
}

export async function undoHealthChange(
  gateway: OdooGateway,
  orderId: number,
  change: AppliedHealthChange,
): Promise<boolean> {
  const records = await gateway.read<SaleOrderRecord>('sale.order', [orderId], ['tag_ids']);
  const current = records[0]?.tag_ids;
  if (!Array.isArray(current) || !sameIdSet(current, change.applied)) return false;
  return gateway.write('sale.order', [orderId], {
    tag_ids: [[6, 0, change.before]],
  });
}
