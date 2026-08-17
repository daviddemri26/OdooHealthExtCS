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

export type RenewalQuoteRetention = 'selected' | 'intermediate';

export interface RenewalNativeRenewalStep {
  readonly kind: 'native-renewal';
  readonly quoteKey: 'native-renewal';
  readonly durationMonths: number;
  readonly retention: RenewalQuoteRetention;
}

export interface RenewalCopyStep {
  readonly kind: 'copy-plan';
  readonly sourceQuoteKey: 'native-renewal' | 'annual-normalization';
  readonly quoteKey: RenewalQuoteKey;
  readonly years: RenewalYears;
  readonly purpose: 'annual-normalization' | 'target';
  readonly retention: RenewalQuoteRetention;
}

export type RenewalCreationStep = RenewalNativeRenewalStep | RenewalCopyStep;

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
  nativeRenewal: RenewalNativeRenewalStep;
  normalizationCopy: RenewalCopyStep | null;
  targetCopies: readonly RenewalCopyStep[];
  copySteps: readonly RenewalCopyStep[];
  creationSteps: readonly RenewalCreationStep[];
  targets: readonly RenewalTargetPlan[];
  technicalQuoteKeys: readonly RenewalQuoteKey[];
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
