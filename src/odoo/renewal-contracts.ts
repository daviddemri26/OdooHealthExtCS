export type RenewalTargetYears = 1 | 2 | 3 | 4 | 5;

export const RENEWAL_RUNTIME_TIMEOUT_MS = 45_000;
export const RENEWAL_RECONCILIATION_DELAY_MS = 1_500;
export const RENEWAL_RECONCILIATION_TIMEOUT_MS = 10_000;
export const RENEWAL_RECONCILIATION_POLL_INTERVAL_MS = 750;
export const RENEWAL_GATEWAY_SAFETY_MARGIN_MS = 15_000;
export const RENEWAL_GATEWAY_TIMEOUT_MS = 75_000;
export const RENEWAL_END_TO_END_TIMEOUT_BUDGET_MS =
  RENEWAL_RUNTIME_TIMEOUT_MS + RENEWAL_RECONCILIATION_DELAY_MS + RENEWAL_RECONCILIATION_TIMEOUT_MS;

export type RenewalBillingUnit = 'month' | 'year';

export interface RenewalSourceFingerprint {
  planId: number;
  currentContractMonths: number;
  writeDate: string;
}

export interface RenewalPreflightResult extends RenewalSourceFingerprint {
  eligible: true;
  sourceOrderId: number;
  renewalQuoteCount: number;
  billingPeriodValue: number;
  billingPeriodUnit: RenewalBillingUnit;
  allowedTargetYears: RenewalTargetYears[];
}

export interface RenewalIneligiblePreflightResult {
  eligible: false;
  sourceOrderId: number;
  reason: 'not-in-progress';
}

export type RenewalPreflightResponse = RenewalPreflightResult | RenewalIneligiblePreflightResult;

export interface RenewalCreatedQuoteResult {
  quoteId: number;
  reconciledAfterTimeout?: true;
  reconciledAfterValidationFailure?: true;
}

export interface RenewalDiscountClearResult {
  removedLineCount: number;
}

export interface RenewalDiscountApplyResult {
  createdLineCount: number;
}

export interface RenewalShareLinkResult {
  quoteId: number;
  shareLink: string;
}

export interface RenewalQuoteSummary {
  quoteId: number;
  createdFromQuoteId: number;
  name: string;
  state: string;
  subscriptionState: string | null;
  planId: number;
  billingPeriodValue: number;
  billingPeriodUnit: RenewalBillingUnit;
  currentContractMonths: number;
  templateId: number | null;
  currencyId: number;
  currencyRounding: number;
  amountUntaxed: number;
  amountTax: number;
  amountTotal: number;
  lineCount: number;
  multiYearDiscountLineCount: number;
  lines: RenewalQuoteLineSummary[];
}

export interface RenewalQuoteLineSummary {
  lineId: number;
  productId: number | null;
  sequence: number;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  total: number;
  taxIds: number[];
  isMultiYearDiscount: boolean;
}

export type RenewalBridgeOperation =
  | {
      name: 'preflightRenewal';
      sourceOrderId: number;
    }
  | {
      name: 'createNativeRenewal';
      sourceOrderId: number;
      runId: string;
      expected: RenewalSourceFingerprint;
      requiredCopyYears: RenewalTargetYears[];
      requiresDiscount: boolean;
    }
  | {
      name: 'copyNativePlan';
      sourceQuoteId: number;
      years: RenewalTargetYears;
      runId: string;
    }
  | {
      name: 'clearNativeMultiYearDiscount';
      quoteId: number;
      runId: string;
    }
  | {
      name: 'applyNativeGlobalDiscount';
      quoteId: number;
      percentageTenths: number;
      runId: string;
    }
  | {
      name: 'getNativeShareLink';
      quoteId: number;
      runId: string;
    }
  | {
      name: 'readRenewalQuoteSummary';
      quoteId: number;
      runId: string;
    }
  | {
      name: 'finishRenewalRun';
      runId: string;
    };

export interface RenewalGateway {
  preflightRenewal(sourceOrderId: number): Promise<RenewalPreflightResponse>;
  createNativeRenewal(
    sourceOrderId: number,
    runId: string,
    expected: RenewalSourceFingerprint,
    requiredCopyYears: RenewalTargetYears[],
    requiresDiscount: boolean,
  ): Promise<RenewalCreatedQuoteResult>;
  copyNativePlan(
    sourceQuoteId: number,
    years: RenewalTargetYears,
    runId: string,
  ): Promise<RenewalCreatedQuoteResult>;
  clearNativeMultiYearDiscount(quoteId: number, runId: string): Promise<RenewalDiscountClearResult>;
  applyNativeGlobalDiscount(
    quoteId: number,
    percentageTenths: number,
    runId: string,
  ): Promise<RenewalDiscountApplyResult>;
  getNativeShareLink(quoteId: number, runId: string): Promise<RenewalShareLinkResult>;
  readRenewalQuoteSummary(quoteId: number, runId: string): Promise<RenewalQuoteSummary>;
  finishRenewalRun(runId: string): Promise<void>;
}
