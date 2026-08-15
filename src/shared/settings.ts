import { browser } from 'wxt/browser';

import type {
  AppearancePreference,
  ExtensionSettings,
  RenewalDiscountTenthsByYears,
  RenewalYear,
} from './types';

export const SETTINGS_STORAGE_KEY = 'odooHealthExtCsSettingsV4';
const LEGACY_SETTINGS_STORAGE_KEYS = [
  'odooHealthExtCsSettingsV3',
  'odooHealthExtCsSettingsV2',
  'odooHealthExtCsSettingsV1',
] as const;

const SETTINGS_FIELD_STORAGE_KEYS = {
  enabled: `${SETTINGS_STORAGE_KEY}:enabled`,
  healthListPreview: `${SETTINGS_STORAGE_KEY}:healthListPreview`,
  features: {
    health: `${SETTINGS_STORAGE_KEY}:features.health`,
    industry: `${SETTINGS_STORAGE_KEY}:features.industry`,
    renewals: `${SETTINGS_STORAGE_KEY}:features.renewals`,
  },
  successToasts: {
    health: `${SETTINGS_STORAGE_KEY}:successToasts.health`,
    industry: `${SETTINGS_STORAGE_KEY}:successToasts.industry`,
    renewals: `${SETTINGS_STORAGE_KEY}:successToasts.renewals`,
  },
  renewalDiscounts: {
    1: `${SETTINGS_STORAGE_KEY}:renewalDefaults.discountTenthsByYears.1`,
    2: `${SETTINGS_STORAGE_KEY}:renewalDefaults.discountTenthsByYears.2`,
    3: `${SETTINGS_STORAGE_KEY}:renewalDefaults.discountTenthsByYears.3`,
    4: `${SETTINGS_STORAGE_KEY}:renewalDefaults.discountTenthsByYears.4`,
    5: `${SETTINGS_STORAGE_KEY}:renewalDefaults.discountTenthsByYears.5`,
  },
  appearance: `${SETTINGS_STORAGE_KEY}:appearance`,
} as const;

const SETTINGS_FIELD_KEYS = [
  SETTINGS_FIELD_STORAGE_KEYS.enabled,
  SETTINGS_FIELD_STORAGE_KEYS.healthListPreview,
  ...Object.values(SETTINGS_FIELD_STORAGE_KEYS.features),
  ...Object.values(SETTINGS_FIELD_STORAGE_KEYS.successToasts),
  ...Object.values(SETTINGS_FIELD_STORAGE_KEYS.renewalDiscounts),
  SETTINGS_FIELD_STORAGE_KEYS.appearance,
] as const;

const ALL_SETTINGS_STORAGE_KEYS = [
  SETTINGS_STORAGE_KEY,
  ...LEGACY_SETTINGS_STORAGE_KEYS,
  ...SETTINGS_FIELD_KEYS,
] as const;

export const RENEWAL_YEARS: readonly RenewalYear[] = [1, 2, 3, 4, 5];

const DEFAULT_RENEWAL_DISCOUNTS: RenewalDiscountTenthsByYears = {
  1: 0,
  2: 30,
  3: 60,
  4: 80,
  5: 100,
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: 4,
  enabled: true,
  healthListPreview: false,
  features: {
    health: true,
    industry: true,
    renewals: false,
  },
  successToasts: {
    health: true,
    industry: true,
    renewals: true,
  },
  renewalDefaults: {
    discountTenthsByYears: DEFAULT_RENEWAL_DISCOUNTS,
  },
  appearance: 'auto',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function discountTenthsOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1_000 &&
    value % 5 === 0
    ? value
    : fallback;
}

function normalizeRenewalDiscounts(value: unknown): RenewalDiscountTenthsByYears {
  const discounts = isRecord(value) ? value : {};

  return Object.fromEntries(
    RENEWAL_YEARS.map((year) => [
      year,
      year === 1
        ? DEFAULT_RENEWAL_DISCOUNTS[1]
        : discountTenthsOrDefault(discounts[year], DEFAULT_RENEWAL_DISCOUNTS[year]),
    ]),
  ) as RenewalDiscountTenthsByYears;
}

function hasStoredNonZeroOneYearDiscount(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const renewalDefaults = isRecord(value.renewalDefaults) ? value.renewalDefaults : null;
  const discounts =
    renewalDefaults && isRecord(renewalDefaults.discountTenthsByYears)
      ? renewalDefaults.discountTenthsByYears
      : null;
  return Boolean(discounts && '1' in discounts && discounts[1] !== 0);
}

function storedValueOrFallback(
  stored: Record<string, unknown>,
  key: string,
  fallback: unknown,
): unknown {
  return stored[key] === undefined ? fallback : stored[key];
}

function applyStoredFieldOverrides(
  base: ExtensionSettings,
  stored: Record<string, unknown>,
): ExtensionSettings {
  return normalizeSettings({
    ...base,
    enabled: storedValueOrFallback(stored, SETTINGS_FIELD_STORAGE_KEYS.enabled, base.enabled),
    healthListPreview: storedValueOrFallback(
      stored,
      SETTINGS_FIELD_STORAGE_KEYS.healthListPreview,
      base.healthListPreview,
    ),
    features: {
      health: storedValueOrFallback(
        stored,
        SETTINGS_FIELD_STORAGE_KEYS.features.health,
        base.features.health,
      ),
      industry: storedValueOrFallback(
        stored,
        SETTINGS_FIELD_STORAGE_KEYS.features.industry,
        base.features.industry,
      ),
      renewals: storedValueOrFallback(
        stored,
        SETTINGS_FIELD_STORAGE_KEYS.features.renewals,
        base.features.renewals,
      ),
    },
    successToasts: {
      health: storedValueOrFallback(
        stored,
        SETTINGS_FIELD_STORAGE_KEYS.successToasts.health,
        base.successToasts.health,
      ),
      industry: storedValueOrFallback(
        stored,
        SETTINGS_FIELD_STORAGE_KEYS.successToasts.industry,
        base.successToasts.industry,
      ),
      renewals: storedValueOrFallback(
        stored,
        SETTINGS_FIELD_STORAGE_KEYS.successToasts.renewals,
        base.successToasts.renewals,
      ),
    },
    renewalDefaults: {
      discountTenthsByYears: Object.fromEntries(
        RENEWAL_YEARS.map((year) => [
          year,
          storedValueOrFallback(
            stored,
            SETTINGS_FIELD_STORAGE_KEYS.renewalDiscounts[year],
            base.renewalDefaults.discountTenthsByYears[year],
          ),
        ]),
      ),
    },
    appearance: storedValueOrFallback(
      stored,
      SETTINGS_FIELD_STORAGE_KEYS.appearance,
      base.appearance,
    ),
  });
}

export interface ExtensionSettingsPatch {
  enabled?: boolean;
  healthListPreview?: boolean;
  features?: Partial<ExtensionSettings['features']>;
  successToasts?: Partial<ExtensionSettings['successToasts']>;
  renewalDefaults?: {
    discountTenthsByYears?: Partial<Record<RenewalYear, number>>;
  };
  appearance?: AppearancePreference;
}

export function mergeSettingsPatch(
  current: ExtensionSettings,
  patch: ExtensionSettingsPatch,
): ExtensionSettings {
  return normalizeSettings({
    ...current,
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    ...(patch.healthListPreview === undefined
      ? {}
      : { healthListPreview: patch.healthListPreview }),
    ...(patch.appearance === undefined ? {} : { appearance: patch.appearance }),
    features: {
      ...current.features,
      ...patch.features,
    },
    successToasts: {
      ...current.successToasts,
      ...patch.successToasts,
    },
    renewalDefaults: {
      ...current.renewalDefaults,
      ...patch.renewalDefaults,
      discountTenthsByYears: {
        ...current.renewalDefaults.discountTenthsByYears,
        ...patch.renewalDefaults?.discountTenthsByYears,
      },
    },
  });
}

export function normalizeSettings(value: unknown): ExtensionSettings {
  if (!isRecord(value)) return DEFAULT_SETTINGS;

  const features = isRecord(value.features) ? value.features : {};
  const successToasts = isRecord(value.successToasts) ? value.successToasts : {};
  const renewalDefaults = isRecord(value.renewalDefaults) ? value.renewalDefaults : {};

  return {
    schemaVersion: 4,
    enabled: booleanOrDefault(value.enabled, DEFAULT_SETTINGS.enabled),
    healthListPreview: booleanOrDefault(
      value.healthListPreview,
      DEFAULT_SETTINGS.healthListPreview,
    ),
    features: {
      health: booleanOrDefault(features.health, DEFAULT_SETTINGS.features.health),
      industry: booleanOrDefault(features.industry, DEFAULT_SETTINGS.features.industry),
      renewals: booleanOrDefault(features.renewals, DEFAULT_SETTINGS.features.renewals),
    },
    successToasts: {
      health: booleanOrDefault(successToasts.health, DEFAULT_SETTINGS.successToasts.health),
      industry: booleanOrDefault(successToasts.industry, DEFAULT_SETTINGS.successToasts.industry),
      renewals: booleanOrDefault(successToasts.renewals, DEFAULT_SETTINGS.successToasts.renewals),
    },
    renewalDefaults: {
      discountTenthsByYears: normalizeRenewalDiscounts(renewalDefaults.discountTenthsByYears),
    },
    appearance: ['auto', 'light', 'dark'].includes(String(value.appearance ?? ''))
      ? (value.appearance as ExtensionSettings['appearance'])
      : DEFAULT_SETTINGS.appearance,
  };
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.sync.get([...ALL_SETTINGS_STORAGE_KEYS]);
  const current = stored[SETTINGS_STORAGE_KEY];
  const legacy = LEGACY_SETTINGS_STORAGE_KEYS.map((key) => stored[key]).find(
    (value) => value !== undefined,
  );
  const base = normalizeSettings(current ?? legacy);
  const settings = applyStoredFieldOverrides(base, stored);
  const repairs: Record<string, unknown> = {};
  if ((current === undefined && legacy !== undefined) || hasStoredNonZeroOneYearDiscount(current)) {
    repairs[SETTINGS_STORAGE_KEY] = base;
  }
  const oneYearOverrideKey = SETTINGS_FIELD_STORAGE_KEYS.renewalDiscounts[1];
  if (stored[oneYearOverrideKey] !== undefined && stored[oneYearOverrideKey] !== 0) {
    repairs[oneYearOverrideKey] = 0;
  }
  if (Object.keys(repairs).length > 0) await browser.storage.sync.set(repairs);
  return settings;
}

function getFieldStoragePatch(
  patch: ExtensionSettingsPatch,
  next: ExtensionSettings,
): Record<string, unknown> {
  const storedPatch: Record<string, unknown> = {};
  if (patch.enabled !== undefined) {
    storedPatch[SETTINGS_FIELD_STORAGE_KEYS.enabled] = next.enabled;
  }
  if (patch.healthListPreview !== undefined) {
    storedPatch[SETTINGS_FIELD_STORAGE_KEYS.healthListPreview] = next.healthListPreview;
  }
  for (const feature of ['health', 'industry', 'renewals'] as const) {
    if (patch.features?.[feature] !== undefined) {
      storedPatch[SETTINGS_FIELD_STORAGE_KEYS.features[feature]] = next.features[feature];
    }
    if (patch.successToasts?.[feature] !== undefined) {
      storedPatch[SETTINGS_FIELD_STORAGE_KEYS.successToasts[feature]] = next.successToasts[feature];
    }
  }
  for (const year of RENEWAL_YEARS) {
    if (patch.renewalDefaults?.discountTenthsByYears?.[year] !== undefined) {
      storedPatch[SETTINGS_FIELD_STORAGE_KEYS.renewalDiscounts[year]] =
        next.renewalDefaults.discountTenthsByYears[year];
    }
  }
  if (patch.appearance !== undefined) {
    storedPatch[SETTINGS_FIELD_STORAGE_KEYS.appearance] = next.appearance;
  }
  return storedPatch;
}

let settingsPatchQueue: Promise<void> = Promise.resolve();

/**
 * Applies a field-scoped settings change after every earlier change has settled. The latest
 * stored value is re-read inside the queue. Each leaf is stored under its own sync key so
 * isolated extension contexts cannot overwrite unrelated preferences with stale full objects.
 */
export function patchSettings(patch: ExtensionSettingsPatch): Promise<ExtensionSettings> {
  const operation = settingsPatchQueue.then(async () => {
    const current = await getSettings();
    const next = mergeSettingsPatch(current, patch);
    const storedPatch = getFieldStoragePatch(patch, next);
    if (Object.keys(storedPatch).length > 0) await browser.storage.sync.set(storedPatch);
    return next;
  });

  settingsPatchQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export function subscribeToSettings(listener: (settings: ExtensionSettings) => void): () => void {
  let active = true;
  const handler = (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    areaName: string,
  ): void => {
    if (
      areaName !== 'sync' ||
      !ALL_SETTINGS_STORAGE_KEYS.some((key) => changes[key] !== undefined)
    ) {
      return;
    }
    void getSettings()
      .then((settings) => {
        if (active) listener(settings);
      })
      .catch(() => undefined);
  };

  browser.storage.onChanged.addListener(handler);
  return () => {
    active = false;
    browser.storage.onChanged.removeListener(handler);
  };
}
