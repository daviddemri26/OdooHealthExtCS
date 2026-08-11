import { browser } from 'wxt/browser';

import type { ExtensionSettings } from './types';

export const SETTINGS_STORAGE_KEY = 'odooHealthExtCsSettingsV3';
const LEGACY_SETTINGS_STORAGE_KEYS = [
  'odooHealthExtCsSettingsV2',
  'odooHealthExtCsSettingsV1',
] as const;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: 3,
  enabled: true,
  healthListPreview: false,
  features: {
    health: true,
    industry: true,
  },
  successToasts: {
    health: true,
    industry: true,
  },
  appearance: 'auto',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeSettings(value: unknown): ExtensionSettings {
  if (!isRecord(value)) return DEFAULT_SETTINGS;

  const features = isRecord(value.features) ? value.features : {};
  const successToasts = isRecord(value.successToasts) ? value.successToasts : {};

  return {
    schemaVersion: 3,
    enabled: booleanOrDefault(value.enabled, DEFAULT_SETTINGS.enabled),
    healthListPreview: booleanOrDefault(
      value.healthListPreview,
      DEFAULT_SETTINGS.healthListPreview,
    ),
    features: {
      health: booleanOrDefault(features.health, DEFAULT_SETTINGS.features.health),
      industry: booleanOrDefault(features.industry, DEFAULT_SETTINGS.features.industry),
    },
    successToasts: {
      health: booleanOrDefault(successToasts.health, DEFAULT_SETTINGS.successToasts.health),
      industry: booleanOrDefault(successToasts.industry, DEFAULT_SETTINGS.successToasts.industry),
    },
    appearance: ['auto', 'light', 'dark'].includes(String(value.appearance ?? ''))
      ? (value.appearance as ExtensionSettings['appearance'])
      : DEFAULT_SETTINGS.appearance,
  };
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.sync.get([
    SETTINGS_STORAGE_KEY,
    ...LEGACY_SETTINGS_STORAGE_KEYS,
  ]);
  const current = stored[SETTINGS_STORAGE_KEY];
  const legacy = LEGACY_SETTINGS_STORAGE_KEYS.map((key) => stored[key]).find(
    (value) => value !== undefined,
  );
  const settings = normalizeSettings(current ?? legacy);
  if (current === undefined && legacy !== undefined) {
    await browser.storage.sync.set({ [SETTINGS_STORAGE_KEY]: settings });
  }
  return settings;
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await browser.storage.sync.set({ [SETTINGS_STORAGE_KEY]: normalizeSettings(settings) });
}

export function subscribeToSettings(listener: (settings: ExtensionSettings) => void): () => void {
  const handler = (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    areaName: string,
  ): void => {
    if (areaName !== 'sync' || !changes[SETTINGS_STORAGE_KEY]) return;
    listener(normalizeSettings(changes[SETTINGS_STORAGE_KEY].newValue));
  };

  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}
