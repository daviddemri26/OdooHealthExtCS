import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings';

describe('extension settings', () => {
  it('enables both success toasts by default', () => {
    expect(DEFAULT_SETTINGS.successToasts).toEqual({ health: true, industry: true });
  });

  it('migrates version 1 settings without changing existing feature preferences', () => {
    expect(
      normalizeSettings({
        schemaVersion: 1,
        enabled: true,
        features: { health: false, industry: true },
        appearance: 'dark',
      }),
    ).toEqual({
      schemaVersion: 2,
      enabled: true,
      features: { health: false, industry: true },
      successToasts: { health: true, industry: true },
      appearance: 'dark',
    });
  });
});
