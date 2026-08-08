import { browser } from 'wxt/browser';

export const LIVE_CONNECTION_REQUEST = 'odoo-health-ext-cs:get-live-connection' as const;

export interface LiveConnectionRequest {
  type: typeof LIVE_CONNECTION_REQUEST;
}

export interface LiveConnectionIdentity {
  userDisplayName: string;
}

export function isLiveConnectionRequest(value: unknown): value is LiveConnectionRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as { type?: unknown }).type === LIVE_CONNECTION_REQUEST
  );
}

export function parseLiveConnectionIdentity(value: unknown): LiveConnectionIdentity | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1
  ) {
    return null;
  }
  const userDisplayName = (value as { userDisplayName?: unknown }).userDisplayName;
  if (
    typeof userDisplayName !== 'string' ||
    !userDisplayName.trim() ||
    userDisplayName.length > 120
  ) {
    return null;
  }
  return { userDisplayName };
}

export async function getActiveLiveConnectionIdentity(): Promise<LiveConnectionIdentity | null> {
  try {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (typeof activeTab?.id !== 'number') return null;
    const response: unknown = await browser.tabs.sendMessage(activeTab.id, {
      type: LIVE_CONNECTION_REQUEST,
    } satisfies LiveConnectionRequest);
    return parseLiveConnectionIdentity(response);
  } catch {
    return null;
  }
}
