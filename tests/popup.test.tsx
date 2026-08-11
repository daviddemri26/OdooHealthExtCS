import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
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
    saveSettings: mocks.saveSettings,
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

const popupStyles = readFileSync(resolve('entrypoints/popup/style.css'), 'utf8');

const settings = {
  schemaVersion: 3 as const,
  enabled: true,
  healthListPreview: true,
  features: { health: true, industry: true },
  successToasts: { health: true, industry: true },
  appearance: 'dark' as const,
};

describe('settings popup', () => {
  beforeEach(() => {
    mocks.getSettings.mockReset().mockResolvedValue(settings);
    mocks.saveSettings.mockReset().mockResolvedValue(undefined);
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

  it('lists features directly and opens each dedicated page', async () => {
    render(<Popup />);

    expect(await screen.findByText('Connected and ready')).toBeInTheDocument();
    expect(screen.queryByText('Choose how the control panel looks.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connection' })).toBeInTheDocument();
    const settingsNavigation = screen.getByRole('button', { name: 'Settings' });
    const healthNavigation = screen.getByRole('button', { name: /Account Health Enabled/ });
    const industryNavigation = screen.getByRole('button', { name: /Industry Enabled/ });

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
      expect(mocks.saveSettings).toHaveBeenCalledWith({
        ...settings,
        features: { health: false, industry: true },
      }),
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
      expect(mocks.saveSettings).toHaveBeenLastCalledWith({
        ...settings,
        healthListPreview: false,
        features: { health: false, industry: true },
      }),
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
