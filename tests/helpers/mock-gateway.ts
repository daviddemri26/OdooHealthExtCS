import type {
  OdooDomain,
  OdooFieldDefinition,
  OdooGateway,
  OdooRecord,
  OdooValues,
} from '../../src/shared/types';

export class MockGateway implements OdooGateway {
  fields: Record<string, Record<string, OdooFieldDefinition>> = {};
  reads: Record<string, OdooRecord[]> = {};
  searches: Record<string, OdooRecord[]> = {};
  writes: { model: string; ids: number[]; values: OdooValues }[] = [];
  searchCalls: Array<{
    model: string;
    domain: OdooDomain;
    fields: string[];
    options: { limit?: number; order?: string };
  }> = [];
  writeResult = true;

  async read<T extends OdooRecord>(model: string): Promise<T[]> {
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

  async write(model: string, ids: number[], values: OdooValues): Promise<boolean> {
    this.writes.push({ model, ids, values });
    return this.writeResult;
  }
}
