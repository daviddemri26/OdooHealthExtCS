import type { HealthState, OdooGateway } from '../shared/types';

export type CustomerDataSubscriptionState = '3_progress' | '4_paused';
export const CUSTOMER_DATA_GATEWAY_TIMEOUT_MS = 45_000;
export const CUSTOMER_DATA_RPC_TIMEOUT_MS = 12_000;

export interface HealthMutationResult {
  sourceOrderId: number;
  beforeHealthTagIds: number[];
  appliedHealthTagIds: number[];
  state: HealthState;
}

export interface CustomerDataUndoResult {
  restored: boolean;
}

export interface IndustryMutationResult {
  sourceOrderId: number;
  partnerId: number;
  beforeIndustryId: number | null;
  appliedIndustryId: number | null;
}

export type CustomerDataBridgeOperation =
  | {
      name: 'applyHealthState';
      sourceOrderId: number;
      nextState: HealthState;
    }
  | {
      name: 'undoHealthState';
      sourceOrderId: number;
      expectedAppliedHealthTagIds: number[];
      restoreHealthTagIds: number[];
    }
  | {
      name: 'applyIndustry';
      sourceOrderId: number;
      expectedPartnerId: number;
      nextIndustryId: number | null;
    }
  | {
      name: 'undoIndustry';
      sourceOrderId: number;
      expectedPartnerId: number;
      expectedAppliedIndustryId: number | null;
      restoreIndustryId: number | null;
    };

export interface CustomerDataMutationGateway {
  applyHealthState(sourceOrderId: number, nextState: HealthState): Promise<HealthMutationResult>;
  undoHealthState(
    sourceOrderId: number,
    expectedAppliedHealthTagIds: number[],
    restoreHealthTagIds: number[],
  ): Promise<CustomerDataUndoResult>;
  applyIndustry(
    sourceOrderId: number,
    expectedPartnerId: number,
    nextIndustryId: number | null,
  ): Promise<IndustryMutationResult>;
  undoIndustry(
    sourceOrderId: number,
    expectedPartnerId: number,
    expectedAppliedIndustryId: number | null,
    restoreIndustryId: number | null,
  ): Promise<CustomerDataUndoResult>;
}

export type CustomerDataGateway = OdooGateway & CustomerDataMutationGateway;
