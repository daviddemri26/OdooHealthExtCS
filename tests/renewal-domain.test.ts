import { describe, expect, it } from 'vitest';

import {
  allowedRenewalYears,
  buildRenewalPlan,
  formatContractDuration,
  getEligibleRenewalYears,
  normalizeBillingPeriod,
  normalizeDiscountTenths,
} from '../src/features/renewals/domain';

describe('renewal duration domain', () => {
  it('normalizes supported month and year billing periods', () => {
    expect(normalizeBillingPeriod({ value: 13, unit: 'month' })).toEqual({
      value: 13,
      unit: 'month',
      months: 13,
    });
    expect(normalizeBillingPeriod({ value: 3, unit: 'year' })).toEqual({
      value: 3,
      unit: 'year',
      months: 36,
    });
  });

  it.each([
    { value: 0, unit: 'month' },
    { value: -1, unit: 'year' },
    { value: 1.5, unit: 'month' },
    { value: '1', unit: 'month' },
    { value: 1, unit: 'week' },
    { value: 1, unit: 'months' },
  ])('fails closed for an unsupported billing period: $value $unit', (input) => {
    expect(normalizeBillingPeriod(input)).toBeNull();
  });

  it.each([
    [1, [1, 2, 3, 4, 5]],
    [12, [1, 2, 3, 4, 5]],
    [13, [2, 3, 4, 5]],
    [24, [2, 3, 4, 5]],
    [36, [3, 4, 5]],
    [48, [4, 5]],
    [60, [5]],
    [61, []],
  ])('offers only terms at least as long as a %i-month contract', (months, expected) => {
    expect(getEligibleRenewalYears(months)).toEqual(expected);
  });

  it('returns no eligible terms for an invalid current duration', () => {
    expect(getEligibleRenewalYears(0)).toEqual([]);
    expect(getEligibleRenewalYears(12.5)).toEqual([]);
    expect(getEligibleRenewalYears('12')).toEqual([]);
  });

  it('exposes the allowed-years orchestration alias', () => {
    expect(allowedRenewalYears(36)).toEqual([3, 4, 5]);
  });

  it('formats exact yearly contracts as years and other contracts as months', () => {
    expect(formatContractDuration(1)).toBe('1 month');
    expect(formatContractDuration(12)).toBe('1 year');
    expect(formatContractDuration(13)).toBe('13 months');
    expect(formatContractDuration(36)).toBe('3 years');
    expect(formatContractDuration(0)).toBeNull();
  });
});

describe('renewal discount domain', () => {
  it.each([0, 1, 30, 65, 79, 1_000])('accepts %i tenths', (value) => {
    expect(normalizeDiscountTenths(value)).toBe(value);
  });

  it.each([-1, 1_001, 10.5, Number.NaN, '30'])('rejects invalid tenths: %s', (value) => {
    expect(normalizeDiscountTenths(value)).toBeNull();
  });
});

describe('renewal creation planner', () => {
  it('normalizes a monthly renewal through an annual base before target copies', () => {
    const result = buildRenewalPlan(1, [
      { years: 5, discountTenths: 100 },
      { years: 1, discountTenths: 0 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.baseQuoteKey).toBe('annual-normalization');
    expect(result.plan.selectedYears).toEqual([1, 5]);
    expect(result.plan.copySteps).toEqual([
      {
        kind: 'copy-plan',
        sourceQuoteKey: 'native-renewal',
        quoteKey: 'annual-normalization',
        years: 1,
        purpose: 'annual-normalization',
      },
      {
        kind: 'copy-plan',
        sourceQuoteKey: 'annual-normalization',
        quoteKey: 'year-5',
        years: 5,
        purpose: 'target',
      },
    ]);
    expect(result.plan.targets).toMatchObject([
      { years: 1, quoteKey: 'annual-normalization', creation: 'annual-normalization' },
      { years: 5, quoteKey: 'year-5', creation: 'copy-from-base' },
    ]);
    expect(result.plan.totalQuoteCount).toBe(3);
    expect(result.plan.technicalQuoteCount).toBe(1);
  });

  it('uses a yearly native renewal directly as the common base', () => {
    const result = buildRenewalPlan(12, [
      { years: 1, discountTenths: 0 },
      { years: 3, discountTenths: 60 },
      { years: 5, discountTenths: 100 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.baseQuoteKey).toBe('native-renewal');
    expect(result.plan.normalizationCopy).toBeNull();
    expect(result.plan.targets[0]).toMatchObject({
      years: 1,
      quoteKey: 'native-renewal',
      creation: 'native-renewal',
    });
    expect(result.plan.targetCopies.map(({ years }) => years)).toEqual([3, 5]);
    expect(result.plan.technicalQuoteCount).toBe(0);
  });

  it('never copies a multiyear source to a shorter annual base', () => {
    const result = buildRenewalPlan(36, [
      { years: 3, discountTenths: 60 },
      { years: 4, discountTenths: 80 },
      { years: 5, discountTenths: 100 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.baseQuoteKey).toBe('native-renewal');
    expect(result.plan.baseDurationMonths).toBe(36);
    expect(result.plan.normalizationCopy).toBeNull();
    expect(result.plan.targets[0]).toMatchObject({
      years: 3,
      quoteKey: 'native-renewal',
      creation: 'native-renewal',
    });
    expect(result.plan.copySteps.map(({ years }) => years)).toEqual([4, 5]);
  });

  it('keeps a nonstandard 13-month native renewal as a technical base', () => {
    const result = buildRenewalPlan(13, [
      { years: 2, discountTenths: 30 },
      { years: 5, discountTenths: 100 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.baseDurationMonths).toBe(13);
    expect(result.plan.copySteps.map(({ years }) => years)).toEqual([2, 5]);
    expect(result.plan.totalQuoteCount).toBe(3);
    expect(result.plan.technicalQuoteCount).toBe(1);
  });

  it('counts unselected native and annual-normalization quotes as technical', () => {
    const result = buildRenewalPlan(1, [{ years: 5, discountTenths: 100 }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.totalQuoteCount).toBe(3);
    expect(result.plan.technicalQuoteCount).toBe(2);
  });

  it.each([
    [0, [{ years: 1, discountTenths: 0 }], 'invalid-current-duration'],
    [12, [], 'no-selection'],
    [12, [{ years: 6, discountTenths: 0 }], 'invalid-year'],
    [24, [{ years: 1, discountTenths: 0 }], 'ineligible-year'],
    [12, [{ years: 1, discountTenths: -1 }], 'invalid-discount'],
    [
      12,
      [
        { years: 1, discountTenths: 0 },
        { years: 1, discountTenths: 0 },
      ],
      'duplicate-year',
    ],
  ])('rejects an invalid plan before creating steps', (months, selections, code) => {
    expect(buildRenewalPlan(months, selections)).toMatchObject({ ok: false, code });
  });
});
