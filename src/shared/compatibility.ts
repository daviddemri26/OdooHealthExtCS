import { browser } from 'wxt/browser';

import type { CompatibilityCode, CompatibilityStatus } from './types';

export const COMPATIBILITY_STORAGE_KEY = 'odooHealthExtCsCompatibility';
const COMPATIBILITY_CODES = new Set<CompatibilityCode>([
  'ready',
  'bridge_unavailable',
  'timeout',
  'network',
  'session_expired',
  'access_denied',
  'incompatible_endpoint',
  'missing_health_tags',
  'missing_fields',
  'incompatible_response',
  'server_error',
]);

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
  const candidate = value as Partial<CompatibilityStatus>;
  if (
    typeof candidate.ok !== 'boolean' ||
    !candidate.code ||
    !COMPATIBILITY_CODES.has(candidate.code) ||
    typeof candidate.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.checkedAt))
  ) {
    return null;
  }
  return {
    ok: candidate.ok,
    code: candidate.code,
    checkedAt: candidate.checkedAt,
  };
}
