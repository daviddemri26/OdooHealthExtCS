import { browser } from 'wxt/browser';

import type { CompatibilityCode, CompatibilityStatus } from './types';

export const COMPATIBILITY_STORAGE_KEY = 'odooHealthExtCsCompatibility';

export async function setCompatibilityStatus(ok: boolean, code: CompatibilityCode): Promise<void> {
  const status: CompatibilityStatus = {
    ok,
    code,
    checkedAt: new Date().toISOString(),
  };
  await browser.storage.local.set({ [COMPATIBILITY_STORAGE_KEY]: status });
}

export async function getCompatibilityStatus(): Promise<CompatibilityStatus | null> {
  const stored = await browser.storage.local.get(COMPATIBILITY_STORAGE_KEY);
  const value = stored[COMPATIBILITY_STORAGE_KEY];
  if (!value || typeof value !== 'object') return null;
  return value as CompatibilityStatus;
}
