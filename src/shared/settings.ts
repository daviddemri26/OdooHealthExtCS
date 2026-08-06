import { browser } from 'wxt/browser';

import type { ExtensionSettings } from './types';

export const SETTINGS_STORAGE_KEY = 'odooHealthExtCsSettingsV2';
const LEGACY_SETTINGS_STORAGE_KEY = 'odooHealthExtCsSettingsV1';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: 2,
  enabled: true,
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

export function normalizeSettings(value: unknown): ExtensionSettings {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS;

  const candidate = value as Partial<ExtensionSettings>;
  const features = candidate.features ?? DEFAULT_SETTINGS.features;
  const successToasts = candidate.successToasts ?? DEFAULT_SETTINGS.successToasts;

  return {
    schemaVersion: 2,
    enabled: candidate.enabled ?? DEFAULT_SETTINGS.enabled,
    features: {
      health: features.health ?? DEFAULT_SETTINGS.features.health,
      industry: features.industry ?? DEFAULT_SETTINGS.features.industry,
    },
    successToasts: {
      health: successToasts.health ?? DEFAULT_SETTINGS.successToasts.health,
      industry: successToasts.industry ?? DEFAULT_SETTINGS.successToasts.industry,
    },
    appearance: ['auto', 'light', 'dark'].includes(candidate.appearance ?? '')
      ? (candidate.appearance as ExtensionSettings['appearance'])
      : DEFAULT_SETTINGS.appearance,
  };
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.sync.get([
    SETTINGS_STORAGE_KEY,
    LEGACY_SETTINGS_STORAGE_KEY,
  ]);
  const current = stored[SETTINGS_STORAGE_KEY];
  const settings = normalizeSettings(current ?? stored[LEGACY_SETTINGS_STORAGE_KEY]);
  if (current === undefined && stored[LEGACY_SETTINGS_STORAGE_KEY] !== undefined) {
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
