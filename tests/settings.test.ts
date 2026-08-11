import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings';

describe('extension settings', () => {
  it('enables success toasts and disables the list preview by default', () => {
    expect(DEFAULT_SETTINGS.successToasts).toEqual({ health: true, industry: true });
    expect(DEFAULT_SETTINGS.healthListPreview).toBe(false);
  });

  it('migrates legacy settings without changing existing feature preferences', () => {
    expect(
      normalizeSettings({
        schemaVersion: 1,
        enabled: true,
        features: { health: false, industry: true },
        appearance: 'dark',
      }),
    ).toEqual({
      schemaVersion: 3,
      enabled: true,
      healthListPreview: false,
      features: { health: false, industry: true },
      successToasts: { health: true, industry: true },
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
      schemaVersion: 3,
      enabled: true,
      healthListPreview: false,
      features: { health: true, industry: false },
      successToasts: { health: true, industry: true },
      appearance: 'dark',
    });
  });
});
