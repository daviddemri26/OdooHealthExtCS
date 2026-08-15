import {
  RENEWAL_YEARS,
  type BillingPeriodInput,
  type BillingPeriodUnit,
  type DiscountTenths,
  type NormalizedBillingPeriod,
  type RenewalCopyStep,
  type RenewalCreationPlan,
  type RenewalPlanFailure,
  type RenewalPlanResult,
  type RenewalQuoteKey,
  type RenewalSelection,
  type RenewalSelectionInput,
  type RenewalTargetPlan,
  type RenewalYears,
} from './types';

const MONTHS_PER_YEAR = 12;
const MAX_DISCOUNT_TENTHS = 1_000;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isBillingPeriodUnit(value: unknown): value is BillingPeriodUnit {
  return value === 'month' || value === 'year';
}

export function normalizeBillingPeriod(input: BillingPeriodInput): NormalizedBillingPeriod | null {
  if (!isPositiveSafeInteger(input.value) || !isBillingPeriodUnit(input.unit)) return null;

  const months = input.unit === 'year' ? input.value * MONTHS_PER_YEAR : input.value;
  if (!Number.isSafeInteger(months)) return null;

  return {
    value: input.value,
    unit: input.unit,
    months,
  };
}

export function isRenewalYears(value: unknown): value is RenewalYears {
  return typeof value === 'number' && RENEWAL_YEARS.includes(value as RenewalYears);
}

export const isRenewalYear = isRenewalYears;

export function getEligibleRenewalYears(currentMonths: unknown): readonly RenewalYears[] {
  if (!isPositiveSafeInteger(currentMonths)) return [];
  return RENEWAL_YEARS.filter((years) => years * MONTHS_PER_YEAR >= currentMonths);
}

export function allowedRenewalYears(currentMonths: unknown): readonly RenewalYears[] {
  return getEligibleRenewalYears(currentMonths);
}

export function formatContractDuration(currentMonths: unknown): string | null {
  if (!isPositiveSafeInteger(currentMonths)) return null;

  if (currentMonths % MONTHS_PER_YEAR === 0) {
    const years = currentMonths / MONTHS_PER_YEAR;
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }

  return `${currentMonths} ${currentMonths === 1 ? 'month' : 'months'}`;
}

export function normalizeDiscountTenths(value: unknown): DiscountTenths | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_DISCOUNT_TENTHS
  ) {
    return null;
  }

  return value as DiscountTenths;
}

function invalidSelection(
  code: RenewalPlanFailure['code'],
  selectionIndex?: number,
  years?: number,
): RenewalPlanFailure {
  return {
    ok: false,
    code,
    ...(selectionIndex === undefined ? {} : { selectionIndex }),
    ...(years === undefined ? {} : { years }),
  };
}

function normalizeSelections(
  selections: readonly RenewalSelectionInput[],
  eligibleYears: readonly RenewalYears[],
): RenewalSelection[] | RenewalPlanFailure {
  if (selections.length === 0) return invalidSelection('no-selection');

  const normalized: RenewalSelection[] = [];
  const seen = new Set<RenewalYears>();

  for (const [selectionIndex, selection] of selections.entries()) {
    if (!isRenewalYears(selection.years)) {
      return invalidSelection(
        'invalid-year',
        selectionIndex,
        typeof selection.years === 'number' ? selection.years : undefined,
      );
    }

    if (seen.has(selection.years)) {
      return invalidSelection('duplicate-year', selectionIndex, selection.years);
    }

    if (!eligibleYears.includes(selection.years)) {
      return invalidSelection('ineligible-year', selectionIndex, selection.years);
    }

    const discountTenths = normalizeDiscountTenths(selection.discountTenths);
    if (discountTenths === null) {
      return invalidSelection('invalid-discount', selectionIndex, selection.years);
    }

    seen.add(selection.years);
    normalized.push({ years: selection.years, discountTenths });
  }

  return normalized.sort((left, right) => left.years - right.years);
}

function targetQuoteKey(years: RenewalYears): RenewalQuoteKey {
  return `year-${years}`;
}

function createTargetCopy(
  sourceQuoteKey: 'native-renewal' | 'annual-normalization',
  years: RenewalYears,
): RenewalCopyStep {
  return {
    kind: 'copy-plan',
    sourceQuoteKey,
    quoteKey: targetQuoteKey(years),
    years,
    purpose: 'target',
  };
}

export function buildRenewalPlan(
  currentMonths: unknown,
  selections: readonly RenewalSelectionInput[],
): RenewalPlanResult {
  if (!isPositiveSafeInteger(currentMonths)) {
    return { ok: false, code: 'invalid-current-duration' };
  }

  const eligibleYears = getEligibleRenewalYears(currentMonths);
  const normalizedSelections = normalizeSelections(selections, eligibleYears);
  if (!Array.isArray(normalizedSelections)) return normalizedSelections;

  const needsAnnualNormalization = currentMonths < MONTHS_PER_YEAR;
  const baseQuoteKey = needsAnnualNormalization ? 'annual-normalization' : 'native-renewal';
  const baseDurationMonths = needsAnnualNormalization ? MONTHS_PER_YEAR : currentMonths;
  const normalizationCopy: RenewalCopyStep | null = needsAnnualNormalization
    ? {
        kind: 'copy-plan',
        sourceQuoteKey: 'native-renewal',
        quoteKey: 'annual-normalization',
        years: 1,
        purpose: 'annual-normalization',
      }
    : null;

  const targetCopies: RenewalCopyStep[] = [];
  const targets: RenewalTargetPlan[] = normalizedSelections.map((selection) => {
    const targetMonths = selection.years * MONTHS_PER_YEAR;

    if (targetMonths === baseDurationMonths) {
      return {
        ...selection,
        quoteKey: baseQuoteKey,
        creation: needsAnnualNormalization ? 'annual-normalization' : 'native-renewal',
      };
    }

    const copy = createTargetCopy(baseQuoteKey, selection.years);
    targetCopies.push(copy);
    return {
      ...selection,
      quoteKey: copy.quoteKey,
      creation: 'copy-from-base',
    };
  });

  const copySteps = normalizationCopy ? [normalizationCopy, ...targetCopies] : targetCopies;
  const totalQuoteCount = 1 + copySteps.length;

  const plan: RenewalCreationPlan = {
    currentMonths,
    eligibleYears,
    selectedYears: targets.map(({ years }) => years),
    baseQuoteKey,
    baseDurationMonths,
    normalizationCopy,
    targetCopies,
    copySteps,
    targets,
    totalQuoteCount,
    technicalQuoteCount: totalQuoteCount - targets.length,
  };

  return { ok: true, plan };
}
