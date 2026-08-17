import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { RenewalController } from './controller';
import type { RenewalYears } from './types';

export interface RenewalPopoverProps {
  controller: RenewalController;
  caretContainer: HTMLElement;
  theme: 'light' | 'dark';
  routeKey: string;
}

interface PopoverPosition {
  left: number;
  top: number;
}

const PANEL_WIDTH = 360;
const VIEWPORT_GAP = 12;

const CARET_STYLES = `
.ohe-renewal-caret-button {
  display: inline-flex;
  min-width: 32px;
  min-height: 31px;
  height: var(--renew-button-height, 31px);
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  color: var(--renew-button-color, inherit);
  font-family: var(--renew-button-font-family, inherit);
  font-size: var(--renew-button-font-size, inherit);
  font-weight: var(--renew-button-font-weight, inherit);
  line-height: var(--renew-button-line-height, normal);
  background: var(--renew-button-background, rgba(255, 255, 255, .12));
  border: 1px solid var(--renew-button-border-color, rgba(255, 255, 255, .16));
  border-left-width: 0;
  border-radius: 0 var(--renew-button-radius-top-right, 4px) var(--renew-button-radius-bottom-right, 4px) 0;
  box-shadow: var(--renew-button-box-shadow, none);
  cursor: pointer;
}
.ohe-renewal-caret-button:focus-visible {
  outline: 2px solid #00a09d;
  outline-offset: 1px;
}
.ohe-renewal-caret-button:disabled {
  cursor: default;
  opacity: .62;
}
.ohe-renewal-caret-icon {
  width: 0;
  height: 0;
  border-top: 5px solid currentColor;
  border-right: 5px solid transparent;
  border-left: 5px solid transparent;
}
`;

const POPOVER_STYLES = `
.renewal-popover {
  --renewal-surface: rgba(255, 255, 255, .985);
  --renewal-raised: #fff;
  --renewal-text: #212529;
  --renewal-muted: #6c757d;
  --renewal-border: rgba(33, 37, 41, .18);
  --renewal-accent: #7b4775;
  --renewal-loader: #714b67;
  --renewal-status-ready: #1f6b3a;
  --renewal-status-danger: #9b2936;
  --renewal-grid-columns: 104px 76px minmax(124px, 1fr);
  position: fixed;
  z-index: 8;
  display: flex;
  width: min(360px, calc(100vw - 24px));
  max-height: min(520px, calc(100vh - 24px));
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
  color: var(--renewal-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  background: var(--renewal-surface);
  border: 1px solid var(--renewal-border);
  border-radius: 8px;
  box-shadow: 0 .65rem 1.6rem rgba(0, 0, 0, .28);
  backdrop-filter: blur(18px);
  animation: renewal-popover-enter 140ms ease-out both;
}
.renewal-popover.theme-dark {
  --renewal-surface: rgba(38, 41, 53, .985);
  --renewal-raised: #303441;
  --renewal-text: #e4e4e4;
  --renewal-muted: #a9abb3;
  --renewal-border: rgba(255, 255, 255, .15);
  --renewal-status-ready: #63c98b;
  --renewal-status-danger: #e9828f;
}
.renewal-popover * { box-sizing: border-box; }
.renewal-popover button,
.renewal-popover input { font: inherit; }
.renewal-popover-body {
  overflow-y: auto;
  padding: 10px 12px 9px;
}
.renewal-option {
  display: grid;
  grid-template-columns: var(--renewal-grid-columns);
  align-items: center;
  column-gap: 6px;
}
.renewal-option {
  min-height: 49px;
  padding: 6px 8px;
  border-radius: 5px;
}
.renewal-option-label {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}
.renewal-option-label input {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  margin: 0;
  accent-color: var(--renewal-accent);
}
.renewal-term { font-weight: 650; }
.renewal-discount-field {
  display: flex;
  width: 74px;
  height: 32px;
  align-items: center;
  gap: 3px;
  padding: 0 7px;
  color: var(--renewal-muted);
  background: var(--renewal-raised);
  border: 1px solid var(--renewal-border);
  border-radius: 7px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.renewal-discount-field input {
  min-width: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  color: var(--renewal-text);
  text-align: right;
  appearance: textfield;
  background: transparent;
  border: 0;
  outline: none;
}
.renewal-discount-field input::-webkit-inner-spin-button,
.renewal-discount-field input::-webkit-outer-spin-button { margin: 0; -webkit-appearance: none; }
.renewal-discount-field:focus-within {
  border-color: var(--renewal-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--renewal-accent) 20%, transparent);
}
.renewal-discount-field:has(input[aria-invalid="true"]) { border-color: #bd626a; }
.renewal-option input:disabled { cursor: default; opacity: .62; }
.renewal-option-label:has(input:disabled) { cursor: default; }
.renewal-row-action {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
}
.renewal-row-action {
  min-width: 0;
  min-height: 32px;
}
.renewal-row-swap {
  width: 100%;
  min-width: 0;
  min-height: 32px;
}
.renewal-row-swap .renewal-fade-layer {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
}
.renewal-target-status {
  overflow: hidden;
  color: var(--renewal-muted);
  font-size: 12px;
  font-weight: 650;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.renewal-target-status.is-ready { color: var(--renewal-status-ready); }
.renewal-target-status.is-failed,
.renewal-target-status.is-unknown { color: var(--renewal-status-danger); }
.renewal-actions {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 15px;
  border-top: 1px solid var(--renewal-border);
}
.renewal-footer-stage {
  width: 112px;
  min-width: 112px;
  height: 36px;
  min-height: 36px;
}
.renewal-footer-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}
.renewal-fade-swap {
  display: grid;
  align-items: center;
}
.renewal-fade-layer {
  grid-area: 1 / 1;
  min-width: 0;
}
.renewal-fade-layer.is-current {
  animation: renewal-fade-in 220ms ease-out both;
}
.renewal-fade-layer.is-exiting {
  pointer-events: none;
  animation: renewal-fade-out 180ms ease-in both;
}
.renewal-fade-swap.has-leaving > .renewal-fade-layer.is-current {
  animation-delay: 160ms;
}
.renewal-footer-stage .renewal-fade-layer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.renewal-loader {
  width: 22px;
  height: 22px;
  margin-inline-end: 6px;
  border: 2px solid color-mix(in srgb, var(--renewal-loader) 24%, transparent);
  border-top-color: var(--renewal-loader);
  border-radius: 50%;
  animation: renewal-loader-spin 720ms linear infinite;
}
.renewal-cleanup-status {
  display: inline-flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  color: var(--renewal-muted);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}
.renewal-cleanup-status .renewal-loader {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  margin-inline-end: 6px;
}
.renewal-create,
.renewal-copy,
.renewal-copy-all,
.renewal-open,
.renewal-open-all {
  min-height: 34px;
  padding: 6px 11px;
  color: #fff;
  font-weight: 700;
  background: var(--renewal-accent);
  border: 1px solid var(--renewal-accent);
  border-radius: 5px;
  cursor: pointer;
  transition: color 100ms ease, background-color 100ms ease, border-color 100ms ease;
}
.renewal-create:hover:not(:disabled),
.renewal-copy-all:hover:not(:disabled),
.renewal-open-all:hover:not(:disabled) {
  background: color-mix(in srgb, var(--renewal-accent) 88%, #fff);
  border-color: color-mix(in srgb, var(--renewal-accent) 88%, #fff);
}
.renewal-create:disabled { cursor: default; opacity: .52; }
.renewal-copy,
.renewal-open {
  display: inline-flex;
  width: 30px;
  min-width: 30px;
  height: 30px;
  min-height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--renewal-accent);
  background: transparent;
  border-color: var(--renewal-accent);
}
.renewal-copy:hover:not(:disabled),
.renewal-open:hover:not(:disabled) {
  color: #fff;
  background: var(--renewal-accent);
}
.renewal-copy-all,
.renewal-open-all {
  display: inline-flex;
  width: 42px;
  min-width: 42px;
  height: 36px;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: #fff;
  background: var(--renewal-accent);
  border-color: var(--renewal-accent);
}
.renewal-copy:focus-visible,
.renewal-copy-all:focus-visible,
.renewal-open:focus-visible,
.renewal-open-all:focus-visible {
  outline: 2px solid var(--renewal-accent);
  outline-offset: 1px;
}
.renewal-action-icon {
  display: block;
  width: 16px;
  height: 16px;
  pointer-events: none;
}
@keyframes renewal-popover-enter {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes renewal-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes renewal-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes renewal-loader-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .renewal-popover,
  .renewal-fade-layer,
  .renewal-loader { animation: none; }
}
@media (max-width: 520px) {
  .renewal-popover { --renewal-grid-columns: 94px 68px minmax(80px, 1fr); }
  .renewal-option { column-gap: 5px; }
  .renewal-discount-field { width: 66px; padding-inline: 6px; }
  .renewal-row-swap .renewal-fade-layer { gap: 4px; }
  .renewal-actions { padding-inline: 12px; }
  .renewal-footer-actions { gap: 6px; }
}
`;

function CopyIcon(): React.JSX.Element {
  return (
    <svg
      className="renewal-action-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="7" y="7" width="10" height="10" rx="1.75" />
      <path d="M13 7V4.75A1.75 1.75 0 0 0 11.25 3h-6.5A1.75 1.75 0 0 0 3 4.75v6.5A1.75 1.75 0 0 0 4.75 13H7" />
    </svg>
  );
}

function OpenQuoteIcon(): React.JSX.Element {
  return (
    <svg
      className="renewal-action-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 5h8v8M15 5 5 15" />
    </svg>
  );
}

function parseDiscountInput(value: string): number | null {
  if (!/^\d{1,3}(?:\.\d)?$/.test(value)) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  const tenths = Math.round(numeric * 10);
  return tenths % 5 === 0 ? tenths : null;
}

function inputValue(discountTenths: number): string {
  return discountTenths % 10 === 0 ? String(discountTenths / 10) : (discountTenths / 10).toFixed(1);
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'creating':
      return 'Creating…';
    case 'applying-discount':
      return 'Applying discount…';
    case 'generating-link':
      return 'Generating link…';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
    case 'unknown':
      return 'Check required';
    default:
      return 'Queued';
  }
}

interface FadeSwapProps {
  transitionKey: string;
  children: ReactNode;
  className?: string;
}

interface FadeEntry {
  key: string;
  content: ReactNode;
}

const FADE_OUT_CLEANUP_MS = 190;

function FadeSwap({ transitionKey, children, className = '' }: FadeSwapProps): React.JSX.Element {
  const [current, setCurrent] = useState<FadeEntry>(() => ({
    key: transitionKey,
    content: children,
  }));
  const [leaving, setLeaving] = useState<FadeEntry | null>(null);
  const currentRef = useRef(current);
  const contentRef = useRef(children);
  contentRef.current = children;

  useLayoutEffect(() => {
    const previous = currentRef.current;
    if (previous.key === transitionKey) return;
    const next = { key: transitionKey, content: contentRef.current };
    currentRef.current = next;
    setLeaving(previous.content === null ? null : previous);
    setCurrent(next);
    const timer = window.setTimeout(() => setLeaving(null), FADE_OUT_CLEANUP_MS);
    return () => window.clearTimeout(timer);
  }, [transitionKey]);

  return (
    <span
      className={`renewal-fade-swap${leaving ? ' has-leaving' : ''}${className ? ` ${className}` : ''}`}
    >
      {leaving ? (
        <span className="renewal-fade-layer is-exiting" aria-hidden="true">
          {leaving.content}
        </span>
      ) : null}
      <span className="renewal-fade-layer is-current" key={current.key}>
        {current.content}
      </span>
    </span>
  );
}

export function RenewalPopover({
  controller,
  caretContainer,
  theme,
  routeKey,
}: RenewalPopoverProps): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition>({ left: VIEWPORT_GAP, top: 56 });
  const [discountInputs, setDiscountInputs] = useState<Partial<Record<RenewalYears, string>>>({});
  const caretRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const activeRouteKeyRef = useRef(routeKey);

  const locked = snapshot.phase !== 'idle';
  const selectedTargets = snapshot.targets.filter((target) => target.selected);
  const selectedCount = selectedTargets.length;
  const cleanupRunning = snapshot.cleanup.phase === 'running';
  const creationRunning =
    !cleanupRunning && (snapshot.phase === 'preflight' || snapshot.phase === 'running');
  const canStartAnotherRun =
    snapshot.phase === 'success' || snapshot.phase === 'partial' || snapshot.phase === 'unknown';

  const closePanel = useCallback((): void => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (activeRouteKeyRef.current === routeKey) return;
    activeRouteKeyRef.current = routeKey;
    setOpen(false);
    setDiscountInputs({});
    controller.resetDraft();
  }, [controller, routeKey]);

  useEffect(() => {
    if (snapshot.eligibility !== 'eligible') {
      setOpen(false);
      setDiscountInputs({});
    }
  }, [snapshot.eligibility]);

  const positionPopover = (): void => {
    const caret = caretRef.current;
    if (!caret) return;
    const rect = caret.getBoundingClientRect();
    const measuredHeight = popoverRef.current?.offsetHeight ?? 520;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_GAP * 2);
    const left = Math.max(
      VIEWPORT_GAP,
      Math.min(rect.right - width, window.innerWidth - width - VIEWPORT_GAP),
    );
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_GAP;
    const top =
      spaceBelow >= Math.min(measuredHeight, window.innerHeight - VIEWPORT_GAP * 2)
        ? rect.bottom + 6
        : Math.max(VIEWPORT_GAP, rect.top - measuredHeight - 6);
    setPosition({ left, top });
  };

  useLayoutEffect(() => {
    if (!open) return;
    positionPopover();
    const frame = window.requestAnimationFrame(positionPopover);
    return () => window.cancelAnimationFrame(frame);
  }, [open, snapshot.targets.length]);

  useEffect(() => {
    if (!open) return;
    const handleViewportChange = (): void => positionPopover();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: PointerEvent): void => {
      const path = event.composedPath();
      if (
        (caretRef.current && path.includes(caretRef.current)) ||
        (popoverRef.current && path.includes(popoverRef.current))
      ) {
        return;
      }
      closePanel();
    };
    document.addEventListener('pointerdown', handleOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer, true);
  }, [closePanel, open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const firstEnabledControl = popoverRef.current?.querySelector<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      (firstEnabledControl ?? popoverRef.current)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const invalidSelectedYears = useMemo(
    () =>
      selectedTargets
        .filter((target) => {
          const raw = discountInputs[target.years] ?? inputValue(target.discountTenths);
          return parseDiscountInput(raw) === null;
        })
        .map(({ years }) => years),
    [discountInputs, selectedTargets],
  );

  if (snapshot.eligibility !== 'eligible' || !snapshot.preflight) return null;

  const openPanel = (): void => {
    controller.freezeDraft();
    setDiscountInputs((current) => {
      const next = { ...current };
      for (const target of snapshot.targets) {
        next[target.years] ??= inputValue(target.discountTenths);
      }
      return next;
    });
    setOpen(true);
  };

  const togglePanel = (): void => {
    if (open) {
      closePanel();
      return;
    }
    openPanel();
  };

  const handleCaretKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) openPanel();
    }
  };

  const handlePopoverKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closePanel();
    caretRef.current?.focus();
  };

  const handleDiscountChange = (years: RenewalYears, value: string): void => {
    setDiscountInputs((current) => ({ ...current, [years]: value }));
    const tenths = parseDiscountInput(value);
    if (tenths !== null) controller.setDiscountTenths(years, tenths);
  };

  const caret = createPortal(
    <>
      <style>{CARET_STYLES}</style>
      <button
        ref={caretRef}
        type="button"
        className="ohe-renewal-caret-button"
        aria-label="Create multi-year renewal quotations"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="ohe-renewal-popover"
        onClick={togglePanel}
        onKeyDown={handleCaretKeyDown}
      >
        <span className="ohe-renewal-caret-icon" aria-hidden="true" />
      </button>
    </>,
    caretContainer,
  );

  return (
    <>
      {caret}
      <style>{POPOVER_STYLES}</style>
      {open ? (
        <section
          ref={popoverRef}
          id="ohe-renewal-popover"
          className={`renewal-popover theme-${theme}`}
          role="dialog"
          aria-modal="false"
          aria-label="Multi-year renewals"
          tabIndex={-1}
          style={{ left: position.left, top: position.top } as CSSProperties}
          onKeyDown={handlePopoverKeyDown}
        >
          <div className="renewal-popover-body">
            {snapshot.targets.map((target) => {
              const rawDiscount = discountInputs[target.years] ?? inputValue(target.discountTenths);
              const invalid = parseDiscountInput(rawDiscount) === null;
              const term = `${target.years} ${target.years === 1 ? 'year' : 'years'}`;
              const result = target.result;
              return (
                <div className="renewal-option" key={target.years}>
                  <label className="renewal-option-label">
                    <input
                      type="checkbox"
                      checked={target.selected}
                      disabled={locked}
                      onChange={(event) =>
                        controller.setSelected(target.years, event.target.checked)
                      }
                    />
                    <span className="renewal-term">{term}</span>
                  </label>
                  <label className="renewal-discount-field">
                    <span className="sr-only">{target.years}-year discount percentage</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      inputMode="decimal"
                      value={rawDiscount}
                      aria-invalid={invalid}
                      disabled={locked}
                      onChange={(event) => handleDiscountChange(target.years, event.target.value)}
                    />
                    <span aria-hidden="true">%</span>
                  </label>
                  <div className="renewal-row-action" aria-live="polite">
                    <FadeSwap
                      className="renewal-row-swap"
                      transitionKey={
                        result
                          ? `result-${result.quoteId}`
                          : locked && target.selected
                            ? `status-${target.phase}`
                            : 'empty'
                      }
                    >
                      {result ? (
                        <>
                          <button
                            type="button"
                            className="renewal-copy"
                            aria-label={`Copy link for ${term}`}
                            title={`Copy link for ${term}`}
                            onClick={() => controller.copyResultLink(result)}
                          >
                            <CopyIcon />
                          </button>
                          <button
                            type="button"
                            className="renewal-open"
                            aria-label={`Open quote for ${term}`}
                            title={`Open quote for ${term}`}
                            onClick={() => controller.openResult(result)}
                          >
                            <OpenQuoteIcon />
                          </button>
                        </>
                      ) : locked && target.selected ? (
                        <span className={`renewal-target-status is-${target.phase}`}>
                          {phaseLabel(target.phase)}
                        </span>
                      ) : null}
                    </FadeSwap>
                  </div>
                </div>
              );
            })}
          </div>

          <footer className="renewal-actions">
            {canStartAnotherRun ? (
              <button
                type="button"
                className="renewal-create"
                onClick={() => {
                  controller.resetDraft();
                  setDiscountInputs({});
                }}
              >
                Create another set
              </button>
            ) : (
              <button
                type="button"
                className="renewal-create"
                disabled={locked || selectedCount === 0 || invalidSelectedYears.length > 0}
                onClick={() => void controller.start()}
              >
                {cleanupRunning
                  ? 'Finishing…'
                  : creationRunning
                    ? `Creating (${snapshot.completedCount} of ${selectedCount})…`
                    : `Create ${selectedCount || ''} ${selectedCount === 1 ? 'quotation' : 'quotations'}`.replace(
                        '  ',
                        ' ',
                      )}
              </button>
            )}
            <FadeSwap
              className="renewal-footer-stage"
              transitionKey={
                cleanupRunning
                  ? `cleanup-${snapshot.cleanup.completed}-${snapshot.cleanup.total}`
                  : creationRunning
                    ? 'loading'
                    : snapshot.results.length > 0
                      ? `results-${snapshot.results.length}`
                      : 'empty'
              }
            >
              {cleanupRunning ? (
                <span
                  className="renewal-cleanup-status"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  aria-label={`Canceling intermediate quotations (${snapshot.cleanup.completed} of ${snapshot.cleanup.total})`}
                >
                  <span className="renewal-loader" aria-hidden="true" />
                  <span aria-hidden="true">Cleaning up…</span>
                </span>
              ) : creationRunning ? (
                <span
                  className="renewal-loader"
                  role="status"
                  aria-label="Creating renewal quotations"
                />
              ) : snapshot.results.length > 0 ? (
                <span className="renewal-footer-actions">
                  <button
                    type="button"
                    className="renewal-copy-all"
                    aria-label="Copy all links"
                    title="Copy all links"
                    onClick={() => controller.copyAllLinks()}
                  >
                    <CopyIcon />
                  </button>
                  <button
                    type="button"
                    className="renewal-open-all"
                    aria-label="Open all quotes"
                    title="Open all quotes"
                    onClick={() => controller.openAllResults()}
                  >
                    <OpenQuoteIcon />
                  </button>
                </span>
              ) : null}
            </FadeSwap>
          </footer>
        </section>
      ) : null}
    </>
  );
}
