import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import {
  applyHealthChange,
  getHealthSnapshot,
  loadHealthContext,
  undoHealthChange,
  type HealthContext,
} from '../features/health/service';
import {
  applyIndustryChange,
  loadIndustryContext,
  undoIndustryChange,
  type IndustryContext,
} from '../features/industry/service';
import { OdooGatewayError } from '../odoo/gateway';
import type { OdooFieldAnchor } from '../odoo/layout';
import { setCompatibilityStatus } from '../shared/compatibility';
import type {
  ExtensionSettings,
  HealthState,
  OdooGateway,
  StatusMessage,
  SubscriptionRoute,
} from '../shared/types';

interface ContentAppProps {
  gateway: OdooGateway;
  route: SubscriptionRoute | null;
  settings: ExtensionSettings;
  detectedTheme: 'light' | 'dark';
  anchor: OdooFieldAnchor | null;
}

function createMessage(
  kind: StatusMessage['kind'],
  message: string,
  options: Pick<StatusMessage, 'action' | 'dismissAfterMs'> = {},
): StatusMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    kind,
    message,
    ...options,
  };
}

function publicError(error: unknown): { message: string; code: OdooGatewayError['code'] } {
  if (error instanceof OdooGatewayError) return { message: error.message, code: error.code };
  return { message: 'The extension could not complete this action.', code: 'server_error' };
}

export function StatusBar({
  status,
  onDismiss,
}: {
  status: StatusMessage | null;
  onDismiss: () => void;
}): React.JSX.Element | null {
  useEffect(() => {
    if (!status?.dismissAfterMs) return;
    const timer = window.setTimeout(onDismiss, status.dismissAfterMs);
    return () => window.clearTimeout(timer);
  }, [onDismiss, status]);

  const [acting, setActing] = useState(false);

  if (!status) return null;

  const runAction = async (): Promise<void> => {
    if (!status.action || acting) return;
    setActing(true);
    try {
      await status.action.run();
    } finally {
      setActing(false);
    }
  };

  return (
    <div className={`status-bar status-${status.kind}`} role="status" aria-live="polite">
      <span className="status-indicator" aria-hidden="true" />
      <span className="status-copy">{status.message}</span>
      {status.action ? (
        <button className="status-action" type="button" disabled={acting} onClick={runAction}>
          {acting ? 'Working…' : status.action.label}
        </button>
      ) : null}
      <button
        className="status-dismiss"
        type="button"
        aria-label="Dismiss message"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

const HEALTH_OPTIONS: { state: Exclude<HealthState, null>; label: string }[] = [
  { state: 'high', label: 'High' },
  { state: 'medium', label: 'Medium' },
  { state: 'low', label: 'Low' },
];

export function HealthControl({
  context,
  loading,
  pending,
  error,
  onSelect,
}: {
  context: HealthContext | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  onSelect: (state: Exclude<HealthState, null>) => void;
}): React.JSX.Element {
  const currentLabel = context?.snapshot.duplicate
    ? 'Multiple values'
    : context?.snapshot.state
      ? context.snapshot.state[0]?.toUpperCase() + context.snapshot.state.slice(1)
      : 'Not set';

  return (
    <>
      <div className="native-field-label">Health</div>
      <div className="native-field-value health-field" aria-label="Account health">
        <span className="health-current">
          {loading ? 'Loading…' : error ? 'Unavailable' : currentLabel}
        </span>
        <div className="health-options" aria-busy={loading || pending}>
          {HEALTH_OPTIONS.map(({ state, label }) => {
            const active = !context?.snapshot.duplicate && context?.snapshot.state === state;
            const action = active
              ? `Clear ${label.toLowerCase()} health`
              : `Set health to ${label}`;
            return (
              <button
                key={state}
                type="button"
                className={`health-dot health-${state}${active ? ' is-active' : ''}`}
                aria-label={action}
                aria-pressed={active}
                title={action}
                disabled={loading || pending || Boolean(error)}
                onClick={() => onSelect(state)}
              >
                <span aria-hidden="true">{label[0]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function IndustryField({
  context,
  open,
  loading,
  pending,
  error,
  onToggle,
  onSelect,
}: {
  context: IndustryContext | null;
  open: boolean;
  loading: boolean;
  pending: boolean;
  error: string | null;
  onToggle: () => void;
  onSelect: (industryId: number | null) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => searchRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: PointerEvent): void => {
      const path = event.composedPath();
      if (
        (triggerRef.current && path.includes(triggerRef.current)) ||
        (popoverRef.current && path.includes(popoverRef.current))
      ) {
        return;
      }
      onToggle();
    };
    document.addEventListener('pointerdown', handleOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer, true);
  }, [onToggle, open]);

  const industries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return context?.industries ?? [];
    return (context?.industries ?? []).filter((industry) =>
      industry.name.toLocaleLowerCase().includes(normalized),
    );
  }, [context?.industries, query]);

  const currentName =
    context?.industries.find((industry) => industry.id === context.currentIndustryId)?.name ??
    'Not set';

  const moveOptionFocus = (direction: 1 | -1): void => {
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="option"]:not(:disabled)',
      ) ?? [],
    );
    if (options.length === 0) return;
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      current < 0
        ? direction === 1
          ? 0
          : options.length - 1
        : (current + direction + options.length) % options.length;
    options[next]?.focus();
  };

  const handlePickerKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onToggle();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveOptionFocus(event.key === 'ArrowDown' ? 1 : -1);
    }
  };

  return (
    <>
      <div className="native-field-label">Industry</div>
      <div className="native-field-value industry-field">
        <button
          ref={triggerRef}
          type="button"
          className="industry-trigger"
          aria-expanded={open}
          aria-controls="odoo-health-industry-picker"
          disabled={loading || Boolean(error)}
          onClick={onToggle}
        >
          <span>{loading ? 'Loading…' : error ? 'Unavailable' : currentName}</span>
          <span className="industry-caret" aria-hidden="true" />
        </button>
        {open ? (
          <div
            ref={popoverRef}
            id="odoo-health-industry-picker"
            className="industry-popover"
            onKeyDown={handlePickerKeyDown}
          >
            <label className="search-field">
              <span className="sr-only">Search industries</span>
              <input
                ref={searchRef}
                type="search"
                placeholder="Search industries…"
                value={query}
                disabled={loading || Boolean(error)}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div
              ref={listRef}
              className="industry-list"
              role="listbox"
              aria-busy={loading || pending}
            >
              <button
                type="button"
                role="option"
                aria-selected={context?.currentIndustryId === null}
                className={context?.currentIndustryId === null ? 'is-selected' : ''}
                disabled={loading || pending || Boolean(error)}
                onClick={() => onSelect(null)}
              >
                <span>No industry</span>
                {context?.currentIndustryId === null ? (
                  <span className="option-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
              {industries.map((industry) => (
                <button
                  key={industry.id}
                  type="button"
                  role="option"
                  aria-selected={context?.currentIndustryId === industry.id}
                  className={context?.currentIndustryId === industry.id ? 'is-selected' : ''}
                  disabled={pending || Boolean(error)}
                  onClick={() => onSelect(industry.id)}
                >
                  <span>{industry.name}</span>
                  {context?.currentIndustryId === industry.id ? (
                    <span className="option-check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              ))}
              {!loading && !error && industries.length === 0 ? (
                <p className="empty-state">No industry matches your search.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function ContentApp({
  gateway,
  route,
  settings,
  detectedTheme,
  anchor,
}: ContentAppProps): React.JSX.Element | null {
  const [health, setHealth] = useState<HealthContext | null>(null);
  const [industry, setIndustry] = useState<IndustryContext | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [industryError, setIndustryError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [industryLoading, setIndustryLoading] = useState(false);
  const [healthPending, setHealthPending] = useState(false);
  const [industryPending, setIndustryPending] = useState(false);
  const [industryOpen, setIndustryOpen] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const recordId = route?.recordId;

  const notify = useCallback((message: StatusMessage) => setStatus(message), []);
  const dismissStatus = useCallback(() => setStatus(null), []);

  useEffect(() => {
    setHealth(null);
    setIndustry(null);
    setHealthError(null);
    setIndustryError(null);
    setIndustryOpen(false);
    setStatus(null);
    if (!recordId || !settings.enabled) return;

    let active = true;
    const load = async (): Promise<void> => {
      const tasks: Promise<void>[] = [];
      let compatibilityFailure: OdooGatewayError['code'] | null = null;

      if (settings.features.health) {
        setHealthLoading(true);
        tasks.push(
          loadHealthContext(gateway, recordId)
            .then(async (context) => {
              if (!active) return;
              setHealth(context);
              if (context.snapshot.duplicate) {
                notify(
                  createMessage(
                    'warning',
                    'Multiple health tags were found. Choose one value to clean them up.',
                  ),
                );
              }
            })
            .catch(async (error: unknown) => {
              if (!active) return;
              const failure = publicError(error);
              compatibilityFailure ??= failure.code;
              setHealthError(failure.message);
              notify(createMessage('error', failure.message));
            })
            .finally(() => active && setHealthLoading(false)),
        );
      }

      if (settings.features.industry) {
        setIndustryLoading(true);
        tasks.push(
          loadIndustryContext(gateway, recordId)
            .then(async (context) => {
              if (!active) return;
              setIndustry(context);
            })
            .catch(async (error: unknown) => {
              if (!active) return;
              const failure = publicError(error);
              compatibilityFailure ??= failure.code;
              setIndustryError(failure.message);
            })
            .finally(() => active && setIndustryLoading(false)),
        );
      }

      await Promise.allSettled(tasks);
      if (active && tasks.length > 0) {
        await setCompatibilityStatus(
          compatibilityFailure === null,
          compatibilityFailure ?? 'ready',
        );
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [
    gateway,
    notify,
    recordId,
    settings.enabled,
    settings.features.health,
    settings.features.industry,
  ]);

  const selectHealth = async (selected: Exclude<HealthState, null>): Promise<void> => {
    if (!route || !health || healthPending) return;
    const next = !health.snapshot.duplicate && health.snapshot.state === selected ? null : selected;
    setHealthPending(true);
    try {
      const change = await applyHealthChange(
        gateway,
        route.recordId,
        health.tags,
        health.snapshot.tagIds,
        next,
      );
      setHealth({ ...health, snapshot: getHealthSnapshot(change.applied, health.tags) });
      const message = next
        ? `Account health set to ${next[0]?.toUpperCase()}${next.slice(1)}.`
        : 'Account health cleared.';
      notify(
        createMessage('success', message, {
          dismissAfterMs: 7_000,
          action: {
            label: 'Undo',
            run: async () => {
              try {
                const restored = await undoHealthChange(gateway, route.recordId, change);
                if (!restored) {
                  notify(
                    createMessage(
                      'warning',
                      'Undo was not applied because the record changed elsewhere.',
                    ),
                  );
                  return;
                }
                setHealth({ ...health, snapshot: getHealthSnapshot(change.before, health.tags) });
                notify(
                  createMessage('info', 'Previous account health restored.', {
                    dismissAfterMs: 4_000,
                  }),
                );
              } catch (error) {
                const failure = publicError(error);
                notify(createMessage('error', failure.message));
                await setCompatibilityStatus(false, failure.code);
              }
            },
          },
        }),
      );
    } catch (error) {
      const failure = publicError(error);
      notify(createMessage('error', failure.message));
      await setCompatibilityStatus(false, failure.code);
    } finally {
      setHealthPending(false);
    }
  };

  const selectIndustry = async (industryId: number | null): Promise<void> => {
    if (!industry || industryPending || industry.currentIndustryId === industryId) {
      if (industry?.currentIndustryId === industryId) setIndustryOpen(false);
      return;
    }
    setIndustryPending(true);
    try {
      const change = await applyIndustryChange(gateway, industry, industryId);
      setIndustry({ ...industry, currentIndustryId: industryId });
      setIndustryOpen(false);
      const selectedName =
        industry.industries.find((candidate) => candidate.id === industryId)?.name ?? 'No industry';
      notify(
        createMessage('success', `Industry set to ${selectedName}.`, {
          dismissAfterMs: 7_000,
          action: {
            label: 'Undo',
            run: async () => {
              try {
                const restored = await undoIndustryChange(gateway, change);
                if (!restored) {
                  notify(
                    createMessage(
                      'warning',
                      'Undo was not applied because the customer changed elsewhere.',
                    ),
                  );
                  return;
                }
                setIndustry({ ...industry, currentIndustryId: change.before });
                notify(
                  createMessage('info', 'Previous industry restored.', {
                    dismissAfterMs: 4_000,
                  }),
                );
              } catch (error) {
                const failure = publicError(error);
                notify(createMessage('error', failure.message));
                await setCompatibilityStatus(false, failure.code);
              }
            },
          },
        }),
      );
    } catch (error) {
      const failure = publicError(error);
      notify(createMessage('error', failure.message));
      await setCompatibilityStatus(false, failure.code);
    } finally {
      setIndustryPending(false);
    }
  };

  if (!route || !settings.enabled) return null;

  const theme = settings.appearance === 'auto' ? detectedTheme : settings.appearance;
  const nativeFieldStyle = anchor
    ? ({
        bottom: anchor.bottom,
        left: anchor.left,
        width: anchor.width,
        gridTemplateColumns: `${anchor.labelWidth}px minmax(0, 1fr)`,
        columnGap: anchor.columnGap,
        rowGap: anchor.rowGap,
        fontFamily: anchor.fontFamily,
        fontSize: anchor.fontSize,
        lineHeight: anchor.lineHeight,
        '--odoo-label-color': anchor.labelColor,
        '--odoo-value-color': anchor.valueColor,
        '--odoo-link-color': anchor.linkColor,
      } as CSSProperties)
    : undefined;
  const showNativeFields = anchor && (settings.features.industry || settings.features.health);

  return (
    <div className={`extension-shell theme-${theme}`} data-theme={theme}>
      {showNativeFields ? (
        <section className="native-field-stack" style={nativeFieldStyle} aria-label="Customer data">
          {settings.features.industry ? (
            <IndustryField
              context={industry}
              open={industryOpen}
              loading={industryLoading}
              pending={industryPending}
              error={industryError}
              onToggle={() => setIndustryOpen((value) => !value)}
              onSelect={(industryId) => void selectIndustry(industryId)}
            />
          ) : null}
          {settings.features.health ? (
            <HealthControl
              context={health}
              loading={healthLoading}
              pending={healthPending}
              error={healthError}
              onSelect={(state) => void selectHealth(state)}
            />
          ) : null}
        </section>
      ) : null}
      <StatusBar status={status} onDismiss={dismissStatus} />
    </div>
  );
}
