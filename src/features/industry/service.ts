import { OdooGatewayError } from '../../odoo/gateway';
import type { CustomerDataGateway } from '../../odoo/customer-data-contracts';
import type { Many2OneValue, OdooGateway, OdooRecord } from '../../shared/types';

interface SaleOrderPartnerRecord extends OdooRecord {
  partner_id: Many2OneValue;
}

interface PartnerRecord extends OdooRecord {
  industry_id: Many2OneValue;
}

export interface IndustryOption {
  id: number;
  name: string;
}

export interface IndustryContext {
  partnerId: number;
  partnerName: string;
  currentIndustryId: number | null;
  industries: IndustryOption[];
}

export interface AppliedIndustryChange {
  sourceOrderId: number;
  partnerId: number;
  before: number | null;
  applied: number | null;
}

export async function loadIndustryContext(
  gateway: OdooGateway,
  orderId: number,
): Promise<IndustryContext> {
  const fields = await gateway.fieldsGet('res.partner', ['industry_id']);
  if (
    fields.industry_id?.type !== 'many2one' ||
    fields.industry_id.relation !== 'res.partner.industry'
  ) {
    throw new OdooGatewayError(
      'missing_fields',
      'The customer industry field is not available in this Odoo version.',
    );
  }

  const orders = await gateway.read<SaleOrderPartnerRecord>(
    'sale.order',
    [orderId],
    ['partner_id'],
  );
  const partner = orders[0]?.partner_id;
  if (
    !Array.isArray(partner) ||
    !Number.isSafeInteger(partner[0]) ||
    partner[0] === 0 ||
    typeof partner[1] !== 'string'
  ) {
    throw new OdooGatewayError(
      'incompatible_response',
      'The linked customer could not be identified safely.',
    );
  }

  const [partnerRecords, industries] = await Promise.all([
    gateway.read<PartnerRecord>('res.partner', [partner[0]], ['industry_id']),
    gateway.searchRead<IndustryOption & OdooRecord>('res.partner.industry', [], ['id', 'name'], {
      limit: 500,
      order: 'name asc',
    }),
  ]);

  const industryValue = partnerRecords[0]?.industry_id;
  if (
    industryValue !== false &&
    (!Array.isArray(industryValue) ||
      !Number.isSafeInteger(industryValue[0]) ||
      industryValue[0] <= 0)
  ) {
    throw new OdooGatewayError(
      'incompatible_response',
      'The customer industry could not be read safely.',
    );
  }
  return {
    partnerId: partner[0],
    partnerName: partner[1],
    currentIndustryId: Array.isArray(industryValue) ? industryValue[0] : null,
    industries: industries
      .filter(
        (industry) =>
          Number.isSafeInteger(industry.id) && industry.id > 0 && typeof industry.name === 'string',
      )
      .map(({ id, name }) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function applyIndustryChange(
  gateway: CustomerDataGateway,
  sourceOrderId: number,
  context: IndustryContext,
  nextIndustryId: number | null,
): Promise<AppliedIndustryChange> {
  const result = await gateway.applyIndustry(sourceOrderId, context.partnerId, nextIndustryId);
  return {
    sourceOrderId: result.sourceOrderId,
    partnerId: result.partnerId,
    before: result.beforeIndustryId,
    applied: result.appliedIndustryId,
  };
}

export async function undoIndustryChange(
  gateway: CustomerDataGateway,
  change: AppliedIndustryChange,
): Promise<boolean> {
  const result = await gateway.undoIndustry(
    change.sourceOrderId,
    change.partnerId,
    change.applied,
    change.before,
  );
  return result.restored;
}
