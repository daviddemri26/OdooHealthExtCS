import { describe, expect, it, vi } from 'vitest';

import { StatusStore } from '../src/content/status';
import { RenewalController } from '../src/features/renewals/controller';
import type { RenewalQuoteResult } from '../src/features/renewals/types';
import { OdooGatewayError } from '../src/odoo/gateway';
import type {
  RenewalGateway,
  RenewalPreflightResult,
  RenewalQuoteSummary,
  RenewalSourceFingerprint,
  RenewalTargetYears,
} from '../src/odoo/renewal-contracts';

const DEFAULT_DISCOUNTS = { 1: 0, 2: 30, 3: 60, 4: 80, 5: 100 } as const;

function preflightForMonths(months: number, renewalQuoteCount = 4): RenewalPreflightResult {
  const allowedTargetYears = [1, 2, 3, 4, 5].filter(
    (years) => years * 12 >= months,
  ) as RenewalPreflightResult['allowedTargetYears'];
  return {
    eligible: true,
    sourceOrderId: 42,
    renewalQuoteCount,
    planId: months,
    currentContractMonths: months,
    writeDate: '2026-08-14 12:00:00',
    billingPeriodValue: months % 12 === 0 ? months / 12 : months,
    billingPeriodUnit: months % 12 === 0 ? 'year' : 'month',
    allowedTargetYears,
  };
}

class FakeRenewalGateway implements RenewalGateway {
  readonly calls: string[] = [];
  readonly nativeRenewalRequiresDiscount: boolean[] = [];
  readonly nativeRenewalRequiredCopyYears: RenewalTargetYears[][] = [];
  currentPreflight = preflightForMonths(12);
  failPreflight = false;
  failFinish = false;
  failApplyYears: number | null = null;
  timeoutApplyYears: number | null = null;
  failCopyYears: number | null = null;
  reconciledNativeRenewal = false;
  timeoutNativeRenewal = false;
  validationFailedNativeRenewal = false;
  validationFailedCopyYears: number | null = null;
  duplicateCopyYears: number | null = null;
  failSummaryAfterCopyFailure = false;
  discountLineCount = 1;
  discountLineSubtotals: number[] | null = null;
  private copyFailureTriggered = false;
  private nextQuoteId = 100;
  private lastCopiedQuoteId: number | null = null;
  private readonly summaries = new Map<number, RenewalQuoteSummary>();

  async preflightRenewal(sourceOrderId: number): Promise<RenewalPreflightResult> {
    this.calls.push(`preflight:${sourceOrderId}`);
    if (this.failPreflight) {
      throw new OdooGatewayError('network', 'The browser could not reach Odoo.');
    }
    return { ...this.currentPreflight, sourceOrderId };
  }

  async createNativeRenewal(
    sourceOrderId: number,
    _runId: string,
    _expected: RenewalSourceFingerprint,
    requiredCopyYears: RenewalTargetYears[],
    requiresDiscount: boolean,
  ): Promise<{ quoteId: number; reconciledAfterTimeout?: true }> {
    this.calls.push(`renew:${sourceOrderId}`);
    this.nativeRenewalRequiredCopyYears.push([...requiredCopyYears]);
    this.nativeRenewalRequiresDiscount.push(requiresDiscount);
    if (this.timeoutNativeRenewal) {
      throw new OdooGatewayError('timeout', 'The Odoo request timed out.');
    }
    return {
      ...this.createQuote(this.currentPreflight.currentContractMonths, sourceOrderId),
      ...(this.reconciledNativeRenewal ? { reconciledAfterTimeout: true as const } : {}),
      ...(this.validationFailedNativeRenewal
        ? { reconciledAfterValidationFailure: true as const }
        : {}),
    };
  }

  async copyNativePlan(sourceQuoteId: number, years: 1 | 2 | 3 | 4 | 5) {
    this.calls.push(`copy:${sourceQuoteId}:${years}`);
    if (this.failCopyYears === years) {
      this.copyFailureTriggered = true;
      throw new OdooGatewayError('server_error', 'Odoo could not complete the request.');
    }
    if (this.duplicateCopyYears === years && this.lastCopiedQuoteId !== null) {
      return { quoteId: this.lastCopiedQuoteId };
    }
    const quote = this.createQuote(years * 12, sourceQuoteId);
    this.lastCopiedQuoteId = quote.quoteId;
    return {
      ...quote,
      ...(this.validationFailedCopyYears === years
        ? { reconciledAfterValidationFailure: true as const }
        : {}),
    };
  }

  async clearNativeMultiYearDiscount(quoteId: number) {
    this.calls.push(`clear:${quoteId}`);
    const summary = this.getSummary(quoteId);
    if (summary.multiYearDiscountLineCount > 0) {
      summary.lineCount -= summary.multiYearDiscountLineCount;
      summary.multiYearDiscountLineCount = 0;
      summary.lines = summary.lines.filter((line) => !line.isMultiYearDiscount);
    }
    return { removedLineCount: 0 };
  }

  async applyNativeGlobalDiscount(quoteId: number, percentageTenths: number) {
    const summary = this.getSummary(quoteId);
    const years = summary.currentContractMonths / 12;
    this.calls.push(`apply:${quoteId}:${percentageTenths}`);
    if (this.failApplyYears === years) {
      throw new OdooGatewayError('server_error', 'Odoo could not complete the request.');
    }
    if (this.timeoutApplyYears === years) {
      throw new OdooGatewayError('timeout', 'The Odoo request timed out. Please retry.');
    }
    const discountAmount = -(summary.amountUntaxed * percentageTenths) / 1_000;
    summary.amountUntaxed += discountAmount;
    summary.amountTax *= 1 - percentageTenths / 1_000;
    summary.amountTotal *= 1 - percentageTenths / 1_000;
    summary.lineCount += this.discountLineCount;
    summary.multiYearDiscountLineCount = this.discountLineCount;
    const lineSubtotals =
      this.discountLineSubtotals ??
      Array.from({ length: this.discountLineCount }, () => discountAmount / this.discountLineCount);
    if (
      lineSubtotals.length !== this.discountLineCount ||
      Math.abs(lineSubtotals.reduce((total, value) => total + value, 0) - discountAmount) > 1e-6
    ) {
      throw new Error('Invalid fake discount distribution.');
    }
    for (let index = 0; index < this.discountLineCount; index += 1) {
      const lineSubtotal = lineSubtotals[index]!;
      summary.lines.push({
        lineId: quoteId * 100 + 90 + index,
        productId: 999,
        sequence: 999,
        quantity: 1,
        unitPrice: lineSubtotal,
        subtotal: lineSubtotal,
        total: lineSubtotal,
        taxIds: [],
        isMultiYearDiscount: true,
      });
    }
    return { createdLineCount: this.discountLineCount };
  }

  async getNativeShareLink(quoteId: number) {
    this.calls.push(`share:${quoteId}`);
    return { quoteId, shareLink: `https://www.odoo.com/share/${quoteId}?access_token=secret` };
  }

  async readRenewalQuoteSummary(quoteId: number) {
    this.calls.push(`summary:${quoteId}`);
    if (this.copyFailureTriggered && this.failSummaryAfterCopyFailure) {
      throw new OdooGatewayError('network', 'The browser could not reach Odoo.');
    }
    return { ...this.getSummary(quoteId) };
  }

  async finishRenewalRun(runId: string): Promise<void> {
    this.calls.push(`finish:${runId}`);
    if (this.failFinish) {
      throw new OdooGatewayError('bridge_unavailable', 'The Odoo page bridge is unavailable.');
    }
  }

  private createQuote(months: number, createdFromQuoteId: number): { quoteId: number } {
    const quoteId = this.nextQuoteId++;
    const years = months / 12;
    const amount = months * 100;
    this.summaries.set(quoteId, {
      quoteId,
      createdFromQuoteId,
      name: `Q${quoteId}`,
      state: 'draft',
      subscriptionState: null,
      planId: 1_000 + months,
      billingPeriodValue: Number.isInteger(years) ? years : months,
      billingPeriodUnit: Number.isInteger(years) ? 'year' : 'month',
      currentContractMonths: months,
      templateId: 2_000 + months,
      currencyId: 1,
      currencyRounding: 0.01,
      amountUntaxed: amount,
      amountTax: 0,
      amountTotal: amount,
      lineCount: 2,
      multiYearDiscountLineCount: 0,
      lines: [
        {
          lineId: quoteId * 10 + 1,
          productId: 1,
          sequence: 10,
          quantity: 1,
          unitPrice: amount / 2,
          subtotal: amount / 2,
          total: amount / 2,
          taxIds: [],
          isMultiYearDiscount: false,
        },
        {
          lineId: quoteId * 10 + 2,
          productId: 2,
          sequence: 20,
          quantity: 1,
          unitPrice: amount / 2,
          subtotal: amount / 2,
          total: amount / 2,
          taxIds: [],
          isMultiYearDiscount: false,
        },
      ],
    });
    return { quoteId };
  }

  private getSummary(quoteId: number): RenewalQuoteSummary {
    const summary = this.summaries.get(quoteId);
    if (!summary) throw new Error(`Missing fake quote ${quoteId}`);
    return summary;
  }
}

async function readyController(
  gateway: FakeRenewalGateway,
  clipboard = { writeText: vi.fn(() => Promise.resolve()) },
  openExternal?: (url: string) => void,
): Promise<{
  controller: RenewalController;
  statusStore: StatusStore;
  clipboard: typeof clipboard;
  openExternal: typeof openExternal;
}> {
  const statusStore = new StatusStore();
  const controller = new RenewalController({
    gateway,
    statusStore,
    clipboard,
    openExternal,
    isSourceActive: (sourceOrderId) => sourceOrderId === 42,
    createRunId: () => 'renewal-test-run',
  });
  controller.configure({
    sourceOrderId: 42,
    discountTenthsByYears: { ...DEFAULT_DISCOUNTS },
    showSuccessConfirmation: true,
  });
  await vi.waitFor(() => expect(controller.getSnapshot().eligibility).toBe('eligible'));
  return { controller, statusStore, clipboard, openExternal };
}

describe('RenewalController', () => {
  it('runs one preflight per new source and none for identical configure renders', async () => {
    const gateway = new FakeRenewalGateway();
    const statusStore = new StatusStore();
    const controller = new RenewalController({
      gateway,
      statusStore,
      isSourceActive: () => true,
    });
    const context = {
      sourceOrderId: 42,
      discountTenthsByYears: { ...DEFAULT_DISCOUNTS },
      showSuccessConfirmation: true,
    };

    controller.configure(context);
    await vi.waitFor(() => expect(controller.getSnapshot().eligibility).toBe('eligible'));
    controller.configure(context);
    await Promise.resolve();
    expect(gateway.calls.filter((call) => call === 'preflight:42')).toHaveLength(1);

    controller.configure({ ...context, sourceOrderId: 43 });
    await vi.waitFor(() => expect(controller.getSnapshot().sourceOrderId).toBe(43));
    await vi.waitFor(() => expect(controller.getSnapshot().eligibility).toBe('eligible'));
    expect(gateway.calls.filter((call) => call === 'preflight:43')).toHaveLength(1);
  });

  it('keeps a same-route draft after it is closed and ignores newer presets until explicit reset', async () => {
    const gateway = new FakeRenewalGateway();
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(2, true);
    controller.setDiscountTenths(2, 65);

    controller.releaseDraft();
    controller.configure({
      sourceOrderId: 42,
      discountTenthsByYears: { ...DEFAULT_DISCOUNTS, 2: 40 },
      showSuccessConfirmation: true,
    });

    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', draftFrozen: true });
    expect(controller.getSnapshot().targets.find(({ years }) => years === 2)).toMatchObject({
      selected: true,
      discountTenths: 65,
    });

    controller.resetDraft();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', draftFrozen: false });
    expect(controller.getSnapshot().targets.find(({ years }) => years === 2)).toMatchObject({
      selected: false,
      discountTenths: 40,
    });
  });

  it('discards the draft when the configured source route changes', async () => {
    const gateway = new FakeRenewalGateway();
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(2, true);
    controller.setDiscountTenths(2, 65);

    controller.configure({
      sourceOrderId: 43,
      discountTenthsByYears: { ...DEFAULT_DISCOUNTS, 2: 40 },
      showSuccessConfirmation: true,
    });
    await vi.waitFor(() => expect(controller.getSnapshot().eligibility).toBe('eligible'));

    expect(controller.getSnapshot()).toMatchObject({ sourceOrderId: 43, draftFrozen: false });
    expect(controller.getSnapshot().targets.find(({ years }) => years === 2)).toMatchObject({
      selected: false,
      discountTenths: 40,
    });
  });

  it('accepts half-point discount steps and rejects finer draft values', async () => {
    const gateway = new FakeRenewalGateway();
    const { controller } = await readyController(gateway);
    controller.freezeDraft();

    expect(controller.setDiscountTenths(3, 79)).toBe(false);
    expect(controller.getSnapshot().targets.find(({ years }) => years === 3)?.discountTenths).toBe(
      60,
    );
    expect(controller.setDiscountTenths(3, 65)).toBe(true);
    expect(controller.getSnapshot().targets.find(({ years }) => years === 3)?.discountTenths).toBe(
      65,
    );
  });

  it('creates every copy before discounts and returns verified links', async () => {
    const gateway = new FakeRenewalGateway();
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);
    controller.setSelected(2, true);

    await controller.start();

    const snapshot = controller.getSnapshot();
    expect(snapshot.errorMessage).toBeUndefined();
    expect(snapshot.phase).toBe('success');
    expect(snapshot.results.map(({ years }) => years)).toEqual([1, 2]);
    expect(gateway.calls.indexOf('copy:100:2')).toBeLessThan(gateway.calls.indexOf('apply:101:30'));
    expect(gateway.calls.filter((call) => call === 'clear:100')).toHaveLength(2);
    expect(gateway.calls).toContain('clear:101');
    expect(gateway.nativeRenewalRequiresDiscount).toEqual([true]);
    expect(gateway.nativeRenewalRequiredCopyYears).toEqual([[2]]);
    expect(snapshot.visibleRenewalQuoteCount).toBe(6);
    expect(gateway.calls.at(-1)).toBe('finish:renewal-test-run');
  });

  it('keeps completed volatile results if best-effort run cleanup loses the page bridge', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.failFinish = true;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);

    await expect(controller.start()).resolves.toBeUndefined();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'success', completedCount: 1 });
    expect(controller.getSnapshot().results).toHaveLength(1);
    expect(controller.getSnapshot().results[0]).toMatchObject({ years: 1, quoteId: 100 });
    expect(gateway.calls.at(-1)).toBe('finish:renewal-test-run');
  });

  it('counts the monthly native renewal, annual base, and five-year copy exactly once', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.currentPreflight = preflightForMonths(1, 0);
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);
    controller.setSelected(5, true);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'success',
      visibleRenewalQuoteCount: 3,
    });
    expect(controller.getSnapshot().results.map(({ years }) => years)).toEqual([1, 5]);
    expect(gateway.calls).toContain('renew:42');
    expect(gateway.calls).toContain('copy:100:1');
    expect(gateway.calls).toContain('copy:101:5');
    expect(gateway.nativeRenewalRequiredCopyYears).toEqual([[1, 5]]);
  });

  it('deduplicates a quote ID returned for two copy steps', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.duplicateCopyYears = 3;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(2, true);
    controller.setSelected(3, true);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'partial',
      visibleRenewalQuoteCount: 6,
    });
  });

  it('does not increment when a creation timeout yields no quote ID', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.timeoutNativeRenewal = true;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unknown',
      visibleRenewalQuoteCount: 4,
    });
    expect(gateway.calls.at(-1)).toBe('finish:renewal-test-run');
  });

  it('skips the Discount wizard preflight when every frozen target discount is zero', async () => {
    const gateway = new FakeRenewalGateway();
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'success' });
    expect(gateway.nativeRenewalRequiresDiscount).toEqual([false]);
    expect(gateway.calls.some((call) => call.startsWith('apply:'))).toBe(false);
  });

  it('can reset a completed run and create another set on the same subscription', async () => {
    const gateway = new FakeRenewalGateway();
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);
    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'success' });
    expect(controller.getSnapshot().visibleRenewalQuoteCount).toBe(5);

    controller.resetDraft();
    gateway.currentPreflight = preflightForMonths(12, 5);

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'idle',
      completedCount: 0,
      results: [],
      draftFrozen: false,
    });
    expect(controller.getSnapshot().targets.every((target) => !target.selected)).toBe(true);

    controller.freezeDraft();
    controller.setSelected(1, true);
    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'success' });
    expect(controller.getSnapshot().visibleRenewalQuoteCount).toBe(6);
    expect(gateway.calls.filter((call) => call === 'renew:42')).toHaveLength(2);
    expect(gateway.calls.filter((call) => call === 'finish:renewal-test-run')).toHaveLength(2);
  });

  it('accepts the native tax-split global discount when Odoo creates several lines', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.discountLineCount = 2;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(2, true);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'success', completedCount: 1 });
    expect(controller.getSnapshot().results.map(({ years }) => years)).toEqual([2]);
  });

  it('accepts a positive native discount subgroup when the aggregate discount is correct', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.discountLineCount = 2;
    gateway.discountLineSubtotals = [10, -82];
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(2, true);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'success', completedCount: 1 });
    expect(controller.getSnapshot().results.map(({ years }) => years)).toEqual([2]);
  });

  it('rechecks the plan and rejects a newly too-short term before the first mutation', async () => {
    const gateway = new FakeRenewalGateway();
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);
    gateway.currentPreflight = preflightForMonths(24);

    await controller.start();

    expect(gateway.calls.filter((call) => call.startsWith('renew:'))).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'partial',
      errorMessage:
        'The contract changed and one or more selected terms are now too short. No quotation was created.',
    });
    expect(controller.getSnapshot().targets.find(({ years }) => years === 1)?.phase).toBe('failed');
    expect(gateway.calls.at(-1)).toBe('finish:renewal-test-run');
  });

  it('finishes the run when the fresh server preflight itself fails', async () => {
    const gateway = new FakeRenewalGateway();
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);
    gateway.failPreflight = true;

    await controller.start();

    expect(gateway.calls.filter((call) => call.startsWith('renew:'))).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'partial',
      errorMessage: 'The browser could not reach Odoo.',
      results: [],
    });
    expect(gateway.calls.at(-1)).toBe('finish:renewal-test-run');
  });

  it('stops on the first failure and preserves only links already obtained', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.failApplyYears = 2;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);
    controller.setSelected(2, true);

    await controller.start();

    expect(controller.getSnapshot().phase).toBe('partial');
    expect(controller.getSnapshot().results.map(({ years }) => years)).toEqual([1]);
    expect(gateway.calls.filter((call) => call === 'apply:101:30')).toHaveLength(1);
    expect(gateway.calls).not.toContain('share:101');
    expect(gateway.calls.at(-1)).toBe('finish:renewal-test-run');
  });

  it('reconciles targets created before a later copy fails', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.failCopyYears = 3;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);
    controller.setSelected(2, true);
    controller.setSelected(3, true);

    await controller.start();

    expect(controller.getSnapshot().phase).toBe('partial');
    expect(controller.getSnapshot().targets.find(({ years }) => years === 1)?.phase).toBe(
      'unknown',
    );
    expect(controller.getSnapshot().targets.find(({ years }) => years === 2)?.phase).toBe(
      'unknown',
    );
    expect(controller.getSnapshot().targets.find(({ years }) => years === 3)?.phase).toBe('failed');
    expect(
      controller
        .getSnapshot()
        .targets.filter(({ selected }) => selected)
        .every(({ phase }) => phase === 'failed' || phase === 'unknown' || phase === 'ready'),
    ).toBe(true);
    expect(gateway.calls).toContain('summary:100');
    expect(gateway.calls).toContain('summary:101');
    expect(controller.getSnapshot().visibleRenewalQuoteCount).toBe(6);
  });

  it('keeps created targets unknown when read-only reconciliation itself fails', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.failCopyYears = 3;
    gateway.failSummaryAfterCopyFailure = true;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);
    controller.setSelected(2, true);
    controller.setSelected(3, true);

    await controller.start();

    expect(controller.getSnapshot().targets.find(({ years }) => years === 1)?.phase).toBe(
      'unknown',
    );
    expect(controller.getSnapshot().targets.find(({ years }) => years === 2)?.phase).toBe(
      'unknown',
    );
  });

  it('records a quote discovered after timeout but stops the run with an unknown outcome', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.reconciledNativeRenewal = true;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'unknown' });
    expect(controller.getSnapshot().targets.find(({ years }) => years === 1)).toMatchObject({
      quoteId: 100,
      phase: 'unknown',
    });
    expect(gateway.calls.filter((call) => call === 'renew:42')).toHaveLength(1);
    expect(controller.getSnapshot().visibleRenewalQuoteCount).toBe(5);
  });

  it('records an unverified returned quote ID and stops before any later mutation', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.validationFailedNativeRenewal = true;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unknown',
      errorMessage:
        'Odoo created a quotation, but its final state could not be verified. No automatic retry was made.',
    });
    expect(controller.getSnapshot().targets.find(({ years }) => years === 1)).toMatchObject({
      quoteId: 100,
      phase: 'unknown',
    });
    expect(gateway.calls.some((call) => call.startsWith('clear:'))).toBe(false);
    expect(gateway.calls.some((call) => call.startsWith('share:'))).toBe(false);
  });

  it('stops after an unverified target copy before creating the next target', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.validationFailedCopyYears = 2;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(2, true);
    controller.setSelected(3, true);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unknown',
      errorMessage:
        'Odoo created a quotation, but its final state could not be verified. No automatic retry was made.',
    });
    expect(controller.getSnapshot().targets.find(({ years }) => years === 2)).toMatchObject({
      quoteId: 101,
      phase: 'unknown',
    });
    expect(gateway.calls).toContain('copy:100:2');
    expect(gateway.calls).not.toContain('copy:100:3');
    expect(gateway.calls.some((call) => call.startsWith('apply:'))).toBe(false);
    expect(gateway.calls.some((call) => call.startsWith('share:'))).toBe(false);
  });

  it('marks a timeout unknown and never suggests or performs an automatic retry', async () => {
    const gateway = new FakeRenewalGateway();
    gateway.timeoutApplyYears = 2;
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(2, true);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unknown',
      errorMessage:
        'The Odoo request timed out. The outcome is unknown; no automatic retry was made.',
    });
    expect(controller.getSnapshot().targets.find(({ years }) => years === 2)?.phase).toBe(
      'unknown',
    );
    expect(gateway.calls.filter((call) => call === 'apply:101:30')).toHaveLength(1);
  });

  it('starts clipboard writes synchronously and formats all available links exactly', async () => {
    const gateway = new FakeRenewalGateway();
    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
    const { controller } = await readyController(gateway, clipboard);
    controller.freezeDraft();
    controller.setSelected(1, true);
    controller.setSelected(2, true);
    await controller.start();

    controller.copyAllLinks();

    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith(
      '1-year renewal\nhttps://www.odoo.com/share/100?access_token=secret\n\n' +
        '2-year renewal — 3% discount\nhttps://www.odoo.com/share/101?access_token=secret',
    );
  });

  it('opens only an owned valid quotation using the injected synchronous tab opener', async () => {
    const gateway = new FakeRenewalGateway();
    const openExternal = vi.fn<(url: string) => void>();
    const { controller } = await readyController(gateway, undefined, openExternal);
    controller.freezeDraft();
    controller.setSelected(2, true);
    await controller.start();
    const result = controller.getSnapshot().results[0]!;

    expect(
      controller.openResult({
        ...result,
        url: 'javascript:alert(1)',
      }),
    ).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();

    expect(controller.openResult(result)).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://www.odoo.com/share/101?access_token=secret');
  });

  it('opens all valid available quotations in ascending order and skips an invalid URL', async () => {
    const gateway = new FakeRenewalGateway();
    const openExternal = vi.fn<(url: string) => void>();
    const { controller, statusStore } = await readyController(gateway, undefined, openExternal);
    controller.freezeDraft();
    controller.setSelected(1, true);
    controller.setSelected(2, true);
    controller.setSelected(3, true);
    await controller.start();

    const results = controller.getSnapshot().results as RenewalQuoteResult[];
    results.reverse();
    results.find(({ years }) => years === 2)!.url = 'https://example.com/untrusted';

    expect(controller.openAllResults()).toBe(2);
    expect(openExternal.mock.calls.map(([url]) => url)).toEqual([
      'https://www.odoo.com/share/100?access_token=secret',
      'https://www.odoo.com/share/102?access_token=secret',
    ]);
    expect(statusStore.getSnapshot()).toMatchObject({
      kind: 'warning',
      message: 'Only 2 of 3 renewal quotations were opened.',
    });
  });

  it('reports browser-blocked tabs and counts only successful openings', async () => {
    const gateway = new FakeRenewalGateway();
    const openExternal = vi.fn<(url: string) => boolean>((url) => !url.includes('/101?'));
    const { controller, statusStore } = await readyController(gateway, undefined, openExternal);
    controller.freezeDraft();
    controller.setSelected(1, true);
    controller.setSelected(2, true);
    await controller.start();

    expect(controller.openAllResults()).toBe(1);
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(statusStore.getSnapshot()).toMatchObject({
      kind: 'warning',
      message: 'Only 1 of 2 renewal quotations were opened.',
    });
  });

  it('reports a blocked default tab before navigating to a tokenized URL', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const gateway = new FakeRenewalGateway();
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);
    await controller.start();

    expect(controller.openResult(controller.getSnapshot().results[0]!)).toBe(false);
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
  });

  it('severs the opener and navigates a successfully opened tab without a referrer', async () => {
    const click = vi.fn();
    const link = { href: '', rel: '', click };
    const openedTab = {
      opener: window,
      document: { createElement: vi.fn(() => link) },
      close: vi.fn(),
    };
    const open = vi.spyOn(window, 'open').mockReturnValue(openedTab as unknown as Window);
    const gateway = new FakeRenewalGateway();
    const { controller } = await readyController(gateway);
    controller.freezeDraft();
    controller.setSelected(1, true);
    await controller.start();

    expect(controller.openResult(controller.getSnapshot().results[0]!)).toBe(true);
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(openedTab.opener).toBeNull();
    expect(link).toMatchObject({
      href: 'https://www.odoo.com/share/100?access_token=secret',
      rel: 'noreferrer',
    });
    expect(click).toHaveBeenCalledOnce();
    expect(openedTab.close).not.toHaveBeenCalled();
  });
});
