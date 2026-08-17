import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatusStore } from '../src/content/status';
import {
  RenewalController,
  type RenewalControllerSnapshot,
} from '../src/features/renewals/controller';
import { RenewalPopover } from '../src/features/renewals/RenewalPopover';
import type {
  RenewalGateway,
  RenewalPreflightResult,
  RenewalQuoteSummary,
} from '../src/odoo/renewal-contracts';

const DEFAULT_DISCOUNTS = { 1: 0, 2: 30, 3: 60, 4: 80, 5: 100 } as const;

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  const [red, green, blue] = channels ?? [];
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Invalid test color: ${hex}`);
  }
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

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

class PopoverGateway implements RenewalGateway {
  readonly calls: string[] = [];
  readonly nativeRenewal = deferred<{ quoteId: number }>();
  delayNativeRenewal = false;
  private summary: RenewalQuoteSummary | null = null;

  async preflightRenewal(sourceOrderId: number): Promise<RenewalPreflightResult> {
    this.calls.push('preflight');
    return {
      eligible: true,
      sourceOrderId,
      renewalQuoteCount: 4,
      planId: 12,
      currentContractMonths: 12,
      writeDate: '2026-08-14 12:00:00',
      billingPeriodValue: 1,
      billingPeriodUnit: 'year',
      allowedTargetYears: [1, 2, 3, 4, 5],
    };
  }

  async createNativeRenewal(): Promise<{ quoteId: number }> {
    this.calls.push('renew');
    if (this.delayNativeRenewal) return this.nativeRenewal.promise;
    this.createSummary();
    return { quoteId: 100 };
  }

  releaseNativeRenewal(): void {
    this.createSummary();
    this.nativeRenewal.resolve({ quoteId: 100 });
  }

  async copyNativePlan(): Promise<{ quoteId: number }> {
    throw new Error('No copy is expected in the one-year UI test.');
  }

  async clearNativeMultiYearDiscount(quoteId: number) {
    this.calls.push(`clear:${quoteId}`);
    return { removedLineCount: 0 };
  }

  async applyNativeGlobalDiscount(quoteId: number) {
    this.calls.push(`apply:${quoteId}`);
    return { createdLineCount: 1 };
  }

  async getNativeShareLink(quoteId: number) {
    this.calls.push(`share:${quoteId}`);
    return {
      quoteId,
      shareLink: `https://www.odoo.com/share/${quoteId}?access_token=secret`,
    };
  }

  async readRenewalQuoteSummary(quoteId: number) {
    this.calls.push(`summary:${quoteId}`);
    if (!this.summary) throw new Error('Missing test summary.');
    return { ...this.summary, lines: this.summary.lines.map((line) => ({ ...line })) };
  }

  async cancelIntermediateRenewalQuotes() {
    this.calls.push('cancel-intermediate');
    return { cancelledQuoteIds: [], alreadyCancelledQuoteIds: [] };
  }

  async finishRenewalRun(runId: string): Promise<void> {
    this.calls.push(`finish:${runId}`);
  }

  private createSummary(): void {
    this.summary = {
      quoteId: 100,
      createdFromQuoteId: 42,
      name: 'SO2026/100',
      state: 'draft',
      subscriptionState: '2_renewal',
      planId: 12,
      billingPeriodValue: 1,
      billingPeriodUnit: 'year',
      currentContractMonths: 12,
      templateId: 20,
      currencyId: 1,
      currencyRounding: 0.01,
      amountUntaxed: 1_200,
      amountTax: 0,
      amountTotal: 1_200,
      lineCount: 1,
      multiYearDiscountLineCount: 0,
      lines: [
        {
          lineId: 1_001,
          productId: 1,
          sequence: 10,
          quantity: 1,
          unitPrice: 1_200,
          subtotal: 1_200,
          total: 1_200,
          taxIds: [],
          isMultiYearDiscount: false,
        },
      ],
    };
  }
}

function renderPopover(options: { delayNativeRenewal?: boolean; theme?: 'light' | 'dark' } = {}) {
  const gateway = new PopoverGateway();
  gateway.delayNativeRenewal = options.delayNativeRenewal ?? false;
  const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
  const controller = new RenewalController({
    gateway,
    statusStore: new StatusStore(),
    clipboard,
    isSourceActive: (sourceOrderId) => sourceOrderId === 42,
    createRunId: () => 'renewal-popover-test',
  });
  controller.configure({
    sourceOrderId: 42,
    discountTenthsByYears: { ...DEFAULT_DISCOUNTS },
    showSuccessConfirmation: true,
  });
  const caretContainer = document.createElement('span');
  document.body.append(caretContainer);
  const view = render(
    <RenewalPopover
      controller={controller}
      caretContainer={caretContainer}
      theme={options.theme ?? 'dark'}
      routeKey="/odoo/subscriptions/42"
    />,
  );
  return { ...view, controller, gateway, clipboard, caretContainer };
}

function renderCleanupSnapshot(initialSnapshot: RenewalControllerSnapshot) {
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    freezeDraft: vi.fn(),
    resetDraft: vi.fn(),
    setSelected: vi.fn(),
    setDiscountTenths: vi.fn(),
    start: vi.fn(),
    copyResultLink: vi.fn(),
    openResult: vi.fn(),
    copyAllLinks: vi.fn(),
    openAllResults: vi.fn(),
  } as unknown as RenewalController;
  const caretContainer = document.createElement('span');
  document.body.append(caretContainer);
  const view = render(
    <RenewalPopover
      controller={controller}
      caretContainer={caretContainer}
      theme="dark"
      routeKey="/odoo/subscriptions/42"
    />,
  );

  return {
    ...view,
    controller,
    setSnapshot(nextSnapshot: RenewalControllerSnapshot): void {
      snapshot = nextSnapshot;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('RenewalPopover', () => {
  it('freezes and preserves the same-page draft across outside-click and Escape navigation', async () => {
    const { controller } = renderPopover();
    const caret = await screen.findByRole('button', {
      name: 'Create multi-year renewal quotations',
    });

    fireEvent.keyDown(caret, { key: 'ArrowDown' });
    await screen.findByRole('dialog', { name: 'Multi-year renewals' });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '1 year' })).toHaveFocus());
    expect(screen.getByRole('spinbutton', { name: '3-year discount percentage' })).toHaveValue(6);
    fireEvent.click(screen.getByRole('checkbox', { name: '2 years' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: '3-year discount percentage' }), {
      target: { value: '7.5' },
    });

    controller.configure({
      sourceOrderId: 42,
      discountTenthsByYears: { 1: 10, 2: 20, 3: 990, 4: 40, 5: 50 },
      showSuccessConfirmation: true,
    });
    expect(screen.getByRole('spinbutton', { name: '3-year discount percentage' })).toHaveValue(7.5);

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Multi-year renewals' })).not.toBeInTheDocument();

    fireEvent.click(caret);
    expect(screen.getByRole('spinbutton', { name: '3-year discount percentage' })).toHaveValue(7.5);
    expect(screen.getByRole('checkbox', { name: '2 years' })).toBeChecked();

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Multi-year renewals' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('dialog', { name: 'Multi-year renewals' })).not.toBeInTheDocument();
    expect(caret).toHaveFocus();
  });

  it('uses 0.5% discount increments and rejects values outside that increment', async () => {
    const { controller } = renderPopover();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create multi-year renewal quotations' }),
    );

    const discount = screen.getByRole('spinbutton', { name: '4-year discount percentage' });
    expect(discount).toHaveAttribute('step', '0.5');
    fireEvent.click(screen.getByRole('checkbox', { name: '4 years' }));
    fireEvent.change(discount, { target: { value: '7.9' } });
    expect(discount).toHaveAttribute('aria-invalid', 'true');
    expect(
      controller.getSnapshot().targets.find((target) => target.years === 4)?.discountTenths,
    ).toBe(80);
    expect(screen.getByRole('button', { name: 'Create 1 quotation' })).toBeDisabled();

    fireEvent.change(discount, { target: { value: '7.5' } });
    expect(discount).toHaveAttribute('aria-invalid', 'false');
    expect(
      controller.getSnapshot().targets.find((target) => target.years === 4)?.discountTenths,
    ).toBe(75);
    expect(screen.getByRole('button', { name: 'Create 1 quotation' })).toBeEnabled();
  });

  it('applies the shared renewal palette in light and dark themes', async () => {
    const { controller, caretContainer, rerender } = renderPopover();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create multi-year renewal quotations' }),
    );
    expect(screen.getByRole('dialog', { name: 'Multi-year renewals' })).toHaveClass('theme-dark');
    expect(
      [...document.querySelectorAll('style')].some((style) =>
        style.textContent?.includes('--renewal-accent: #7b4775'),
      ),
    ).toBe(true);
    expect(
      [...document.querySelectorAll('style')].some((style) =>
        style.textContent?.includes('--renewal-accent: #7b4775'),
      ),
    ).toBe(true);
    const statusPairs = [
      ['#1f6b3a', '#ffffff'],
      ['#9b2936', '#ffffff'],
      ['#63c98b', '#262935'],
      ['#e9828f', '#262935'],
    ] as const;
    for (const [foreground, background] of statusPairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(5);
    }
    const styleText = [...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .join('\n');
    expect(styleText).toContain('--renewal-status-ready: #1f6b3a');
    expect(styleText).toContain('--renewal-status-danger: #9b2936');
    expect(styleText).toContain('--renewal-status-ready: #63c98b');
    expect(styleText).toContain('--renewal-status-danger: #e9828f');

    rerender(
      <RenewalPopover
        controller={controller}
        caretContainer={caretContainer}
        theme="light"
        routeKey="/odoo/subscriptions/42"
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Multi-year renewals' })).toHaveClass('theme-light');
  });

  it('continues a run after the popover closes and skips the native discount action at 0%', async () => {
    const { controller, gateway } = renderPopover({ delayNativeRenewal: true });
    const caret = await screen.findByRole('button', {
      name: 'Create multi-year renewal quotations',
    });
    fireEvent.click(caret);
    fireEvent.click(screen.getByRole('checkbox', { name: '1 year' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create 1 quotation' }));
    await waitFor(() => expect(gateway.calls).toContain('renew'));
    expect(caret).toBeEnabled();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Multi-year renewals' })).not.toBeInTheDocument();
    fireEvent.click(caret);
    const runningDialog = screen.getByRole('dialog', { name: 'Multi-year renewals' });
    expect(runningDialog).toBeInTheDocument();
    await waitFor(() => expect(runningDialog).toHaveFocus());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Multi-year renewals' })).not.toBeInTheDocument();

    gateway.releaseNativeRenewal();

    await waitFor(() => expect(controller.getSnapshot().phase).toBe('success'));
    expect(controller.getSnapshot().results).toHaveLength(1);
    expect(gateway.calls.some((call) => call.startsWith('apply:'))).toBe(false);
  });

  it('copies the exact available-link text directly from the result button click', async () => {
    const { controller, clipboard } = renderPopover();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create multi-year renewal quotations' }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '1 year' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create 1 quotation' }));
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('success'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy all links' }));

    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith(
      '1-year renewal\nhttps://www.odoo.com/share/100?access_token=secret',
    );
  });

  it('keeps statuses and result actions inline and exposes direct open actions', async () => {
    const { controller, gateway } = renderPopover({ delayNativeRenewal: true });
    const openResult = vi.spyOn(controller, 'openResult').mockReturnValue(true);
    const openAllResults = vi.spyOn(controller, 'openAllResults').mockReturnValue(1);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create multi-year renewal quotations' }),
    );
    expect(screen.queryByText('Multi-year renewals')).not.toBeInTheDocument();
    expect(screen.queryByText(/Current contract:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close renewal menu' })).not.toBeInTheDocument();
    expect(document.querySelector('.renewal-column-labels')).not.toBeInTheDocument();
    const popoverBody = document.querySelector('.renewal-popover-body')!;
    expect(popoverBody.children).toHaveLength(5);
    expect(document.querySelector('.renewal-footer-actions')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: '1 year' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create 1 quotation' }));
    await waitFor(() => expect(screen.getByText('Queued')).toBeInTheDocument());
    expect(screen.getByRole('status', { name: 'Creating renewal quotations' })).toBeInTheDocument();
    expect(screen.getByText('Queued').closest('.renewal-option')).toContainElement(
      screen.getByRole('spinbutton', { name: '1-year discount percentage' }),
    );

    gateway.releaseNativeRenewal();
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('success'));
    await waitFor(() => expect(screen.queryByText('Queued')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: 'Creating renewal quotations' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('1-year renewal — 0% discount')).not.toBeInTheDocument();
    expect(screen.queryByText('SO2026/100')).not.toBeInTheDocument();
    expect(popoverBody.children).toHaveLength(5);

    const copyLink = screen.getByRole('button', { name: 'Copy link for 1 year' });
    const openQuote = screen.getByRole('button', { name: 'Open quote for 1 year' });
    const copyAll = screen.getByRole('button', { name: 'Copy all links' });
    const openAll = screen.getByRole('button', { name: 'Open all quotes' });
    expect(copyLink).toHaveAttribute('title', 'Copy link for 1 year');
    expect(openQuote).toHaveAttribute('title', 'Open quote for 1 year');
    expect(copyAll).toHaveAttribute('title', 'Copy all links');
    expect(openAll).toHaveAttribute('title', 'Open all quotes');
    for (const action of [copyLink, openQuote, copyAll, openAll]) {
      expect(action).toHaveTextContent('');
      expect(action.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    }
    expect(copyLink.querySelector('rect')).toBeInTheDocument();
    expect(openQuote.querySelector('rect')).not.toBeInTheDocument();
    expect(openQuote.querySelectorAll('path')).toHaveLength(1);

    expect(screen.queryByText('Renewal term')).not.toBeInTheDocument();
    expect(screen.queryByText('Discount')).not.toBeInTheDocument();
    const footerActions = copyAll.closest<HTMLElement>('.renewal-footer-actions');
    const footer = copyAll.closest('.renewal-actions');
    const footerStage = footer?.lastElementChild as HTMLElement | null;
    const resultRow = openQuote.closest('.renewal-option');
    expect(footerActions).toContainElement(copyAll);
    expect(footerActions).toContainElement(openAll);
    expect(footer?.firstElementChild).toHaveClass('renewal-create');
    expect(footerStage).toHaveClass('renewal-footer-stage');
    expect(footerStage).toContainElement(footerActions);
    expect(popoverBody).not.toContainElement(copyAll);
    expect(resultRow?.children.item(2)).toHaveClass('renewal-row-action');
    expect(
      [...document.querySelectorAll('style')].some((style) =>
        style.textContent?.includes('--renewal-grid-columns: 104px 76px minmax(124px, 1fr)'),
      ),
    ).toBe(true);
    expect(
      [...document.querySelectorAll('style')].some((style) =>
        style.textContent?.includes('grid-template-columns: var(--renewal-grid-columns)'),
      ),
    ).toBe(true);
    expect(
      [...document.querySelectorAll('style')].some((style) =>
        style.textContent?.includes('.renewal-option:hover'),
      ),
    ).toBe(false);
    expect(
      [...document.querySelectorAll('style')].some((style) =>
        style.textContent?.includes('width: 42px'),
      ),
    ).toBe(true);
    const styles = [...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .join('\n');
    expect(styles).toContain('justify-content: space-between');
    expect(styles).toContain('--renewal-loader: #714b67');
    expect(styles).toContain('@keyframes renewal-fade-in');
    expect(styles).toContain('@keyframes renewal-fade-out');
    expect(styles).toContain('@keyframes renewal-loader-spin');
    expect(styles).toContain('animation: renewal-fade-in 220ms ease-out both');
    expect(styles).toContain('animation: renewal-fade-out 180ms ease-in both');
    expect(styles).toContain('animation-delay: 160ms');
    expect(styles).toContain('prefers-reduced-motion: reduce');
    expect(styles).toContain('border-left-width: 0');
    expect(styles).toContain('color: var(--renewal-accent)');
    expect(styles).toContain('background: transparent');
    expect(styles).toContain('background: var(--renewal-accent)');
    expect(styles).toContain('cursor: default');
    expect(styles).not.toContain('cursor: not-allowed');
    expect(styles).not.toContain('cursor: wait');

    fireEvent.click(openQuote);
    expect(openResult).toHaveBeenCalledWith(controller.getSnapshot().results[0]);
    fireEvent.click(openAll);
    expect(openAllResults).toHaveBeenCalledTimes(1);
    expect(copyAll.closest('.renewal-footer-actions')).toBe(footerActions);
  });

  it('keeps final links until the user explicitly starts another set', async () => {
    const { controller } = renderPopover();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create multi-year renewal quotations' }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '1 year' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create 1 quotation' }));
    await waitFor(() => expect(controller.getSnapshot().phase).toBe('success'));

    expect(screen.getByRole('button', { name: 'Copy all links' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create another set' }));

    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', results: [] });
    expect(screen.queryByRole('button', { name: 'Copy all links' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '1 year' })).not.toBeChecked();
  });

  it('keeps cleanup feedback in the footer across close and reopen before revealing actions', async () => {
    const source = renderPopover();
    await waitFor(() => expect(source.controller.getSnapshot().eligibility).toBe('eligible'));
    source.controller.freezeDraft();
    source.controller.setSelected(1, true);
    await source.controller.start();
    const completedSnapshot = source.controller.getSnapshot();
    source.unmount();
    document.body.replaceChildren();

    const runningSnapshot: RenewalControllerSnapshot = {
      ...completedSnapshot,
      phase: 'running',
      cleanup: { phase: 'running', completed: 0, total: 1 },
    };
    const cleanupView = renderCleanupSnapshot(runningSnapshot);
    const caret = screen.getByRole('button', {
      name: 'Create multi-year renewal quotations',
    });
    fireEvent.click(caret);

    expect(screen.getByRole('button', { name: 'Finishing…' })).toBeDisabled();
    expect(screen.getByText('Cleaning up…')).toBeInTheDocument();
    expect(
      screen.getByRole('status', {
        name: 'Canceling intermediate quotations (0 of 1)',
      }),
    ).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByRole('button', { name: 'Copy link for 1 year' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Copy all links' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open all quotes' })).not.toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Multi-year renewals' })).not.toBeInTheDocument();
    fireEvent.click(caret);
    expect(screen.getByText('Cleaning up…')).toBeInTheDocument();

    cleanupView.setSnapshot({
      ...runningSnapshot,
      phase: 'success',
      cleanup: { phase: 'complete', completed: 1, total: 1 },
    });

    await waitFor(() => expect(screen.queryByText('Cleaning up…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Copy all links' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open all quotes' })).toBeInTheDocument();
    const styles = [...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .join('\n');
    expect(styles).toContain('width: 112px');
    expect(styles).toContain('.renewal-cleanup-status');
    expect(styles).toContain('prefers-reduced-motion: reduce');
  });
});
