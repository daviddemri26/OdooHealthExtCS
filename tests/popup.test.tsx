import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
  subscribeToSettings: vi.fn(),
  getCompatibilityStatus: vi.fn(),
  subscribeToCompatibilityStatus: vi.fn(),
  getActiveLiveConnectionIdentity: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      getManifest: () => ({ version: '1.0.0' }),
    },
  },
}));

vi.mock('../src/shared/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/settings')>();
  return {
    ...actual,
    getSettings: mocks.getSettings,
    patchSettings: mocks.patchSettings,
    subscribeToSettings: mocks.subscribeToSettings,
  };
});

vi.mock('../src/shared/compatibility', () => ({
  getCompatibilityStatus: mocks.getCompatibilityStatus,
  subscribeToCompatibilityStatus: mocks.subscribeToCompatibilityStatus,
}));

vi.mock('../src/shared/live-connection', () => ({
  getActiveLiveConnectionIdentity: mocks.getActiveLiveConnectionIdentity,
}));

import { Popup } from '../entrypoints/popup/Popup';
import { mergeSettingsPatch, type ExtensionSettingsPatch } from '../src/shared/settings';

const popupStyles = readFileSync(resolve('entrypoints/popup/style.css'), 'utf8');

const settings = {
  schemaVersion: 4 as const,
  enabled: true,
  healthListPreview: true,
  features: { health: true, industry: true, renewals: false },
  successToasts: { health: true, industry: true, renewals: true },
  renewalDefaults: {
    discountTenthsByYears: { 1: 0, 2: 30, 3: 60, 4: 80, 5: 100 },
  },
  appearance: 'dark' as const,
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('settings popup', () => {
  let storedSettings = settings;
  let settingsListener: ((nextSettings: typeof settings) => void) | null = null;

  beforeEach(() => {
    storedSettings = structuredClone(settings);
    settingsListener = null;
    mocks.getSettings.mockReset().mockImplementation(() => Promise.resolve(storedSettings));
    mocks.patchSettings.mockReset().mockImplementation((patch: ExtensionSettingsPatch) => {
      storedSettings = mergeSettingsPatch(storedSettings, patch) as typeof settings;
      return Promise.resolve(storedSettings);
    });
    mocks.subscribeToSettings.mockReset().mockImplementation((listener) => {
      settingsListener = listener;
      return vi.fn();
    });
    mocks.getCompatibilityStatus
      .mockReset()
      .mockResolvedValue({ ok: true, code: 'ready', checkedAt: new Date().toISOString() });
    mocks.subscribeToCompatibilityStatus.mockReset().mockReturnValue(vi.fn());
    mocks.getActiveLiveConnectionIdentity
      .mockReset()
      .mockResolvedValue({ userDisplayName: 'Demo User' });
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps every popup control inert until settings hydration completes', async () => {
    const pendingSettings = deferred<typeof settings>();
    mocks.getSettings.mockReturnValue(pendingSettings.promise);
    const view = render(<Popup />);

    const popup = view.container.querySelector('main')!;
    const masterSwitch = screen.getByRole('checkbox', { name: 'Enable extension' });
    expect(popup).toHaveAttribute('aria-busy', 'true');
    expect(popup).toHaveAttribute('inert');
    expect(masterSwitch).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connection' })).toBeDisabled();

    fireEvent.click(masterSwitch);
    expect(mocks.patchSettings).not.toHaveBeenCalled();

    pendingSettings.resolve(settings);
    await waitFor(() => expect(popup).toHaveAttribute('aria-busy', 'false'));
    expect(popup).not.toHaveAttribute('inert');
    expect(masterSwitch).toBeEnabled();
  });

  it('reconciles settings changes received from another extension context', async () => {
    render(<Popup />);
    await screen.findByText('Connected and ready');
    const listener = settingsListener;
    expect(listener).not.toBeNull();

    act(() => {
      listener?.({
        ...settings,
        enabled: false,
        features: { ...settings.features, industry: false },
      });
    });

    expect(screen.getByRole('checkbox', { name: 'Enable extension' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Industry Paused/ })).toBeInTheDocument();
  });

  it('settles concurrent field patches even when their promises finish in reverse order', async () => {
    const firstSave = deferred<typeof settings>();
    const secondSave = deferred<typeof settings>();
    mocks.patchSettings
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);

    render(<Popup />);
    await screen.findByText('Connected and ready');
    fireEvent.click(screen.getByRole('button', { name: /Account Health Enabled/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Account Health' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show health in subscription lists' }));

    expect(screen.getByText('Saving…')).toBeInTheDocument();
    storedSettings = mergeSettingsPatch(storedSettings, {
      features: { health: false },
      healthListPreview: false,
    }) as typeof settings;
    secondSave.resolve(storedSettings);
    await act(async () => Promise.resolve());
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    firstSave.resolve(storedSettings);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enable Account Health' })).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Show health in subscription lists' }),
    ).not.toBeChecked();
  });

  it('lists features directly and opens each dedicated page', async () => {
    render(<Popup />);

    expect(await screen.findByText('Connected and ready')).toBeInTheDocument();
    expect(screen.queryByText('Choose how the control panel looks.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connection' })).toBeInTheDocument();
    const settingsNavigation = screen.getByRole('button', { name: 'Settings' });
    const healthNavigation = screen.getByRole('button', { name: /Account Health Enabled/ });
    const industryNavigation = screen.getByRole('button', { name: /Industry Enabled/ });
    expect(screen.getByRole('button', { name: /Renewals Disabled/ })).toBeInTheDocument();

    fireEvent.click(settingsNavigation);
    expect(screen.getByRole('article', { name: 'Appearance settings' })).toBeInTheDocument();
    expect(screen.getByText('Visit OdooHealthExtCS')).toBeInTheDocument();
    expect(screen.getByText('Version')).toBeInTheDocument();
    expect(screen.queryByText('Odoo connection')).not.toBeInTheDocument();

    fireEvent.click(healthNavigation);
    expect(screen.getByText(/Account Health is a shortcut/)).toBeInTheDocument();
    expect(screen.queryByText(/Every change updates/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enable Account Health' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Show health in subscription lists' }),
    ).toBeChecked();
    const listPreviewCard = screen.getByRole('region', {
      name: 'Subscription list health preview settings',
    });
    const featureOptions = screen.getByRole('region', { name: 'Account Health settings' });
    const saveExplanation = screen.getByRole('region', { name: 'How changes are saved' });
    expect(
      featureOptions.compareDocumentPosition(listPreviewCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      listPreviewCard.compareDocumentPosition(saveExplanation) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Saved directly in Odoo' })).toBeInTheDocument();
    expect(screen.getByText(/native Tags field may not visually refresh/)).toBeInTheDocument();

    fireEvent.click(industryNavigation);
    expect(screen.getByText(/Industry is a shortcut/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enable Industry' })).toBeChecked();
    expect(screen.getByText(/native customer form may not visually refresh/)).toBeInTheDocument();
    expect(
      screen.queryByText('Feature preferences on this page are saved automatically.'),
    ).not.toBeInTheDocument();
  });

  it('configures renewal defaults on a dedicated auto-saved feature page', async () => {
    render(<Popup />);
    await screen.findByText('Connected and ready');
    fireEvent.click(screen.getByRole('button', { name: /Renewals Disabled/ }));

    expect(
      screen.getByText(/Create several renewal quotations without leaving the subscription\./),
    ).toBeInTheDocument();
    const enableRenewals = screen.getByRole('checkbox', {
      name: 'Enable Multi-year Renewals',
    });
    const successConfirmation = screen.getByRole('checkbox', {
      name: 'Show success confirmation',
    });
    expect(enableRenewals).not.toBeChecked();
    expect(successConfirmation).toBeDisabled();

    expect(screen.queryByRole('spinbutton', { name: '1-year discount' })).not.toBeInTheDocument();
    for (const [year, percentage] of [
      [2, 3],
      [3, 6],
      [4, 8],
      [5, 10],
    ] as const) {
      const input = screen.getByRole('spinbutton', {
        name: `${year}-year discount`,
      });
      expect(input).toBeEnabled();
      expect(input).toHaveValue(percentage);
      expect(input).toHaveAttribute('min', '0');
      expect(input).toHaveAttribute('max', '100');
      expect(input).toHaveAttribute('step', '0.5');
    }

    expect(screen.getByText(/These percentages prefill 2- to 5-year renewals/)).toBeInTheDocument();
    expect(screen.getByText(/1-year default remains 0%/)).toBeInTheDocument();
    expect(screen.queryByText(/Quotation links may grant access/)).not.toBeInTheDocument();

    fireEvent.click(enableRenewals);
    expect(successConfirmation).toBeEnabled();
    const threeYearDiscount = screen.getByRole('spinbutton', {
      name: '3-year discount',
    });
    fireEvent.change(threeYearDiscount, { target: { value: '6.5' } });
    fireEvent.click(successConfirmation);

    await waitFor(() =>
      expect(mocks.patchSettings).toHaveBeenLastCalledWith({
        successToasts: { renewals: false },
      }),
    );
    expect(mocks.patchSettings).toHaveBeenCalledWith({ features: { renewals: true } });
    expect(mocks.patchSettings).toHaveBeenCalledWith({
      renewalDefaults: { discountTenthsByYears: { 3: 65 } },
    });

    const saveCount = mocks.patchSettings.mock.calls.length;
    fireEvent.change(threeYearDiscount, { target: { value: '' } });
    expect(threeYearDiscount).toHaveValue(null);
    await Promise.resolve();
    expect(mocks.patchSettings).toHaveBeenCalledTimes(saveCount);

    fireEvent.blur(threeYearDiscount);
    expect(threeYearDiscount).toHaveValue(6.5);
    expect(mocks.patchSettings).toHaveBeenCalledTimes(saveCount);

    fireEvent.change(threeYearDiscount, { target: { value: '7.9' } });
    fireEvent.blur(threeYearDiscount);
    expect(threeYearDiscount).toHaveValue(6.5);
    expect(mocks.patchSettings).toHaveBeenCalledTimes(saveCount);

    fireEvent.change(threeYearDiscount, { target: { value: '7.49' } });
    fireEvent.blur(threeYearDiscount);
    expect(threeYearDiscount).toHaveValue(6.5);
    expect(mocks.patchSettings).toHaveBeenCalledTimes(saveCount);
  });

  it('shows the current Odoo connection without repeating privacy details', async () => {
    render(<Popup />);

    expect(await screen.findByText('Connected and ready')).toBeInTheDocument();
    expect(
      screen.getByText(/connected to the authenticated Odoo session currently open/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Current Odoo login')).not.toBeInTheDocument();
    expect(screen.getByText('Last checked')).toBeInTheDocument();
    expect(await screen.findByText('Connected user')).toBeInTheDocument();
    expect(screen.getByText('Demo User')).toBeInTheDocument();
    expect(screen.getByText(/connected user's name is shown only here/i)).toBeInTheDocument();
    expect(screen.getByText(/does not request or store passwords/)).toBeInTheDocument();
    expect(
      screen.queryByText('The official extension version currently installed.'),
    ).not.toBeInTheDocument();
  });

  it('uses only general session states in the connection panel', async () => {
    mocks.getCompatibilityStatus.mockResolvedValue(null);
    render(<Popup />);

    expect(await screen.findByText('Connection not checked')).toBeInTheDocument();
    expect(screen.getByText(/Open any Odoo workspace page/)).toBeInTheDocument();
    expect(screen.queryByText(/health tags/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/customer industry/i)).not.toBeInTheDocument();
  });

  it('shows a specific recovery action when the Odoo session has expired', async () => {
    mocks.getCompatibilityStatus.mockResolvedValue({
      ok: false,
      code: 'session_expired',
      checkedAt: '2026-08-08T20:00:00.000Z',
    });

    render(<Popup />);

    expect(await screen.findByText('Odoo session expired')).toBeInTheDocument();
    expect(screen.getByText('How to fix it')).toBeInTheDocument();
    expect(screen.getByText(/Sign back in to www.odoo.com/)).toBeInTheDocument();
  });

  it('saves a feature preference without changing the settings schema', async () => {
    render(<Popup />);
    await screen.findByText('Connected and ready');
    fireEvent.click(screen.getByRole('button', { name: /Account Health Enabled/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Account Health' }));

    await waitFor(() =>
      expect(mocks.patchSettings).toHaveBeenCalledWith({ features: { health: false } }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Saved').closest('.save-state')).toHaveClass('save-state-saved');
  });

  it('saves the subscription list preview independently from the form shortcut', async () => {
    render(<Popup />);
    await screen.findByText('Connected and ready');
    fireEvent.click(screen.getByRole('button', { name: /Account Health Enabled/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Account Health' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show health in subscription lists' }));

    await waitFor(() =>
      expect(mocks.patchSettings).toHaveBeenLastCalledWith({ healthListPreview: false }),
    );
  });

  it('keeps Account Health enabled in navigation when only the list preview is active', async () => {
    mocks.getSettings.mockResolvedValue({
      ...settings,
      features: { ...settings.features, health: false },
    });
    render(<Popup />);

    expect(
      await screen.findByRole('button', { name: /Account Health Enabled/ }),
    ).toBeInTheDocument();
  });

  it('keeps feature pages visible but disables their controls when the extension is paused', async () => {
    render(<Popup />);
    await screen.findByText('Connected and ready');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable extension' }));
    fireEvent.click(screen.getByRole('button', { name: /Industry Paused/ }));

    expect(screen.getByRole('checkbox', { name: 'Enable Industry' })).toBeDisabled();
    expect(screen.getByText(/Enable the extension from the top-right switch/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Account Health Paused/ }));
    expect(screen.getByRole('checkbox', { name: 'Enable Account Health' })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'Show health in subscription lists' }),
    ).toBeDisabled();
  });

  it('supports arrow-key navigation in the left menu', async () => {
    render(<Popup />);
    await screen.findByText('Connected and ready');
    const connection = screen.getByRole('button', { name: 'Connection' });
    const settingsButton = screen.getByRole('button', { name: 'Settings' });

    connection.focus();
    fireEvent.keyDown(connection, { key: 'ArrowDown' });
    expect(settingsButton).toHaveFocus();
  });

  it('keeps connection details separate from general settings', async () => {
    render(<Popup />);

    expect(await screen.findByText('Odoo connection')).toBeInTheDocument();
    expect(screen.getByText('Private by design')).toBeInTheDocument();
    expect(screen.getByText('Scope')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Appearance settings' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('article', { name: 'Appearance settings' })).toBeInTheDocument();
    expect(screen.queryByText('Private by design')).not.toBeInTheDocument();
    expect(screen.queryByText('Scope')).not.toBeInTheDocument();
    expect(screen.getByText('Copyright')).toBeInTheDocument();
  });

  it('does not show the version number in the left navigation footer', async () => {
    render(<Popup />);

    await screen.findByText('Connected and ready');
    const footer = screen.getByText('© DDEM').closest('.navigation-footer');
    expect(footer).not.toHaveTextContent('v1.0.0');
  });

  it('sets fixed popup dimensions on the body for Firefox sizing', () => {
    const bodyRule = popupStyles.match(/body\s*\{(?<declarations>[^}]*)\}/)?.groups?.declarations;

    expect(bodyRule).toContain('width: 720px');
    expect(bodyRule).toContain('min-width: 720px');
    expect(bodyRule).toContain('max-width: 720px');
    expect(bodyRule).toContain('height: 600px');
    expect(bodyRule).toContain('min-height: 600px');
    expect(bodyRule).toContain('max-height: 600px');
    expect(popupStyles).not.toContain('100vw');
    expect(popupStyles).not.toContain('100vh');
  });
});
