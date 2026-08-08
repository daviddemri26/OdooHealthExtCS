import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';

import { getCompatibilityStatus } from '../../src/shared/compatibility';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../../src/shared/settings';
import type {
  AppearancePreference,
  CompatibilityStatus,
  ExtensionSettings,
} from '../../src/shared/types';

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
  description: string;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className={`setting-row${disabled ? ' is-disabled' : ''}`}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
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

function ToastSwitch({
  checked,
  disabled = false,
  feature,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  feature: 'Account health' | 'Industry';
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const label = `${feature} success toast`;
  return (
    <label className={`toast-setting${disabled ? ' is-disabled' : ''}`}>
      <span>Show success toast</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch switch-compact" aria-hidden="true" />
    </label>
  );
}

export function Popup(): React.JSX.Element {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [compatibility, setCompatibility] = useState<CompatibilityStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');

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

  useEffect(() => {
    if (!ready) return;
    let feedbackTimer = 0;
    setSaveState('idle');
    const saveTimer = window.setTimeout(() => {
      void saveSettings(settings)
        .then(() => {
          setSaveState('saved');
          feedbackTimer = window.setTimeout(() => setSaveState('idle'), 1_200);
        })
        .catch(() => setSaveState('error'));
    }, 120);
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

  const version = browser.runtime.getManifest().version;
  const compatibilityLabel = compatibility
    ? compatibility.ok
      ? 'Odoo connection ready'
      : `Compatibility check: ${compatibility.code.replaceAll('_', ' ')}`
    : 'Open an Odoo subscription to run the first check';

  return (
    <main className={`popup theme-${theme}`}>
      <header className="popup-header">
        <img src="/icons/icon-48.png" alt="" width="42" height="42" />
        <div>
          <h1>OdooHealthExtCS</h1>
          <p>Customer Success shortcuts</p>
        </div>
        <span
          className={`save-state${saveState !== 'idle' ? ' is-visible' : ''}${saveState === 'error' ? ' is-error' : ''}`}
          role={saveState === 'error' ? 'alert' : undefined}
        >
          {saveState === 'error' ? 'Not saved' : 'Saved'}
        </span>
      </header>

      <section className="master-section">
        <Switch
          checked={settings.enabled}
          label="Enable extension"
          description="Show enabled tools on Odoo subscription pages."
          onChange={(enabled) => setSettings((current) => ({ ...current, enabled }))}
        />
      </section>

      <section>
        <h2>Features</h2>
        <div className="settings-card">
          <div className="feature-setting">
            <Switch
              checked={settings.features.health}
              disabled={!settings.enabled}
              label="Account health"
              description="Set or clear High, Medium, and Low health tags."
              onChange={(checked) => updateFeature('health', checked)}
            />
            <ToastSwitch
              checked={settings.successToasts.health}
              disabled={!settings.enabled || !settings.features.health}
              feature="Account health"
              onChange={(checked) => updateSuccessToast('health', checked)}
            />
          </div>
          <div className="feature-setting">
            <Switch
              checked={settings.features.industry}
              disabled={!settings.enabled}
              label="Industry quick picker"
              description="Update the linked customer without leaving the subscription."
              onChange={(checked) => updateFeature('industry', checked)}
            />
            <ToastSwitch
              checked={settings.successToasts.industry}
              disabled={!settings.enabled || !settings.features.industry}
              feature="Industry"
              onChange={(checked) => updateSuccessToast('industry', checked)}
            />
          </div>
        </div>
      </section>

      <section>
        <h2>Appearance</h2>
        <div className="appearance-control" role="radiogroup" aria-label="Appearance">
          {(['auto', 'light', 'dark'] as AppearancePreference[]).map((appearance) => (
            <button
              key={appearance}
              type="button"
              role="radio"
              aria-checked={settings.appearance === appearance}
              className={settings.appearance === appearance ? 'is-active' : ''}
              onClick={() => setSettings((current) => ({ ...current, appearance }))}
            >
              {appearance[0]?.toUpperCase() + appearance.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section className="diagnostics">
        <h2>Status</h2>
        <div className="status-line">
          <span
            className={compatibility?.ok ? 'status-ready' : 'status-neutral'}
            aria-hidden="true"
          />
          <span>{compatibilityLabel}</span>
        </div>
      </section>

      <aside className="privacy-note">
        <strong>Private by design</strong>
        <p>
          Uses only your current Odoo session. No analytics, external services, or customer-data
          storage.
        </p>
      </aside>

      <footer>
        <span>Version {version}</span>
        <span>© DDEM</span>
        <span>Runs only on www.odoo.com/odoo*</span>
      </footer>
    </main>
  );
}
