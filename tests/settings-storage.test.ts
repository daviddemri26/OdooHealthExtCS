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
      sync: {
        get: storage.get,
        set: storage.set,
      },
      onChanged: {
        addListener: storage.addListener,
        removeListener: storage.removeListener,
      },
    },
  },
}));

import {
  DEFAULT_SETTINGS,
  getSettings,
  patchSettings,
  SETTINGS_STORAGE_KEY,
  subscribeToSettings,
} from '../src/shared/settings';

describe('settings storage patches', () => {
  beforeEach(() => {
    storage.get.mockReset();
    storage.set.mockReset();
    storage.addListener.mockReset();
    storage.removeListener.mockReset();
  });

  it('repairs a previously stored non-zero one-year discount during hydration', async () => {
    const stale = structuredClone(DEFAULT_SETTINGS);
    stale.renewalDefaults.discountTenthsByYears[1] = 50;
    storage.get.mockResolvedValue({ [SETTINGS_STORAGE_KEY]: stale });
    storage.set.mockResolvedValue(undefined);

    const hydrated = await getSettings();

    expect(hydrated.renewalDefaults.discountTenthsByYears[1]).toBe(0);
    expect(storage.set).toHaveBeenCalledWith({
      [SETTINGS_STORAGE_KEY]: hydrated,
    });
  });

  it('serializes writes and re-reads the latest stored settings before each patch', async () => {
    const stored: Record<string, unknown> = {
      [SETTINGS_STORAGE_KEY]: structuredClone(DEFAULT_SETTINGS),
    };
    let releaseFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });

    storage.get.mockImplementation(() => Promise.resolve(structuredClone(stored)));
    storage.set.mockImplementationOnce(async (value: Record<string, unknown>) => {
      await firstWrite;
      Object.assign(stored, structuredClone(value));
    });
    storage.set.mockImplementation(async (value: Record<string, unknown>) => {
      Object.assign(stored, structuredClone(value));
    });

    const healthPatch = patchSettings({ features: { health: false } });
    const industryPatch = patchSettings({ features: { industry: false } });

    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    expect(storage.get).toHaveBeenCalledTimes(1);

    stored[SETTINGS_STORAGE_KEY] = {
      ...DEFAULT_SETTINGS,
      appearance: 'light',
    };
    releaseFirstWrite();
    const [, latest] = await Promise.all([healthPatch, industryPatch]);

    expect(latest.features).toEqual({ health: false, industry: false, renewals: false });
    expect(latest.appearance).toBe('light');
    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  it('rehydrates the complete settings view when a field key changes externally', async () => {
    const stored: Record<string, unknown> = {
      [SETTINGS_STORAGE_KEY]: structuredClone(DEFAULT_SETTINGS),
    };
    let storageListener!: (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      areaName: string,
    ) => void;
    storage.get.mockImplementation(() => Promise.resolve(structuredClone(stored)));
    storage.set.mockImplementation(async (value: Record<string, unknown>) => {
      Object.assign(stored, structuredClone(value));
    });
    storage.addListener.mockImplementation((listener) => {
      storageListener = listener;
    });
    const listener = vi.fn();
    const unsubscribe = subscribeToSettings(listener);

    await patchSettings({ appearance: 'light' });
    const storedPatch = storage.set.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    storageListener(
      Object.fromEntries(Object.entries(storedPatch).map(([key, newValue]) => [key, { newValue }])),
      'sync',
    );

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ appearance: 'light' }));
    unsubscribe();
    expect(storage.removeListener).toHaveBeenCalledWith(storageListener);
  });

  it('preserves independent fields written concurrently by separate extension contexts', async () => {
    const firstContextPatch = patchSettings;
    vi.resetModules();
    const secondContext = await import('../src/shared/settings');
    const stored: Record<string, unknown> = {
      [SETTINGS_STORAGE_KEY]: structuredClone(DEFAULT_SETTINGS),
    };
    let releaseReads!: () => void;
    const simultaneousReads = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    let readCount = 0;

    storage.get.mockImplementation(async () => {
      const snapshot = structuredClone(stored);
      readCount += 1;
      if (readCount <= 2) await simultaneousReads;
      return snapshot;
    });
    storage.set.mockImplementation(async (value: Record<string, unknown>) => {
      Object.assign(stored, structuredClone(value));
    });

    const healthPatch = firstContextPatch({ features: { health: false } });
    const industryPatch = secondContext.patchSettings({ features: { industry: false } });
    await vi.waitFor(() => expect(storage.get).toHaveBeenCalledTimes(2));
    releaseReads();
    await Promise.all([healthPatch, industryPatch]);

    const hydrated = await getSettings();
    expect(hydrated.features).toEqual({ health: false, industry: false, renewals: false });
    expect(
      storage.set.mock.calls.every((call) => {
        const value = call[0] as Record<string, unknown>;
        return value[SETTINGS_STORAGE_KEY] === undefined;
      }),
    ).toBe(true);
  });
});
