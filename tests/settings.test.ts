import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, mergeSettingsPatch, normalizeSettings } from '../src/shared/settings';

describe('extension settings', () => {
  it('adds disabled renewals and Share Links with safe defaults', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(5);
    expect(DEFAULT_SETTINGS.features).toEqual({
      health: true,
      industry: true,
      renewals: false,
      shareLinks: false,
    });
    expect(DEFAULT_SETTINGS.successToasts).toEqual({
      health: true,
      industry: true,
      renewals: true,
      shareLinks: true,
    });
    expect(DEFAULT_SETTINGS.shareLinkTargets).toEqual({
      renewalQuotations: true,
      salesQuotations: true,
    });
    expect(DEFAULT_SETTINGS.renewalDefaults.discountTenthsByYears).toEqual({
      1: 0,
      2: 30,
      3: 60,
      4: 80,
      5: 100,
    });
    expect(DEFAULT_SETTINGS.healthListPreview).toBe(false);
  });

  it('migrates V3 settings without changing existing preferences', () => {
    expect(
      normalizeSettings({
        schemaVersion: 3,
        enabled: false,
        healthListPreview: true,
        features: { health: false, industry: true },
        successToasts: { health: false, industry: true },
        appearance: 'dark',
      }),
    ).toEqual({
      schemaVersion: 5,
      enabled: false,
      healthListPreview: true,
      features: { health: false, industry: true, renewals: false, shareLinks: false },
      successToasts: { health: false, industry: true, renewals: true, shareLinks: true },
      shareLinkTargets: { renewalQuotations: true, salesQuotations: true },
      renewalDefaults: {
        discountTenthsByYears: { 1: 0, 2: 30, 3: 60, 4: 80, 5: 100 },
      },
      appearance: 'dark',
    });
  });

  it('falls back safely when stored settings contain invalid runtime values', () => {
    expect(
      normalizeSettings({
        schemaVersion: 2,
        enabled: 'yes',
        healthListPreview: 'yes',
        features: { health: 1, industry: false },
        successToasts: { health: null, industry: true },
        appearance: 'dark',
      }),
    ).toEqual({
      schemaVersion: 5,
      enabled: true,
      healthListPreview: false,
      features: { health: true, industry: false, renewals: false, shareLinks: false },
      successToasts: { health: true, industry: true, renewals: true, shareLinks: true },
      shareLinkTargets: { renewalQuotations: true, salesQuotations: true },
      renewalDefaults: {
        discountTenthsByYears: { 1: 0, 2: 30, 3: 60, 4: 80, 5: 100 },
      },
      appearance: 'dark',
    });
  });

  it('normalizes every renewal preference independently', () => {
    expect(
      normalizeSettings({
        schemaVersion: 4,
        features: { renewals: true },
        successToasts: { renewals: false },
        renewalDefaults: {
          discountTenthsByYears: {
            1: 15,
            2: -1,
            3: 65.5,
            4: 1_000,
            5: 79,
          },
        },
      }),
    ).toMatchObject({
      features: { renewals: true },
      successToasts: { renewals: false },
      renewalDefaults: {
        discountTenthsByYears: { 1: 0, 2: 30, 3: 60, 4: 1_000, 5: 100 },
      },
    });
  });

  it('keeps the hidden one-year renewal default at zero when applying a patch', () => {
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      renewalDefaults: {
        discountTenthsByYears: { 1: 50, 2: 30, 3: 60, 4: 80, 5: 100 },
      },
    });

    expect(
      mergeSettingsPatch(current, {
        renewalDefaults: { discountTenthsByYears: { 1: 100, 3: 65 } },
      }).renewalDefaults.discountTenthsByYears,
    ).toEqual({ 1: 0, 2: 30, 3: 65, 4: 80, 5: 100 });
  });
});
