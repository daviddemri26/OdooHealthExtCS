import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: storage,
      onChanged: {
        addListener: storage.addListener,
        removeListener: storage.removeListener,
      },
    },
  },
}));

import {
  COMPATIBILITY_STORAGE_KEY,
  getCompatibilityStatus,
  setCompatibilityStatus,
  subscribeToCompatibilityStatus,
} from '../src/shared/compatibility';

describe('compatibility status storage', () => {
  beforeEach(() => {
    storage.get.mockReset();
    storage.set.mockReset().mockResolvedValue(undefined);
    storage.addListener.mockReset();
    storage.removeListener.mockReset();
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
    { ok: false, code: 'missing_fields', checkedAt: '2026-08-05T12:00:00.000Z' },
  ])('rejects malformed stored values', async (value) => {
    storage.get.mockResolvedValue({ [COMPATIBILITY_STORAGE_KEY]: value });

    await expect(getCompatibilityStatus()).resolves.toBeNull();
  });

  it('publishes sanitized connection-status changes and can unsubscribe', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToCompatibilityStatus(callback);
    const listener = storage.addListener.mock.calls[0]?.[0] as (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => void;

    listener(
      {
        [COMPATIBILITY_STORAGE_KEY]: {
          newValue: {
            ok: true,
            code: 'ready',
            checkedAt: '2026-08-05T12:00:00.000Z',
          },
        },
      },
      'local',
    );
    expect(callback).toHaveBeenCalledWith({
      ok: true,
      code: 'ready',
      checkedAt: '2026-08-05T12:00:00.000Z',
    });

    unsubscribe();
    expect(storage.removeListener).toHaveBeenCalledWith(listener);
  });
});
