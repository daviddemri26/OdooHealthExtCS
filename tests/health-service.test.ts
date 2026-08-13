import { describe, expect, it } from 'vitest';

import {
  applyHealthChange,
  getHealthSnapshot,
  loadHealthContext,
  loadSubscriptionListHealth,
  prepareHealthTagIds,
  resolveHealthTags,
  undoHealthChange,
  type HealthTagMap,
} from '../src/features/health/service';
import { MockGateway } from './helpers/mock-gateway';

const tags: HealthTagMap = { high: 11, medium: 12, low: 13 };

describe('account health service', () => {
  it('preserves unrelated tags and replaces every health tag', () => {
    expect(prepareHealthTagIds([7, 11, 13, 9], tags, 'medium')).toEqual([7, 9, 12]);
    expect(prepareHealthTagIds([7, 12, 9], tags, null)).toEqual([7, 9]);
  });

  it('detects a single state and duplicate health tags', () => {
    expect(getHealthSnapshot([7, 12], tags)).toMatchObject({ state: 'medium', duplicate: false });
    expect(getHealthSnapshot([11, 13], tags)).toMatchObject({ state: null, duplicate: true });
  });

  it('resolves exactly one record for each canonical tag', async () => {
    const gateway = new MockGateway();
    gateway.fields['sale.order'] = { tag_ids: { type: 'many2many', relation: 'crm.tag' } };
    gateway.searches['crm.tag'] = [
      { id: 11, name: 'Health - High' },
      { id: 12, name: 'Health - Medium' },
      { id: 13, name: 'Health - Low' },
    ];
    await expect(resolveHealthTags(gateway)).resolves.toEqual(tags);
  });

  it('disables writes when a canonical tag is missing or ambiguous', async () => {
    const gateway = new MockGateway();
    gateway.fields['sale.order'] = { tag_ids: { type: 'many2many', relation: 'crm.tag' } };
    gateway.searches['crm.tag'] = [
      { id: 11, name: 'Health - High' },
      { id: 14, name: 'Health - High' },
      { id: 12, name: 'Health - Medium' },
      { id: 13, name: 'Health - Low' },
    ];
    await expect(resolveHealthTags(gateway)).rejects.toMatchObject({
      code: 'missing_health_tags',
    });
  });

  it('loads the current state from a sanitized record', async () => {
    const gateway = new MockGateway();
    gateway.fields['sale.order'] = { tag_ids: { type: 'many2many', relation: 'crm.tag' } };
    gateway.searches['crm.tag'] = [
      { id: 11, name: 'Health - High' },
      { id: 12, name: 'Health - Medium' },
      { id: 13, name: 'Health - Low' },
    ];
    gateway.reads['sale.order'] = [{ id: 42, tag_ids: [5, 13] }];
    await expect(loadHealthContext(gateway, 42)).resolves.toMatchObject({
      snapshot: { state: 'low', tagIds: [5, 13] },
    });
    expect(gateway.readCalls).toEqual([{ model: 'sale.order', ids: [42], fields: ['tag_ids'] }]);
  });

  it('treats an empty form tag list as Not set', async () => {
    const gateway = new MockGateway();
    gateway.fields['sale.order'] = { tag_ids: { type: 'many2many', relation: 'crm.tag' } };
    gateway.searches['crm.tag'] = [
      { id: 11, name: 'Health - High' },
      { id: 12, name: 'Health - Medium' },
      { id: 13, name: 'Health - Low' },
    ];
    gateway.reads['sale.order'] = [{ id: 42, tag_ids: [] }];

    await expect(loadHealthContext(gateway, 42)).resolves.toEqual({
      tags,
      snapshot: { tagIds: [], state: null, duplicate: false },
    });
    expect(gateway.readCalls).toEqual([{ model: 'sale.order', ids: [42], fields: ['tag_ids'] }]);
  });

  it('maps visible subscriptions to list indicator states', async () => {
    const gateway = new MockGateway();
    gateway.searches['sale.order'] = [
      { id: 1, name: 'SO/1', tag_ids: [11] },
      { id: 2, name: 'SO/2', tag_ids: [] },
      { id: 3, name: 'SO/3', tag_ids: [11, 13] },
      { id: 4, name: 'SO/4', tag_ids: [12] },
      { id: 5, name: 'SO/4', tag_ids: [13] },
    ];

    await expect(
      loadSubscriptionListHealth(gateway, ['SO/1', 'SO/2', 'SO/3', 'SO/4', 'SO/5'], tags),
    ).resolves.toEqual(
      new Map([
        ['SO/1', 'high'],
        ['SO/2', 'not-set'],
        ['SO/3', 'ambiguous'],
        ['SO/4', 'ambiguous'],
        ['SO/5', 'ambiguous'],
      ]),
    );
  });

  it('reads visible subscription names in bounded batches', async () => {
    const gateway = new MockGateway();
    const names = Array.from({ length: 101 }, (_, index) => `SO/${index + 1}`);
    await loadSubscriptionListHealth(gateway, names, tags);

    expect(gateway.searchCalls).toHaveLength(2);
    expect(gateway.searchCalls[0]).toMatchObject({
      model: 'sale.order',
      fields: ['id', 'name', 'tag_ids'],
      options: { limit: 200 },
    });
    expect(gateway.searchCalls[1]).toMatchObject({ options: { limit: 2 } });
  });

  it('writes the complete safe tag set', async () => {
    const gateway = new MockGateway();
    const change = await applyHealthChange(gateway, 42, tags, [5, 11], 'medium');
    expect(change).toEqual({ before: [5, 11], applied: [5, 12], state: 'medium' });
    expect(gateway.writes[0]).toEqual({
      model: 'sale.order',
      ids: [42],
      values: { tag_ids: [[6, 0, [5, 12]]] },
    });
  });

  it('surfaces a failed health write without changing local truth', async () => {
    const gateway = new MockGateway();
    gateway.writeResult = false;
    await expect(applyHealthChange(gateway, 42, tags, [5, 11], 'medium')).rejects.toMatchObject({
      code: 'server_error',
    });
  });

  it('undoes only when no external tag change has occurred', async () => {
    const gateway = new MockGateway();
    const change = { before: [5, 11], applied: [5, 12], state: 'medium' as const };
    gateway.reads['sale.order'] = [{ id: 42, tag_ids: [12, 5] }];
    await expect(undoHealthChange(gateway, 42, change)).resolves.toBe(true);
    gateway.reads['sale.order'] = [{ id: 42, tag_ids: [5, 12, 99] }];
    await expect(undoHealthChange(gateway, 42, change)).resolves.toBe(false);
    expect(gateway.writes).toHaveLength(1);
  });
});
