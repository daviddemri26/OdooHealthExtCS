import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

import {
  getCompatibilityStatus,
  subscribeToCompatibilityStatus,
} from '../../src/shared/compatibility';
import { getActiveLiveConnectionIdentity } from '../../src/shared/live-connection';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../../src/shared/settings';
import type {
  AppearancePreference,
  CompatibilityStatus,
  ConnectionCode,
  ExtensionSettings,
} from '../../src/shared/types';

type PanelId = 'connection' | 'settings' | 'health' | 'industry';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface NavigationItem {
  id: PanelId;
  label: string;
  icon: 'connection' | 'settings' | 'health' | 'industry';
}

const NAVIGATION_ITEMS: NavigationItem[] = [
  {
    id: 'connection',
    label: 'Connection',
    icon: 'connection',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
  },
  {
    id: 'health',
    label: 'Account Health',
    icon: 'health',
  },
  {
    id: 'industry',
    label: 'Industry',
    icon: 'industry',
  },
];

function PanelIcon({ icon }: { icon: NavigationItem['icon'] }): React.JSX.Element {
  if (icon === 'health') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12h4l2-5 4 10 2-5h6" />
      </svg>
    );
  }

  if (icon === 'industry') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20V9l8-5v16M12 10h8v10M7 11h1M7 15h1M15 13h2M15 17h2M2 20h20" />
      </svg>
    );
  }

  if (icon === 'connection') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

function Switch({
  checked,
  disabled = false,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className={`setting-row${disabled ? ' is-disabled' : ''}`}>
      <span className="setting-copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function AppearanceControl({
  value,
  onChange,
}: {
  value: AppearancePreference;
  onChange: (appearance: AppearancePreference) => void;
}): React.JSX.Element {
  return (
    <div className="appearance-control" role="radiogroup" aria-label="Appearance">
      {(['auto', 'light', 'dark'] as AppearancePreference[]).map((appearance) => (
        <button
          key={appearance}
          type="button"
          role="radio"
          aria-checked={value === appearance}
          className={value === appearance ? 'is-active' : ''}
          onClick={() => onChange(appearance)}
        >
          <span className={`theme-swatch theme-swatch-${appearance}`} aria-hidden="true" />
          {appearance[0]?.toUpperCase() + appearance.slice(1)}
        </button>
      ))}
    </div>
  );
}

interface ConnectionPresentation {
  title: string;
  detail: string;
  resolution?: string;
  tone: 'ready' | 'warning' | 'error' | 'idle';
}

const CONNECTION_FAILURES: Record<Exclude<ConnectionCode, 'ready'>, ConnectionPresentation> = {
  bridge_unavailable: {
    title: 'Extension connection unavailable',
    detail: 'The secure link between the extension and the current Odoo page is not responding.',
    resolution:
      'Reload the current Odoo page. If the issue remains, disable and re-enable the extension from your browser’s extension manager.',
    tone: 'error',
  },
  timeout: {
    title: 'Odoo did not respond in time',
    detail:
      'The secure connection was established, but Odoo took too long to confirm the current session.',
    resolution:
      'Confirm that Odoo is loading normally, then reload the current Odoo page and retry.',
    tone: 'warning',
  },
  network: {
    title: 'Odoo network unavailable',
    detail: 'The browser could not reach Odoo to verify the current session.',
    resolution:
      'Check your internet connection and Odoo availability, then reload the current Odoo page.',
    tone: 'error',
  },
  session_expired: {
    title: 'Odoo session expired',
    detail: 'The current browser session is no longer authenticated with Odoo.',
    resolution: 'Sign back in to www.odoo.com, then reload any Odoo workspace page.',
    tone: 'warning',
  },
  access_denied: {
    title: 'Odoo session access denied',
    detail: 'Odoo received the connection check but did not allow access with the current session.',
    resolution:
      'Confirm that your Odoo account can access the internal workspace, then sign in again or contact an Odoo administrator.',
    tone: 'warning',
  },
  incompatible_endpoint: {
    title: 'Odoo connection unsupported',
    detail:
      'The Odoo session endpoint no longer matches the secure connection contract supported by this extension.',
    resolution:
      'Reload Odoo and update the extension. If the issue persists, contact extension support.',
    tone: 'error',
  },
  incompatible_response: {
    title: 'Unexpected Odoo connection response',
    detail: 'Odoo returned session information in a format this extension cannot safely verify.',
    resolution:
      'Reload Odoo and update the extension. If the issue persists, contact extension support.',
    tone: 'error',
  },
  server_error: {
    title: 'Odoo connection check failed',
    detail: 'Odoo could not complete the session check. No connection is reported as ready.',
    resolution: 'Wait a moment, reload any Odoo workspace page, and retry.',
    tone: 'error',
  },
};

function getConnectionPresentation(
  compatibility: CompatibilityStatus | null,
): ConnectionPresentation {
  if (!compatibility) {
    return {
      title: 'Connection not checked',
      detail: 'Open any Odoo workspace page under www.odoo.com/odoo to check the connection.',
      tone: 'idle',
    };
  }

  if (compatibility.ok && compatibility.code === 'ready') {
    return {
      title: 'Connected and ready',
      detail:
        'The extension is connected to the authenticated Odoo session currently open in this browser.',
      tone: 'ready',
    };
  }

  return CONNECTION_FAILURES[
    compatibility.code === 'ready' ? 'incompatible_response' : compatibility.code
  ];
}

function ConnectionPanel({
  compatibility,
  connectedUser,
}: {
  compatibility: CompatibilityStatus | null;
  connectedUser: string | null;
}): React.JSX.Element {
  const connection = getConnectionPresentation(compatibility);
  const checkedAt = compatibility
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(compatibility.checkedAt))
    : null;

  return (
    <div className="page" data-panel="connection">
      <section className="general-stack" aria-label="Connection information">
        <article className={`info-card connection-card is-${connection.tone}`}>
          <header className="connection-heading">
            <div className="connection-copy">
              <div className="connection-title">
                <span className={`connection-indicator is-${connection.tone}`} aria-hidden="true" />
                <h3>Odoo connection</h3>
              </div>
              <p className="connection-summary">{connection.detail}</p>
            </div>
            <div
              className="connection-status"
              role="status"
              aria-label={`Current connection status: ${connection.title}`}
            >
              <span>Current status</span>
              <strong>{connection.title}</strong>
            </div>
          </header>
          {connection.resolution ? (
            <div className="connection-resolution">
              <strong>How to fix it</strong>
              <p>{connection.resolution}</p>
            </div>
          ) : null}
          <dl className="connection-facts">
            {connection.tone === 'ready' && connectedUser ? (
              <div>
                <dt>Connected user</dt>
                <dd>{connectedUser}</dd>
              </div>
            ) : null}
            {checkedAt ? (
              <div>
                <dt>Last checked</dt>
                <dd>{checkedAt}</dd>
              </div>
            ) : null}
          </dl>
        </article>

        <article className="info-card privacy-card">
          <div className="privacy-heading">
            <span className="privacy-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="5" y="10" width="14" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
              </svg>
            </span>
            <div>
              <h3>Private by design</h3>
              <p className="privacy-lines">
                <span>Uses only your current authenticated Odoo session.</span>
                <span>Requests are sent directly to www.odoo.com.</span>
                <span>
                  The connected user's name is shown only here and is never stored or shared.
                </span>
                <span>
                  The extension does not request or store passwords, API keys, cookies, session
                  identifiers, analytics, or customer records.
                </span>
              </p>
            </div>
          </div>
        </article>

        <div className="metadata-stack" aria-label="Connection scope">
          <article className="metadata-card">
            <span className="metadata-icon" aria-hidden="true">
              ◎
            </span>
            <div className="metadata-copy">
              <span>Scope</span>
              <strong>www.odoo.com/odoo*</strong>
              <small>The extension cannot run on other websites or Odoo paths.</small>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function SettingsPanel({
  settings,
  version,
  onAppearanceChange,
}: {
  settings: ExtensionSettings;
  version: string;
  onAppearanceChange: (appearance: AppearancePreference) => void;
}): React.JSX.Element {
  return (
    <div className="page" data-panel="settings">
      <section className="general-stack" aria-label="Extension settings">
        <article className="info-card appearance-card" aria-label="Appearance settings">
          <div className="card-heading">
            <div>
              <h3>Appearance</h3>
            </div>
          </div>
          <AppearanceControl value={settings.appearance} onChange={onAppearanceChange} />
        </article>

        <div className="metadata-stack" aria-label="Extension details">
          <a
            className="metadata-card metadata-link"
            href="https://daviddemri26.github.io/OdooHealthExtCS/"
            target="_blank"
            rel="noreferrer"
          >
            <span className="metadata-icon" aria-hidden="true">
              ↗
            </span>
            <div className="metadata-copy">
              <span>Website</span>
              <strong>Visit OdooHealthExtCS</strong>
              <small>Product information, privacy policy, and support.</small>
            </div>
            <span className="metadata-arrow" aria-hidden="true">
              →
            </span>
          </a>

          <article className="metadata-card">
            <span className="metadata-icon" aria-hidden="true">
              V
            </span>
            <div className="metadata-copy">
              <span>Version</span>
              <strong>{version}</strong>
            </div>
          </article>

          <article className="metadata-card">
            <span className="metadata-icon" aria-hidden="true">
              ©
            </span>
            <div className="metadata-copy">
              <span>Copyright</span>
              <strong>© DDEM</strong>
              <small>Created for Odoo Customer Success workflows.</small>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function FeaturePanel({
  feature,
  enabled,
  extensionEnabled,
  successToast,
  onEnabledChange,
  onSuccessToastChange,
}: {
  feature: 'health' | 'industry';
  enabled: boolean;
  extensionEnabled: boolean;
  successToast: boolean;
  onEnabledChange: (checked: boolean) => void;
  onSuccessToastChange: (checked: boolean) => void;
}): React.JSX.Element {
  const item = NAVIGATION_ITEMS.find((candidate) => candidate.id === feature)!;
  const isHealth = feature === 'health';
  const overview = isHealth
    ? 'Account Health is a shortcut that shows the current health status directly on active subscription records and lets you change it in one click.'
    : 'Industry is a shortcut that shows the linked customer’s current industry directly on the subscription and lets you change it without opening the customer record.';

  return (
    <div className="page" data-panel={feature}>
      <section className="feature-overview" aria-label={`${item.label} overview`}>
        <p>{overview}</p>
      </section>

      {!extensionEnabled ? (
        <div className="inline-notice" role="status">
          Enable the extension from the top-right switch to use this feature.
        </div>
      ) : null}

      <section className="options-card" aria-label={`${item.label} settings`}>
        <Switch
          checked={enabled}
          disabled={!extensionEnabled}
          label={`Enable ${item.label}`}
          description={
            isHealth
              ? 'Show the health selector on active subscription records.'
              : 'Show the industry picker on active subscription records.'
          }
          onChange={onEnabledChange}
        />
        <Switch
          checked={successToast}
          disabled={!extensionEnabled || !enabled}
          label="Show success confirmation"
          description="Display a short confirmation after a successful change."
          onChange={onSuccessToastChange}
        />
      </section>

      <section className="save-explanation" aria-label="How changes are saved">
        <span className="save-explanation-mark" aria-hidden="true">
          ✓
        </span>
        <div>
          <h3>Saved directly in Odoo</h3>
          <p>
            {isHealth
              ? 'When you choose a health value from the subscription shortcut, it is written to Odoo immediately. The shortcut shows the current saved value, while Odoo’s native Tags field may not visually refresh until you reload the page.'
              : 'When you choose an industry from the subscription shortcut, it is written to the linked Odoo customer immediately. The shortcut shows the current saved value, while the native customer form may not visually refresh until you reload the page.'}
          </p>
        </div>
      </section>
    </div>
  );
}

export function Popup(): React.JSX.Element {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [compatibility, setCompatibility] = useState<CompatibilityStatus | null>(null);
  const [connectedUser, setConnectedUser] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<PanelId>('connection');
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const didHydrate = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([getSettings(), getCompatibilityStatus()]).then(
      ([settingsResult, compatibilityResult]) => {
        if (!active) return;
        if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value);
        if (compatibilityResult.status === 'fulfilled') {
          setCompatibility(compatibilityResult.value);
        }
        setReady(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => subscribeToCompatibilityStatus(setCompatibility), []);

  useEffect(() => {
    if (!compatibility?.ok || compatibility.code !== 'ready') {
      setConnectedUser(null);
      return;
    }
    let active = true;
    void getActiveLiveConnectionIdentity().then((identity) => {
      if (active) setConnectedUser(identity?.userDisplayName ?? null);
    });
    return () => {
      active = false;
    };
  }, [compatibility?.checkedAt, compatibility?.code, compatibility?.ok]);

  useEffect(() => {
    if (!ready) return;
    if (!didHydrate.current) {
      didHydrate.current = true;
      return;
    }

    let feedbackTimer = 0;
    setSaveState('saving');
    const saveTimer = window.setTimeout(() => {
      void saveSettings(settings)
        .then(() => {
          setSaveState('saved');
          feedbackTimer = window.setTimeout(() => setSaveState('idle'), 1_400);
        })
        .catch(() => setSaveState('error'));
    }, 140);
    return () => {
      window.clearTimeout(saveTimer);
      window.clearTimeout(feedbackTimer);
    };
  }, [ready, settings]);

  const theme = useMemo(() => {
    if (settings.appearance !== 'auto') return settings.appearance;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }, [settings.appearance]);

  const updateFeature = (feature: keyof ExtensionSettings['features'], checked: boolean): void => {
    setSettings((current) => ({
      ...current,
      features: { ...current.features, [feature]: checked },
    }));
  };

  const updateSuccessToast = (
    feature: keyof ExtensionSettings['successToasts'],
    checked: boolean,
  ): void => {
    setSettings((current) => ({
      ...current,
      successToasts: { ...current.successToasts, [feature]: checked },
    }));
  };

  const handleNavigationKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-navigation-item]'),
    );
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = buttons.length - 1;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % buttons.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[nextIndex]?.focus();
  };

  const activeItem = NAVIGATION_ITEMS.find((item) => item.id === activePanel)!;
  const version = browser.runtime.getManifest().version;
  const saveLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Not saved'
          : '';
  const saveIcon =
    saveState === 'saving' ? '↻' : saveState === 'saved' ? '✓' : saveState === 'error' ? '!' : '';

  return (
    <main className={`popup theme-${theme}`}>
      <header className="app-header">
        <div className="brand">
          <img src="/icons/icon-48.png" alt="" width="46" height="46" />
          <div>
            <h1>OdooHealthExtCS</h1>
            <p>Customer Success shortcuts</p>
          </div>
        </div>

        <div className="header-actions">
          <span
            className={`save-state save-state-${saveState}`}
            role={saveState === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            <span className="save-state-icon" aria-hidden="true">
              {saveIcon}
            </span>
            <span>{saveLabel}</span>
          </span>
          <label className="master-control">
            <span>
              <strong>Extension</strong>
              <small>{settings.enabled ? 'Active' : 'Paused'}</small>
            </span>
            <input
              type="checkbox"
              checked={settings.enabled}
              aria-label="Enable extension"
              onChange={(event) =>
                setSettings((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            <span className="switch" aria-hidden="true" />
          </label>
        </div>
      </header>

      <div className={`popup-shell${ready ? ' is-ready' : ''}`}>
        <nav
          className="side-navigation"
          aria-label="Settings pages"
          onKeyDown={handleNavigationKeyDown}
        >
          <div className="navigation-group">
            {NAVIGATION_ITEMS.slice(0, 2).map((item) => (
              <button
                key={item.id}
                type="button"
                data-navigation-item
                className={activePanel === item.id ? 'is-active' : ''}
                aria-current={activePanel === item.id ? 'page' : undefined}
                onClick={() => setActivePanel(item.id)}
              >
                <span className="navigation-icon">
                  <PanelIcon icon={item.icon} />
                </span>
                <span className="navigation-copy">
                  <strong>{item.label}</strong>
                </span>
              </button>
            ))}
          </div>

          <div className="navigation-group feature-navigation">
            <span className="navigation-label">Features</span>
            {NAVIGATION_ITEMS.slice(2).map((item) => {
              const enabled = settings.features[item.id as keyof ExtensionSettings['features']];
              const stateLabel = !settings.enabled ? 'Paused' : enabled ? 'Enabled' : 'Disabled';
              return (
                <button
                  key={item.id}
                  type="button"
                  data-navigation-item
                  className={activePanel === item.id ? 'is-active' : ''}
                  aria-current={activePanel === item.id ? 'page' : undefined}
                  onClick={() => setActivePanel(item.id)}
                >
                  <span className="navigation-icon">
                    <PanelIcon icon={item.icon} />
                  </span>
                  <span className="navigation-copy">
                    <strong>{item.label}</strong>
                    <small>{stateLabel}</small>
                  </span>
                  <span
                    className={`feature-status${settings.enabled && enabled ? ' is-enabled' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>

          <footer className="navigation-footer">
            <span>© DDEM</span>
          </footer>
        </nav>

        <section className="panel-content" aria-label={activeItem.label}>
          <div key={activePanel} className="page-transition">
            {activePanel === 'connection' ? (
              <ConnectionPanel compatibility={compatibility} connectedUser={connectedUser} />
            ) : activePanel === 'settings' ? (
              <SettingsPanel
                settings={settings}
                version={version}
                onAppearanceChange={(appearance) =>
                  setSettings((current) => ({ ...current, appearance }))
                }
              />
            ) : (
              <FeaturePanel
                feature={activePanel}
                enabled={settings.features[activePanel]}
                extensionEnabled={settings.enabled}
                successToast={settings.successToasts[activePanel]}
                onEnabledChange={(checked) => updateFeature(activePanel, checked)}
                onSuccessToastChange={(checked) => updateSuccessToast(activePanel, checked)}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
