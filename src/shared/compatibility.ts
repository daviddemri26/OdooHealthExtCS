import { browser } from 'wxt/browser';

import type { CompatibilityStatus, ConnectionCode } from './types';

export const COMPATIBILITY_STORAGE_KEY = 'odooHealthExtCsCompatibility';
const CONNECTION_CODES = new Set<ConnectionCode>([
  'ready',
  'bridge_unavailable',
  'timeout',
  'network',
  'session_expired',
  'access_denied',
  'incompatible_endpoint',
  'incompatible_response',
  'server_error',
]);

function parseCompatibilityStatus(value: unknown): CompatibilityStatus | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CompatibilityStatus>;
  if (
    typeof candidate.ok !== 'boolean' ||
    !candidate.code ||
    !CONNECTION_CODES.has(candidate.code) ||
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

export async function setCompatibilityStatus(ok: boolean, code: ConnectionCode): Promise<void> {
  const status: CompatibilityStatus = {
    ok,
    code,
    checkedAt: new Date().toISOString(),
  };
  await browser.storage.local.set({ [COMPATIBILITY_STORAGE_KEY]: status });
}

export async function getCompatibilityStatus(): Promise<CompatibilityStatus | null> {
  const stored = await browser.storage.local.get(COMPATIBILITY_STORAGE_KEY);
  return parseCompatibilityStatus(stored[COMPATIBILITY_STORAGE_KEY]);
}

export function subscribeToCompatibilityStatus(
  callback: (status: CompatibilityStatus | null) => void,
): () => void {
  const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
    changes,
    areaName,
  ) => {
    if (areaName !== 'local' || !changes[COMPATIBILITY_STORAGE_KEY]) return;
    callback(parseCompatibilityStatus(changes[COMPATIBILITY_STORAGE_KEY].newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
