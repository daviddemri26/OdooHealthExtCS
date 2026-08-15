import type {
  OdooDomain,
  OdooFieldDefinition,
  OdooGateway,
  OdooRecord,
} from '../../src/shared/types';
import type {
  CustomerDataBridgeOperation,
  CustomerDataMutationGateway,
  HealthMutationResult,
  IndustryMutationResult,
} from '../../src/odoo/customer-data-contracts';

export class MockGateway implements OdooGateway, CustomerDataMutationGateway {
  fields: Record<string, Record<string, OdooFieldDefinition>> = {};
  reads: Record<string, OdooRecord[]> = {};
  searches: Record<string, OdooRecord[]> = {};
  readCalls: Array<{ model: string; ids: number[]; fields: string[] }> = [];
  customerDataCalls: CustomerDataBridgeOperation[] = [];
  searchCalls: Array<{
    model: string;
    domain: OdooDomain;
    fields: string[];
    options: { limit?: number; order?: string };
  }> = [];
  healthMutationResult: HealthMutationResult | null = null;
  industryMutationResult: IndustryMutationResult | null = null;
  healthUndoResult = true;
  industryUndoResult = true;

  async read<T extends OdooRecord>(model: string, ids: number[], fields: string[]): Promise<T[]> {
    this.readCalls.push({ model, ids, fields });
    return (this.reads[model] ?? []) as T[];
  }

  async fieldsGet(
    model: string,
    requestedFields: string[],
  ): Promise<Record<string, OdooFieldDefinition>> {
    const definitions = this.fields[model] ?? {};
    return Object.fromEntries(
      requestedFields.flatMap((field) =>
        definitions[field] ? [[field, definitions[field] as OdooFieldDefinition]] : [],
      ),
    );
  }

  async searchRead<T extends OdooRecord>(
    model: string,
    domain: OdooDomain,
    fields: string[],
    options: { limit?: number; order?: string } = {},
  ): Promise<T[]> {
    this.searchCalls.push({ model, domain, fields, options });
    return (this.searches[model] ?? []) as T[];
  }

  async applyHealthState(
    sourceOrderId: number,
    nextState: 'high' | 'medium' | 'low' | null,
  ): Promise<HealthMutationResult> {
    this.customerDataCalls.push({ name: 'applyHealthState', sourceOrderId, nextState });
    if (this.healthMutationResult) return this.healthMutationResult;

    const healthIds = new Map(
      (this.searches['crm.tag'] ?? []).flatMap((record) =>
        typeof record.name === 'string' && Number.isSafeInteger(record.id) && record.id > 0
          ? [[record.name, record.id] as const]
          : [],
      ),
    );
    const canonical = [
      healthIds.get('Health - High'),
      healthIds.get('Health - Medium'),
      healthIds.get('Health - Low'),
    ].filter((value): value is number => value !== undefined);
    const order = (this.reads['sale.order'] ?? []).find((record) => record.id === sourceOrderId);
    const currentTagIds = Array.isArray(order?.tag_ids)
      ? order.tag_ids.filter((value): value is number => Number.isSafeInteger(value) && value > 0)
      : [];
    const nextId = nextState
      ? healthIds.get(`Health - ${nextState[0]?.toUpperCase()}${nextState.slice(1)}`)
      : undefined;
    return {
      sourceOrderId,
      beforeHealthTagIds: currentTagIds.filter((id) => canonical.includes(id)),
      appliedHealthTagIds: nextId ? [nextId] : [],
      state: nextState,
    };
  }

  async undoHealthState(
    sourceOrderId: number,
    expectedAppliedHealthTagIds: number[],
    restoreHealthTagIds: number[],
  ): Promise<{ restored: boolean }> {
    this.customerDataCalls.push({
      name: 'undoHealthState',
      sourceOrderId,
      expectedAppliedHealthTagIds: [...expectedAppliedHealthTagIds],
      restoreHealthTagIds: [...restoreHealthTagIds],
    });
    return { restored: this.healthUndoResult };
  }

  async applyIndustry(
    sourceOrderId: number,
    expectedPartnerId: number,
    nextIndustryId: number | null,
  ): Promise<IndustryMutationResult> {
    this.customerDataCalls.push({
      name: 'applyIndustry',
      sourceOrderId,
      expectedPartnerId,
      nextIndustryId,
    });
    if (this.industryMutationResult) return this.industryMutationResult;
    const partner = (this.reads['res.partner'] ?? []).find(
      (record) => record.id === expectedPartnerId,
    );
    const current = partner?.industry_id;
    return {
      sourceOrderId,
      partnerId: expectedPartnerId,
      beforeIndustryId:
        Array.isArray(current) && Number.isSafeInteger(current[0]) && Number(current[0]) > 0
          ? Number(current[0])
          : null,
      appliedIndustryId: nextIndustryId,
    };
  }

  async undoIndustry(
    sourceOrderId: number,
    expectedPartnerId: number,
    expectedAppliedIndustryId: number | null,
    restoreIndustryId: number | null,
  ): Promise<{ restored: boolean }> {
    this.customerDataCalls.push({
      name: 'undoIndustry',
      sourceOrderId,
      expectedPartnerId,
      expectedAppliedIndustryId,
      restoreIndustryId,
    });
    return { restored: this.industryUndoResult };
  }
}
