import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      query: mocks.query,
      sendMessage: mocks.sendMessage,
    },
  },
}));

import {
  getActiveLiveConnectionIdentity,
  isLiveConnectionRequest,
  LIVE_CONNECTION_REQUEST,
  parseLiveConnectionIdentity,
} from '../src/shared/live-connection';

describe('live Odoo connection identity', () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue([{ id: 42 }]);
    mocks.sendMessage.mockReset().mockResolvedValue({ userDisplayName: 'Demo User' });
  });

  it('accepts only the exact snapshot request and sanitized response shape', () => {
    expect(isLiveConnectionRequest({ type: LIVE_CONNECTION_REQUEST })).toBe(true);
    expect(isLiveConnectionRequest({ type: LIVE_CONNECTION_REQUEST, extra: true })).toBe(false);
    expect(parseLiveConnectionIdentity({ userDisplayName: 'Demo User' })).toEqual({
      userDisplayName: 'Demo User',
    });
    expect(parseLiveConnectionIdentity({ userDisplayName: '' })).toBeNull();
    expect(parseLiveConnectionIdentity({ userDisplayName: 'Demo', id: 17 })).toBeNull();
  });

  it('requests the identity only from the active tab and keeps failures local', async () => {
    await expect(getActiveLiveConnectionIdentity()).resolves.toEqual({
      userDisplayName: 'Demo User',
    });
    expect(mocks.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(mocks.sendMessage).toHaveBeenCalledWith(42, { type: LIVE_CONNECTION_REQUEST });

    mocks.sendMessage.mockRejectedValueOnce(new Error('No matching Odoo content script'));
    await expect(getActiveLiveConnectionIdentity()).resolves.toBeNull();
  });
});
