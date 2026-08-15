export const RENEWAL_YEARS = [1, 2, 3, 4, 5] as const;

export type RenewalYears = (typeof RENEWAL_YEARS)[number];

export type RenewalYear = RenewalYears;

export type BillingPeriodUnit = 'month' | 'year';

export interface BillingPeriodInput {
  value: unknown;
  unit: unknown;
}

export interface NormalizedBillingPeriod {
  value: number;
  unit: BillingPeriodUnit;
  months: number;
}

export type RenewalDuration = NormalizedBillingPeriod;

declare const discountTenthsBrand: unique symbol;

export type DiscountTenths = number & {
  readonly [discountTenthsBrand]: 'DiscountTenths';
};

export interface RenewalSelectionInput {
  years: unknown;
  discountTenths: unknown;
}

export interface RenewalSelection {
  years: RenewalYears;
  discountTenths: DiscountTenths;
}

export type RenewalQuoteKey = 'native-renewal' | 'annual-normalization' | `year-${RenewalYears}`;

export interface RenewalCopyStep {
  kind: 'copy-plan';
  sourceQuoteKey: 'native-renewal' | 'annual-normalization';
  quoteKey: RenewalQuoteKey;
  years: RenewalYears;
  purpose: 'annual-normalization' | 'target';
}

export interface RenewalTargetPlan extends RenewalSelection {
  quoteKey: RenewalQuoteKey;
  creation: 'native-renewal' | 'annual-normalization' | 'copy-from-base';
}

export interface RenewalCreationPlan {
  currentMonths: number;
  eligibleYears: readonly RenewalYears[];
  selectedYears: readonly RenewalYears[];
  baseQuoteKey: 'native-renewal' | 'annual-normalization';
  baseDurationMonths: number;
  normalizationCopy: RenewalCopyStep | null;
  targetCopies: readonly RenewalCopyStep[];
  copySteps: readonly RenewalCopyStep[];
  targets: readonly RenewalTargetPlan[];
  totalQuoteCount: number;
  technicalQuoteCount: number;
}

export type RenewalPlanFailureCode =
  | 'invalid-current-duration'
  | 'no-selection'
  | 'invalid-year'
  | 'duplicate-year'
  | 'ineligible-year'
  | 'invalid-discount';

export interface RenewalPlanFailure {
  ok: false;
  code: RenewalPlanFailureCode;
  selectionIndex?: number;
  years?: number;
}

export interface RenewalPlanSuccess {
  ok: true;
  plan: RenewalCreationPlan;
}

export type RenewalPlanResult = RenewalPlanSuccess | RenewalPlanFailure;

export interface RenewalQuoteResult {
  years: RenewalYears;
  discountTenths: DiscountTenths;
  quoteId: number;
  quoteName: string;
  url: string;
}

export type RenewalTargetPhase =
  'queued' | 'creating' | 'applying-discount' | 'generating-link' | 'ready' | 'failed' | 'unknown';

export interface RenewalTargetState extends RenewalSelection {
  phase: RenewalTargetPhase;
  result?: RenewalQuoteResult;
}

export type RenewalRunPhase = 'idle' | 'preflight' | 'running' | 'success' | 'partial' | 'unknown';

export interface RenewalRunState {
  phase: RenewalRunPhase;
  sourceOrderId: number | null;
  targets: readonly RenewalTargetState[];
  completedCount: number;
  errorMessage?: string;
}
