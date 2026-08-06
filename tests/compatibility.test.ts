import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: storage,
    },
  },
}));

import {
  COMPATIBILITY_STORAGE_KEY,
  getCompatibilityStatus,
  setCompatibilityStatus,
} from '../src/shared/compatibility';

describe('compatibility status storage', () => {
  beforeEach(() => {
    storage.get.mockReset();
    storage.set.mockReset().mockResolvedValue(undefined);
  });

  it('stores only the sanitized compatibility status', async () => {
    await setCompatibilityStatus(true, 'ready');

    expect(storage.set).toHaveBeenCalledOnce();
    expect(storage.set).toHaveBeenCalledWith({
      [COMPATIBILITY_STORAGE_KEY]: {
        ok: true,
        code: 'ready',
        checkedAt: expect.any(String),
      },
    });
  });

  it('returns a valid stored compatibility status', async () => {
    const value = {
      ok: false,
      code: 'session_expired',
      checkedAt: '2026-08-05T12:00:00.000Z',
    };
    storage.get.mockResolvedValue({ [COMPATIBILITY_STORAGE_KEY]: value });

    await expect(getCompatibilityStatus()).resolves.toEqual(value);
  });

  it.each([
    { ok: true, code: 'unexpected', checkedAt: '2026-08-05T12:00:00.000Z' },
    { ok: true, code: 'ready', checkedAt: 'not-a-date' },
    { ok: 'true', code: 'ready', checkedAt: '2026-08-05T12:00:00.000Z' },
  ])('rejects malformed stored values', async (value) => {
    storage.get.mockResolvedValue({ [COMPATIBILITY_STORAGE_KEY]: value });

    await expect(getCompatibilityStatus()).resolves.toBeNull();
  });
});
