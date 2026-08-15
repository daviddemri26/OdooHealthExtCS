import { createStatusMessage, StatusStore } from '../../content/status';
import { OdooGatewayError } from '../../odoo/gateway';
import type {
  RenewalCreatedQuoteResult,
  RenewalGateway,
  RenewalPreflightResult,
  RenewalQuoteSummary,
  RenewalSourceFingerprint,
} from '../../odoo/renewal-contracts';
import type { RenewalDiscountTenthsByYears, RenewalYear, StatusMessage } from '../../shared/types';
import { formatRenewalLinksForClipboard, getRenewalLinkForClipboard } from './clipboard';
import {
  buildRenewalPlan,
  getEligibleRenewalYears,
  normalizeBillingPeriod,
  normalizeDiscountTenths,
} from './domain';
import type {
  DiscountTenths,
  RenewalQuoteKey,
  RenewalQuoteResult,
  RenewalRunPhase,
  RenewalTargetPhase,
  RenewalYears,
} from './types';

export type RenewalEligibility = 'idle' | 'checking' | 'eligible' | 'unavailable';

export interface RenewalDraftTarget {
  years: RenewalYears;
  selected: boolean;
  discountTenths: number;
  phase: RenewalTargetPhase;
  quoteId?: number;
  result?: RenewalQuoteResult;
}

export interface RenewalControllerSnapshot {
  sourceOrderId: number | null;
  eligibility: RenewalEligibility;
  preflight: RenewalPreflightResult | null;
  allowedYears: readonly RenewalYears[];
  targets: readonly RenewalDraftTarget[];
  phase: RenewalRunPhase;
  completedCount: number;
  errorMessage?: string;
  results: readonly RenewalQuoteResult[];
  draftFrozen: boolean;
  visibleRenewalQuoteCount: number | null;
}

export interface RenewalControllerContext {
  sourceOrderId: number;
  discountTenthsByYears: RenewalDiscountTenthsByYears;
  showSuccessConfirmation: boolean;
}

export interface RenewalControllerOptions {
  gateway: RenewalGateway;
  statusStore: StatusStore;
  isSourceActive: (sourceOrderId: number) => boolean;
  clipboard?: Pick<Clipboard, 'writeText'>;
  openExternal?: RenewalExternalOpener;
  createRunId?: () => string;
}

export type RenewalExternalOpener = (url: string) => boolean | void;

type RenewalControllerListener = () => void;

interface VerifiedQuote {
  quoteId: number;
  cleanSummary: RenewalQuoteSummary;
}

const INITIAL_SNAPSHOT: RenewalControllerSnapshot = {
  sourceOrderId: null,
  eligibility: 'idle',
  preflight: null,
  allowedYears: [],
  targets: [],
  phase: 'idle',
  completedCount: 0,
  results: [],
  draftFrozen: false,
  visibleRenewalQuoteCount: null,
};

const AMOUNT_EPSILON = 1e-6;
const ODOO_ORIGIN = 'https://www.odoo.com';

function openExternalTab(url: string): boolean {
  if (typeof globalThis.window?.open !== 'function') {
    throw new Error('Opening a browser tab is unavailable.');
  }
  const openedTab = globalThis.window.open('about:blank', '_blank');
  if (!openedTab) return false;
  try {
    openedTab.opener = null;
    const link = openedTab.document.createElement('a');
    link.href = url;
    link.rel = 'noreferrer';
    link.click();
    return true;
  } catch {
    openedTab.close();
    return false;
  }
}

function getRenewalLinkForOpening(result: RenewalQuoteResult): string {
  const link = getRenewalLinkForClipboard(result);
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new TypeError('Renewal URL must be absolute.');
  }
  if (
    parsed.origin !== ODOO_ORIGIN ||
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new TypeError('Renewal URL must use the trusted Odoo origin.');
  }
  return link;
}

function randomRunId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `renewal-${uuid}` : `renewal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isQuotationState(value: unknown): value is 'draft' | 'sent' {
  return value === 'draft' || value === 'sent';
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof OdooGatewayError) {
    return error.code === 'timeout'
      ? 'The Odoo request timed out. The outcome is unknown; no automatic retry was made.'
      : error.message;
  }
  if (error instanceof RenewalControllerError) return error.message;
  return 'Odoo could not complete the renewal quotation run.';
}

function isUnknownOutcome(error: unknown): boolean {
  return (
    (error instanceof OdooGatewayError && error.code === 'timeout') ||
    error instanceof RenewalUnknownOutcomeError
  );
}

function assertKnownCreationOutcome(result: RenewalCreatedQuoteResult): void {
  if (result.reconciledAfterValidationFailure) {
    throw new RenewalUnknownOutcomeError(
      'Odoo created a quotation, but its final state could not be verified. No automatic retry was made.',
    );
  }
  if (result.reconciledAfterTimeout) {
    throw new OdooGatewayError('timeout', 'The Odoo request timed out.');
  }
}

function sourceFingerprint(preflight: RenewalPreflightResult): RenewalSourceFingerprint {
  return {
    planId: preflight.planId,
    currentContractMonths: preflight.currentContractMonths,
    writeDate: preflight.writeDate,
  };
}

function assertPreflight(
  preflight: RenewalPreflightResult,
  sourceOrderId: number,
): readonly RenewalYears[] {
  const normalized = normalizeBillingPeriod({
    value: preflight.billingPeriodValue,
    unit: preflight.billingPeriodUnit,
  });
  if (
    preflight.sourceOrderId !== sourceOrderId ||
    !isPositiveSafeInteger(preflight.planId) ||
    !normalized ||
    normalized.months !== preflight.currentContractMonths ||
    typeof preflight.writeDate !== 'string' ||
    preflight.writeDate.length === 0 ||
    !Number.isSafeInteger(preflight.renewalQuoteCount) ||
    preflight.renewalQuoteCount < 0
  ) {
    throw new RenewalControllerError(
      'The current contract duration could not be verified. No quotation was created.',
    );
  }

  const eligible = getEligibleRenewalYears(preflight.currentContractMonths);
  if (
    !Array.isArray(preflight.allowedTargetYears) ||
    preflight.allowedTargetYears.length !== eligible.length ||
    preflight.allowedTargetYears.some((years, index) => years !== eligible[index])
  ) {
    throw new RenewalControllerError(
      'The current contract duration returned inconsistent renewal terms. No quotation was created.',
    );
  }
  return eligible;
}

function assertFiniteAmount(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RenewalControllerError(`The ${label} could not be verified.`);
  }
}

function assertQuoteLines(summary: RenewalQuoteSummary): void {
  const tolerance = summary.currencyRounding + AMOUNT_EPSILON;
  if (
    !Array.isArray(summary.lines) ||
    summary.lineCount < 1 ||
    summary.lines.length !== summary.lineCount ||
    summary.lines.filter((line) => line.isMultiYearDiscount).length !==
      summary.multiYearDiscountLineCount ||
    summary.lines.some(
      (line) =>
        !isPositiveSafeInteger(line.lineId) ||
        (line.productId !== null && !isPositiveSafeInteger(line.productId)) ||
        !Number.isSafeInteger(line.sequence) ||
        line.sequence < 0 ||
        typeof line.quantity !== 'number' ||
        !Number.isFinite(line.quantity) ||
        typeof line.unitPrice !== 'number' ||
        !Number.isFinite(line.unitPrice) ||
        typeof line.subtotal !== 'number' ||
        !Number.isFinite(line.subtotal) ||
        typeof line.total !== 'number' ||
        !Number.isFinite(line.total) ||
        !Array.isArray(line.taxIds) ||
        line.taxIds.some((taxId) => !isPositiveSafeInteger(taxId)),
    )
  ) {
    throw new RenewalControllerError('The renewal quotation lines could not be verified.');
  }
  const lineSubtotal = summary.lines.reduce((total, line) => total + line.subtotal, 0);
  const lineTotal = summary.lines.reduce((total, line) => total + line.total, 0);
  if (Math.abs(lineSubtotal - summary.amountUntaxed) > tolerance) {
    throw new RenewalControllerError('The renewal quotation untaxed amount could not be verified.');
  }
  if (Math.abs(lineTotal - summary.amountTotal) > tolerance) {
    throw new RenewalControllerError('The renewal quotation total could not be verified.');
  }
}

function assertCleanQuoteSummary(
  summary: RenewalQuoteSummary,
  quoteId: number,
  years: RenewalYears,
  expectedCurrencyId: number,
  expectedParentQuoteId: number,
  expectedDiscountLineCount = 0,
): void {
  if (
    summary.quoteId !== quoteId ||
    summary.createdFromQuoteId !== expectedParentQuoteId ||
    !isQuotationState(summary.state) ||
    !isPositiveSafeInteger(summary.planId) ||
    summary.currentContractMonths !== years * 12 ||
    !isPositiveSafeInteger(summary.templateId) ||
    summary.currencyId !== expectedCurrencyId ||
    typeof summary.currencyRounding !== 'number' ||
    !Number.isFinite(summary.currencyRounding) ||
    summary.currencyRounding <= 0 ||
    !Number.isSafeInteger(summary.lineCount) ||
    summary.lineCount < 1 ||
    summary.multiYearDiscountLineCount !== expectedDiscountLineCount
  ) {
    throw new RenewalControllerError(
      `The ${years}-year renewal quotation did not pass verification.`,
    );
  }
  assertFiniteAmount(summary.amountUntaxed, 'renewal untaxed amount');
  assertFiniteAmount(summary.amountTax, 'renewal tax amount');
  assertFiniteAmount(summary.amountTotal, 'renewal total');
  if (
    Math.abs(summary.amountUntaxed + summary.amountTax - summary.amountTotal) >
    summary.currencyRounding + AMOUNT_EPSILON
  ) {
    throw new RenewalControllerError(`The ${years}-year renewal total did not pass verification.`);
  }
  assertQuoteLines(summary);
}

function assertBaseQuoteSummary(
  summary: RenewalQuoteSummary,
  quoteId: number,
  expectedMonths: number,
  expectedParentQuoteId: number,
  expectedDiscountLineCount?: number,
): void {
  if (
    summary.quoteId !== quoteId ||
    summary.createdFromQuoteId !== expectedParentQuoteId ||
    !isQuotationState(summary.state) ||
    !isPositiveSafeInteger(summary.planId) ||
    summary.currentContractMonths !== expectedMonths ||
    !isPositiveSafeInteger(summary.templateId) ||
    !isPositiveSafeInteger(summary.currencyId) ||
    typeof summary.currencyRounding !== 'number' ||
    !Number.isFinite(summary.currencyRounding) ||
    summary.currencyRounding <= 0 ||
    !Number.isSafeInteger(summary.lineCount) ||
    summary.lineCount < 1 ||
    (expectedDiscountLineCount !== undefined &&
      summary.multiYearDiscountLineCount !== expectedDiscountLineCount)
  ) {
    throw new RenewalControllerError('The renewal base quotation did not pass verification.');
  }
  assertFiniteAmount(summary.amountUntaxed, 'renewal untaxed amount');
  assertFiniteAmount(summary.amountTax, 'renewal tax amount');
  assertFiniteAmount(summary.amountTotal, 'renewal total');
  if (
    Math.abs(summary.amountUntaxed + summary.amountTax - summary.amountTotal) >
    summary.currencyRounding + AMOUNT_EPSILON
  ) {
    throw new RenewalControllerError('The renewal base total did not pass verification.');
  }
  assertQuoteLines(summary);
}

function commercialLinesMatch(left: RenewalQuoteSummary, right: RenewalQuoteSummary): boolean {
  const leftLines = left.lines.filter((line) => !line.isMultiYearDiscount);
  const rightLines = right.lines.filter((line) => !line.isMultiYearDiscount);
  return (
    leftLines.length === rightLines.length &&
    leftLines.every((line, index) => {
      const other = rightLines[index];
      return Boolean(
        other &&
        other.lineId === line.lineId &&
        other.productId === line.productId &&
        other.sequence === line.sequence &&
        other.taxIds.length === line.taxIds.length &&
        other.taxIds.every((taxId, taxIndex) => taxId === line.taxIds[taxIndex]) &&
        other.quantity === line.quantity &&
        other.unitPrice === line.unitPrice &&
        Math.abs(other.subtotal - line.subtotal) <= left.currencyRounding + AMOUNT_EPSILON &&
        Math.abs(other.total - line.total) <= left.currencyRounding + AMOUNT_EPSILON,
      );
    })
  );
}

function assertDiscountedQuoteSummary(
  summary: RenewalQuoteSummary,
  cleanSummary: RenewalQuoteSummary,
  years: RenewalYears,
  discountTenths: DiscountTenths,
  expectedParentQuoteId: number,
  createdDiscountLineCount: number,
): void {
  const hasDiscount = discountTenths > 0;
  const expectedDiscountLines = hasDiscount ? createdDiscountLineCount : 0;
  if (
    !Number.isSafeInteger(expectedDiscountLines) ||
    expectedDiscountLines < (hasDiscount ? 1 : 0) ||
    expectedDiscountLines > 500
  ) {
    throw new RenewalControllerError(
      `The ${years}-year renewal discount did not pass verification.`,
    );
  }
  assertCleanQuoteSummary(
    summary,
    cleanSummary.quoteId,
    years,
    cleanSummary.currencyId,
    expectedParentQuoteId,
    expectedDiscountLines,
  );
  const expectedLineCount = cleanSummary.lineCount + expectedDiscountLines;
  if (
    summary.multiYearDiscountLineCount !== expectedDiscountLines ||
    summary.lineCount !== expectedLineCount ||
    summary.templateId !== cleanSummary.templateId ||
    summary.planId !== cleanSummary.planId ||
    summary.currencyRounding !== cleanSummary.currencyRounding
  ) {
    throw new RenewalControllerError(
      `The ${years}-year renewal discount did not pass verification.`,
    );
  }

  const multiplier = 1 - discountTenths / 1_000;
  const roundingTolerance =
    cleanSummary.currencyRounding * Math.max(1, expectedDiscountLines) + AMOUNT_EPSILON;
  const expectedUntaxed = cleanSummary.amountUntaxed * multiplier;
  const discountLines = summary.lines.filter((line) => line.isMultiYearDiscount);
  const discountSubtotal = discountLines.reduce((total, line) => total + line.subtotal, 0);
  const discountTotal = discountLines.reduce((total, line) => total + line.total, 0);
  const discountTax = discountTotal - discountSubtotal;
  if (
    Math.abs(summary.amountUntaxed - expectedUntaxed) > roundingTolerance ||
    Math.abs(summary.amountUntaxed - cleanSummary.amountUntaxed - discountSubtotal) >
      roundingTolerance ||
    Math.abs(summary.amountTax - cleanSummary.amountTax - discountTax) > roundingTolerance ||
    Math.abs(summary.amountTotal - cleanSummary.amountTotal - discountTotal) > roundingTolerance
  ) {
    throw new RenewalControllerError(`The ${years}-year renewal total did not pass verification.`);
  }

  if (!commercialLinesMatch(cleanSummary, summary)) {
    throw new RenewalControllerError(
      `The commercial lines of the ${years}-year renewal changed unexpectedly.`,
    );
  }
}

export class RenewalControllerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenewalControllerError';
  }
}

class RenewalUnknownOutcomeError extends RenewalControllerError {
  constructor(message: string) {
    super(message);
    this.name = 'RenewalUnknownOutcomeError';
  }
}

/**
 * Tab-scoped renewal orchestrator. It intentionally outlives the popover so closing the UI
 * cannot interrupt an in-flight run or discard its volatile result links.
 */
export class RenewalController {
  private readonly gateway: RenewalGateway;
  private readonly statusStore: StatusStore;
  private readonly isSourceActive: (sourceOrderId: number) => boolean;
  private readonly clipboard: Pick<Clipboard, 'writeText'> | undefined;
  private readonly openExternal: RenewalExternalOpener;
  private readonly createRunId: () => string;
  private readonly listeners = new Set<RenewalControllerListener>();
  private snapshot: RenewalControllerSnapshot = INITIAL_SNAPSHOT;
  private configuredDefaults: RenewalDiscountTenthsByYears | null = null;
  private showSuccessConfirmation = true;
  private preflightSequence = 0;
  private progressStatusId: string | null = null;
  private ownedStatusIds = new Set<string>();
  private disposed = false;

  constructor(options: RenewalControllerOptions) {
    this.gateway = options.gateway;
    this.statusStore = options.statusStore;
    this.isSourceActive = options.isSourceActive;
    this.clipboard = options.clipboard ?? globalThis.navigator?.clipboard;
    this.openExternal = options.openExternal ?? openExternalTab;
    this.createRunId = options.createRunId ?? randomRunId;
  }

  getSnapshot = (): RenewalControllerSnapshot => this.snapshot;

  subscribe = (listener: RenewalControllerListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  configure(context: RenewalControllerContext): void {
    if (this.disposed) return;
    this.showSuccessConfirmation = context.showSuccessConfirmation;

    if (this.snapshot.sourceOrderId === context.sourceOrderId) {
      const defaultsChanged =
        !this.configuredDefaults ||
        ([1, 2, 3, 4, 5] as const).some(
          (years) => this.configuredDefaults?.[years] !== context.discountTenthsByYears[years],
        );
      this.configuredDefaults = { ...context.discountTenthsByYears };
      if (!this.snapshot.draftFrozen && this.snapshot.phase === 'idle') {
        if (defaultsChanged) this.replaceTargetsFromDefaults();
      }
      return;
    }

    this.clearOwnedStatus();
    this.configuredDefaults = { ...context.discountTenthsByYears };
    this.snapshot = {
      ...INITIAL_SNAPSHOT,
      sourceOrderId: context.sourceOrderId,
      eligibility: 'checking',
    };
    this.emit();
    void this.refreshPreflight(false);
  }

  clear(): void {
    if (this.disposed) return;
    if (
      this.snapshot === INITIAL_SNAPSHOT &&
      this.configuredDefaults === null &&
      this.ownedStatusIds.size === 0
    ) {
      return;
    }
    this.preflightSequence += 1;
    this.configuredDefaults = null;
    this.clearOwnedStatus();
    this.snapshot = INITIAL_SNAPSHOT;
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.listeners.clear();
  }

  freezeDraft(): void {
    if (this.snapshot.draftFrozen) return;
    this.update({ draftFrozen: true });
  }

  releaseDraft(): void {
    // Closing the popover is presentation-only. Keep the tab-scoped draft frozen so a
    // settings refresh cannot overwrite choices made on the current source route.
  }

  resetDraft(): void {
    if (
      this.snapshot.phase === 'preflight' ||
      this.snapshot.phase === 'running' ||
      this.snapshot.eligibility !== 'eligible' ||
      !this.snapshot.preflight
    ) {
      return;
    }
    this.clearOwnedStatus();
    this.snapshot = {
      ...this.snapshot,
      phase: 'idle',
      completedCount: 0,
      errorMessage: undefined,
      results: [],
      draftFrozen: false,
    };
    this.replaceTargetsFromDefaults();
  }

  setSelected(years: RenewalYears, selected: boolean): void {
    if (this.isRunLocked() || !this.snapshot.allowedYears.includes(years)) return;
    this.updateTarget(years, { selected });
  }

  setDiscountTenths(years: RenewalYears, value: number): boolean {
    if (this.isRunLocked() || !this.snapshot.allowedYears.includes(years)) return false;
    const normalized = normalizeDiscountTenths(value);
    if (normalized === null || normalized % 5 !== 0) return false;
    this.updateTarget(years, { discountTenths: normalized });
    return true;
  }

  async start(): Promise<void> {
    if (this.isRunLocked() || this.snapshot.eligibility !== 'eligible') return;
    const sourceOrderId = this.snapshot.sourceOrderId;
    if (!sourceOrderId) return;

    const selectedDrafts = this.snapshot.targets.filter((target) => target.selected);
    if (selectedDrafts.length === 0) {
      this.notifyPersistent('warning', 'Select at least one renewal term.');
      return;
    }

    this.freezeDraft();
    this.snapshot = {
      ...this.snapshot,
      phase: 'preflight',
      completedCount: 0,
      errorMessage: undefined,
      results: [],
      targets: this.snapshot.targets.map((target) => ({
        ...target,
        phase: target.selected ? 'queued' : target.phase,
        quoteId: undefined,
        result: undefined,
      })),
    };
    this.emit();
    this.notifyProgress(0, selectedDrafts.length);

    const runId = this.createRunId();
    const createdQuoteIds = new Map<RenewalQuoteKey, number>();
    const createdQuoteParents = new Map<RenewalQuoteKey, number>();
    const targetQuoteIds = new Map<RenewalYears, number>();
    const countedQuoteIds = new Set<number>();
    let serverRenewalQuoteCount = this.snapshot.visibleRenewalQuoteCount ?? 0;
    let plannedTargets: readonly { years: RenewalYears; quoteKey: RenewalQuoteKey }[] = [];

    try {
      this.assertSourceActive(sourceOrderId);
      const freshPreflight = await this.gateway.preflightRenewal(sourceOrderId);
      if (!freshPreflight.eligible) {
        throw new RenewalControllerError(
          'The subscription is no longer in progress. No quotation was created.',
        );
      }
      const freshEligible = assertPreflight(freshPreflight, sourceOrderId);
      serverRenewalQuoteCount = freshPreflight.renewalQuoteCount;
      const selections = selectedDrafts.map(({ years, discountTenths }) => ({
        years,
        discountTenths,
      }));
      const planResult = buildRenewalPlan(freshPreflight.currentContractMonths, selections);
      if (!planResult.ok) {
        throw new RenewalControllerError(
          planResult.code === 'ineligible-year'
            ? 'The contract changed and one or more selected terms are now too short. No quotation was created.'
            : 'The selected renewal terms are no longer valid. No quotation was created.',
        );
      }
      if (selectedDrafts.some(({ years }) => !freshEligible.includes(years))) {
        throw new RenewalControllerError(
          'The contract changed and one or more selected terms are now too short. No quotation was created.',
        );
      }
      plannedTargets = planResult.plan.targets.map(({ years, quoteKey }) => ({ years, quoteKey }));
      const requiredCopyYears = [
        ...new Set<RenewalYears>([
          ...(planResult.plan.normalizationCopy ? [planResult.plan.normalizationCopy.years] : []),
          ...planResult.plan.targetCopies.map(({ years }) => years),
        ]),
      ].sort((left, right) => left - right);
      const requiresDiscount = selections.some(({ discountTenths }) => discountTenths > 0);

      this.snapshot = {
        ...this.snapshot,
        preflight: freshPreflight,
        allowedYears: freshEligible,
        phase: 'running',
        visibleRenewalQuoteCount: serverRenewalQuoteCount,
      };
      this.emit();

      this.assertSourceActive(sourceOrderId);
      const nativeRenewal = await this.gateway.createNativeRenewal(
        sourceOrderId,
        runId,
        sourceFingerprint(freshPreflight),
        requiredCopyYears,
        requiresDiscount,
      );
      if (!isPositiveSafeInteger(nativeRenewal.quoteId)) {
        throw new RenewalControllerError('Odoo did not return a valid native renewal quotation.');
      }
      createdQuoteIds.set('native-renewal', nativeRenewal.quoteId);
      createdQuoteParents.set('native-renewal', sourceOrderId);
      this.registerKnownCreatedQuote(
        sourceOrderId,
        nativeRenewal.quoteId,
        serverRenewalQuoteCount,
        countedQuoteIds,
      );
      assertKnownCreationOutcome(nativeRenewal);

      if (planResult.plan.normalizationCopy) {
        const sourceQuoteId = createdQuoteIds.get(planResult.plan.normalizationCopy.sourceQuoteKey);
        if (!sourceQuoteId) throw new RenewalControllerError('The annual renewal base is missing.');
        this.assertSourceActive(sourceOrderId);
        const annual = await this.gateway.copyNativePlan(sourceQuoteId, 1, runId);
        if (!isPositiveSafeInteger(annual.quoteId)) {
          throw new RenewalControllerError('Odoo did not return a valid annual renewal quotation.');
        }
        createdQuoteIds.set('annual-normalization', annual.quoteId);
        createdQuoteParents.set('annual-normalization', sourceQuoteId);
        this.registerKnownCreatedQuote(
          sourceOrderId,
          annual.quoteId,
          serverRenewalQuoteCount,
          countedQuoteIds,
        );
        assertKnownCreationOutcome(annual);
      }

      const baseQuoteId = createdQuoteIds.get(planResult.plan.baseQuoteKey);
      if (!baseQuoteId) throw new RenewalControllerError('The renewal base quotation is missing.');
      const baseParentQuoteId = createdQuoteParents.get(planResult.plan.baseQuoteKey);
      if (!baseParentQuoteId) {
        throw new RenewalControllerError('The renewal base quotation lineage is missing.');
      }
      const inheritedBaseSummary = await this.gateway.readRenewalQuoteSummary(baseQuoteId, runId);
      assertBaseQuoteSummary(
        inheritedBaseSummary,
        baseQuoteId,
        planResult.plan.baseDurationMonths,
        baseParentQuoteId,
      );
      this.assertSourceActive(sourceOrderId);
      await this.gateway.clearNativeMultiYearDiscount(baseQuoteId, runId);
      const baseSummary = await this.gateway.readRenewalQuoteSummary(baseQuoteId, runId);
      assertBaseQuoteSummary(
        baseSummary,
        baseQuoteId,
        planResult.plan.baseDurationMonths,
        baseParentQuoteId,
        0,
      );
      if (
        inheritedBaseSummary.templateId !== baseSummary.templateId ||
        inheritedBaseSummary.currencyId !== baseSummary.currencyId ||
        !commercialLinesMatch(inheritedBaseSummary, baseSummary)
      ) {
        throw new RenewalControllerError(
          'The renewal base commercial lines changed unexpectedly during cleanup.',
        );
      }

      // Every target copy is created from the same clean base before any discount is applied.
      for (const copy of planResult.plan.targetCopies) {
        const sourceQuoteId = createdQuoteIds.get(copy.sourceQuoteKey);
        if (!sourceQuoteId)
          throw new RenewalControllerError('The renewal base quotation is missing.');
        this.setTargetPhase(copy.years, 'creating');
        this.assertSourceActive(sourceOrderId);
        const created = await this.gateway.copyNativePlan(sourceQuoteId, copy.years, runId);
        if (!isPositiveSafeInteger(created.quoteId)) {
          throw new RenewalControllerError(
            `Odoo did not return a valid ${copy.years}-year renewal quotation.`,
          );
        }
        createdQuoteIds.set(copy.quoteKey, created.quoteId);
        createdQuoteParents.set(copy.quoteKey, sourceQuoteId);
        this.registerKnownCreatedQuote(
          sourceOrderId,
          created.quoteId,
          serverRenewalQuoteCount,
          countedQuoteIds,
        );
        assertKnownCreationOutcome(created);
      }

      for (const target of planResult.plan.targets) {
        const quoteId = createdQuoteIds.get(target.quoteKey);
        if (!quoteId) {
          throw new RenewalControllerError(
            `The ${target.years}-year renewal quotation is missing.`,
          );
        }
        targetQuoteIds.set(target.years, quoteId);
        this.setTargetQuoteId(target.years, quoteId);
      }

      const verifiedQuotes = new Map<RenewalYears, VerifiedQuote>();
      for (const target of planResult.plan.targets) {
        const quoteId = targetQuoteIds.get(target.years);
        if (!quoteId) continue;
        this.assertSourceActive(sourceOrderId);
        await this.gateway.clearNativeMultiYearDiscount(quoteId, runId);
        const cleanSummary = await this.gateway.readRenewalQuoteSummary(quoteId, runId);
        const parentQuoteId = createdQuoteParents.get(target.quoteKey);
        if (!parentQuoteId) {
          throw new RenewalControllerError(
            `The ${target.years}-year renewal quotation lineage is missing.`,
          );
        }
        assertCleanQuoteSummary(
          cleanSummary,
          quoteId,
          target.years,
          baseSummary.currencyId,
          parentQuoteId,
        );
        verifiedQuotes.set(target.years, { quoteId, cleanSummary });
      }

      for (const target of planResult.plan.targets) {
        const verified = verifiedQuotes.get(target.years);
        if (!verified) continue;
        this.setTargetPhase(target.years, 'applying-discount');
        let createdDiscountLineCount = 0;
        if (target.discountTenths > 0) {
          this.assertSourceActive(sourceOrderId);
          const applied = await this.gateway.applyNativeGlobalDiscount(
            verified.quoteId,
            target.discountTenths,
            runId,
          );
          if (
            !Number.isSafeInteger(applied.createdLineCount) ||
            applied.createdLineCount < 1 ||
            applied.createdLineCount > 500
          ) {
            throw new RenewalControllerError(
              `Odoo did not create valid ${target.years}-year discount lines.`,
            );
          }
          createdDiscountLineCount = applied.createdLineCount;
        }

        const finalSummary = await this.gateway.readRenewalQuoteSummary(verified.quoteId, runId);
        const parentQuoteId = createdQuoteParents.get(target.quoteKey);
        if (!parentQuoteId) {
          throw new RenewalControllerError(
            `The ${target.years}-year renewal quotation lineage is missing.`,
          );
        }
        assertDiscountedQuoteSummary(
          finalSummary,
          verified.cleanSummary,
          target.years,
          target.discountTenths,
          parentQuoteId,
          createdDiscountLineCount,
        );

        this.setTargetPhase(target.years, 'generating-link');
        this.assertSourceActive(sourceOrderId);
        const share = await this.gateway.getNativeShareLink(verified.quoteId, runId);
        if (share.quoteId !== verified.quoteId || !share.shareLink) {
          throw new RenewalControllerError(
            `Odoo did not return the ${target.years}-year renewal link.`,
          );
        }
        const result: RenewalQuoteResult = {
          years: target.years,
          discountTenths: target.discountTenths,
          quoteId: verified.quoteId,
          quoteName: finalSummary.name,
          url: share.shareLink,
        };
        // Normalization validates the URL is present without exposing it outside volatile state.
        getRenewalLinkForClipboard(result);
        this.setTargetResult(target.years, result);
        this.notifyProgress(this.snapshot.completedCount, selectedDrafts.length);
      }

      this.update({ phase: 'success' });
      if (this.showSuccessConfirmation) {
        this.notify(
          createStatusMessage(
            'success',
            `${selectedDrafts.length} renewal ${selectedDrafts.length === 1 ? 'quotation' : 'quotations'} created.`,
          ),
        );
      } else {
        this.dismissProgress();
      }
    } catch (error) {
      const message = publicErrorMessage(error);
      const unknownOutcome = isUnknownOutcome(error);
      for (const target of plannedTargets) {
        const quoteId = createdQuoteIds.get(target.quoteKey);
        if (!quoteId || targetQuoteIds.has(target.years)) continue;
        targetQuoteIds.set(target.years, quoteId);
        if (this.snapshot.sourceOrderId === sourceOrderId) {
          this.setTargetQuoteId(target.years, quoteId);
        }
      }
      await this.reconcileCreatedTargets(runId, targetQuoteIds);
      this.finalizeUnresolvedSelectedTargets(unknownOutcome);
      const hasResults = this.snapshot.results.length > 0;
      const phase: RenewalRunPhase = unknownOutcome ? 'unknown' : 'partial';
      this.update({ phase, errorMessage: message });
      this.notifyPersistent(
        hasResults ? 'warning' : 'error',
        hasResults
          ? `Only ${this.snapshot.results.length} of ${selectedDrafts.length} renewal links are available.`
          : message,
        hasResults ? message : undefined,
      );
    } finally {
      try {
        await this.gateway.finishRenewalRun(runId);
      } catch {
        // Run cleanup is a best-effort local authority revocation. It must never replace the
        // creation outcome already presented to the user if the bridge disappears meanwhile.
      }
    }
  }

  copyResultLink(result: RenewalQuoteResult): void {
    let link: string;
    try {
      link = getRenewalLinkForClipboard(result);
    } catch {
      this.notifyPersistent('error', 'The renewal link could not be copied.');
      return;
    }
    let pending: Promise<void> | undefined;
    try {
      pending = this.clipboard?.writeText(link);
    } catch {
      this.notifyPersistent('error', 'The renewal link could not be copied.');
      return;
    }
    if (!pending) {
      this.notifyPersistent('error', 'The renewal link could not be copied.');
      return;
    }
    void pending.then(
      () => {
        if (this.showSuccessConfirmation) {
          this.notify(createStatusMessage('success', `${result.years}-year renewal link copied.`));
        }
      },
      () => this.notifyPersistent('error', 'The renewal link could not be copied.'),
    );
  }

  copyAllLinks(): void {
    const results = this.snapshot.results;
    if (results.length === 0) return;
    let text: string;
    try {
      text = formatRenewalLinksForClipboard(results);
    } catch {
      this.notifyPersistent('error', 'The renewal links could not be copied.');
      return;
    }
    let pending: Promise<void> | undefined;
    try {
      pending = this.clipboard?.writeText(text);
    } catch {
      this.notifyPersistent('error', 'The renewal links could not be copied.');
      return;
    }
    if (!pending) {
      this.notifyPersistent('error', 'The renewal links could not be copied.');
      return;
    }
    void pending.then(
      () => {
        if (this.showSuccessConfirmation) {
          this.notify(
            createStatusMessage(
              'success',
              `${results.length} renewal ${results.length === 1 ? 'link' : 'links'} copied.`,
            ),
          );
        }
      },
      () => this.notifyPersistent('error', 'The renewal links could not be copied.'),
    );
  }

  /**
   * Opens one result synchronously. Call this method directly from a trusted user click so
   * the browser can associate the new tab with that gesture.
   */
  openResult(result: RenewalQuoteResult): boolean {
    const ownedResult = this.snapshot.results.find(
      (candidate) =>
        candidate.quoteId === result.quoteId &&
        candidate.years === result.years &&
        candidate.discountTenths === result.discountTenths &&
        candidate.quoteName === result.quoteName &&
        candidate.url === result.url,
    );
    if (!ownedResult) {
      this.notifyPersistent('error', 'The renewal quotation could not be opened.');
      return false;
    }

    try {
      if (this.openExternal(getRenewalLinkForOpening(ownedResult)) === false) {
        this.notifyPersistent('error', 'The renewal quotation could not be opened.');
        return false;
      }
    } catch {
      this.notifyPersistent('error', 'The renewal quotation could not be opened.');
      return false;
    }
    if (this.showSuccessConfirmation) {
      this.notify(
        createStatusMessage('success', `${ownedResult.years}-year renewal quotation opened.`),
      );
    }
    return true;
  }

  /**
   * Opens every valid available result synchronously, in ascending term order. Call this
   * method directly from a trusted user click; it never retries or persists a URL.
   */
  openAllResults(): number {
    const results = [...this.snapshot.results].sort((left, right) => left.years - right.years);
    if (results.length === 0) return 0;

    let openedCount = 0;
    for (const result of results) {
      try {
        if (this.openExternal(getRenewalLinkForOpening(result)) !== false) openedCount += 1;
      } catch {
        // Continue with other independently available results from this user gesture.
      }
    }

    if (openedCount === results.length) {
      if (this.showSuccessConfirmation) {
        this.notify(
          createStatusMessage(
            'success',
            `${openedCount} renewal ${openedCount === 1 ? 'quotation' : 'quotations'} opened.`,
          ),
        );
      }
    } else if (openedCount > 0) {
      this.notifyPersistent(
        'warning',
        `Only ${openedCount} of ${results.length} renewal quotations were opened.`,
      );
    } else {
      this.notifyPersistent('error', 'The renewal quotations could not be opened.');
    }
    return openedCount;
  }

  private async refreshPreflight(showFailure: boolean): Promise<void> {
    const sourceOrderId = this.snapshot.sourceOrderId;
    if (!sourceOrderId) return;
    const sequence = ++this.preflightSequence;
    try {
      const preflight = await this.gateway.preflightRenewal(sourceOrderId);
      if (!preflight.eligible) {
        if (sequence !== this.preflightSequence || this.snapshot.sourceOrderId !== sourceOrderId) {
          return;
        }
        this.snapshot = {
          ...this.snapshot,
          eligibility: 'unavailable',
          preflight: null,
          allowedYears: [],
          targets: [],
          errorMessage: undefined,
        };
        this.emit();
        return;
      }
      const allowedYears = assertPreflight(preflight, sourceOrderId);
      if (sequence !== this.preflightSequence || this.snapshot.sourceOrderId !== sourceOrderId) {
        return;
      }
      if (allowedYears.length === 0) {
        this.snapshot = {
          ...this.snapshot,
          eligibility: 'unavailable',
          preflight,
          allowedYears,
          visibleRenewalQuoteCount: preflight.renewalQuoteCount,
          targets: [],
          errorMessage: 'No renewal terms of up to 5 years are available for this contract.',
        };
        this.emit();
        this.notifyPersistent(
          'warning',
          'No renewal terms of up to 5 years are available for this contract.',
        );
        return;
      }
      this.snapshot = {
        ...this.snapshot,
        eligibility: 'eligible',
        preflight,
        allowedYears,
        visibleRenewalQuoteCount: preflight.renewalQuoteCount,
        errorMessage: undefined,
      };
      this.replaceTargetsFromDefaults();
    } catch (error) {
      if (sequence !== this.preflightSequence || this.snapshot.sourceOrderId !== sourceOrderId) {
        return;
      }
      const message = publicErrorMessage(error);
      this.snapshot = {
        ...this.snapshot,
        eligibility: 'unavailable',
        preflight: null,
        allowedYears: [],
        targets: [],
        errorMessage: message,
      };
      this.emit();
      if (showFailure || this.isSourceActive(sourceOrderId)) {
        this.notifyPersistent('error', message);
      }
    }
  }

  private replaceTargetsFromDefaults(): void {
    if (!this.configuredDefaults || this.snapshot.allowedYears.length === 0) {
      this.emit();
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      targets: this.snapshot.allowedYears.map((years) => ({
        years,
        selected: false,
        discountTenths: this.configuredDefaults?.[years as RenewalYear] ?? 0,
        phase: 'queued',
      })),
    };
    this.emit();
  }

  private isRunLocked(): boolean {
    return this.snapshot.phase !== 'idle';
  }

  private assertSourceActive(sourceOrderId: number): void {
    if (!this.isSourceActive(sourceOrderId)) {
      throw new RenewalControllerError(
        'The source subscription changed. The renewal run was stopped.',
      );
    }
  }

  private async reconcileCreatedTargets(
    runId: string,
    targetQuoteIds: ReadonlyMap<RenewalYears, number>,
  ): Promise<void> {
    for (const [years, quoteId] of targetQuoteIds) {
      if (this.snapshot.results.some((result) => result.quoteId === quoteId)) continue;
      try {
        await this.gateway.readRenewalQuoteSummary(quoteId, runId);
        this.setTargetPhase(years, 'unknown');
      } catch {
        // A failed read cannot prove that a mutation failed or that the quote is absent.
        this.setTargetPhase(years, 'unknown');
      }
    }
  }

  private finalizeUnresolvedSelectedTargets(unknownOutcome: boolean): void {
    this.snapshot = {
      ...this.snapshot,
      targets: this.snapshot.targets.map((target) => {
        if (!target.selected || target.result || target.phase === 'ready') return target;
        if (target.phase === 'unknown') return target;
        return { ...target, phase: unknownOutcome ? 'unknown' : 'failed' };
      }),
    };
    this.emit();
  }

  private setTargetPhase(years: RenewalYears, phase: RenewalTargetPhase): void {
    this.updateTarget(years, { phase });
  }

  private setTargetQuoteId(years: RenewalYears, quoteId: number): void {
    this.updateTarget(years, { quoteId });
  }

  private setTargetResult(years: RenewalYears, result: RenewalQuoteResult): void {
    this.snapshot = {
      ...this.snapshot,
      completedCount: this.snapshot.completedCount + 1,
      results: [...this.snapshot.results, result].sort((left, right) => left.years - right.years),
      targets: this.snapshot.targets.map((target) =>
        target.years === years ? { ...target, phase: 'ready', result } : target,
      ),
    };
    this.emit();
  }

  private updateTarget(years: RenewalYears, patch: Partial<RenewalDraftTarget>): void {
    this.snapshot = {
      ...this.snapshot,
      targets: this.snapshot.targets.map((target) =>
        target.years === years ? { ...target, ...patch } : target,
      ),
    };
    this.emit();
  }

  private registerKnownCreatedQuote(
    sourceOrderId: number,
    quoteId: number,
    serverRenewalQuoteCount: number,
    countedQuoteIds: Set<number>,
  ): void {
    if (
      this.snapshot.sourceOrderId !== sourceOrderId ||
      countedQuoteIds.has(quoteId) ||
      !isPositiveSafeInteger(quoteId)
    ) {
      return;
    }
    countedQuoteIds.add(quoteId);
    this.update({ visibleRenewalQuoteCount: serverRenewalQuoteCount + countedQuoteIds.size });
  }

  private update(patch: Partial<RenewalControllerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private notifyProgress(completed: number, total: number): void {
    const existing = this.progressStatusId;
    const status: StatusMessage = {
      id: existing ?? randomRunId(),
      kind: 'info',
      message: `Creating renewal quotations (${completed} of ${total})…`,
      detail: 'Keep this Odoo tab open.',
      dismissAfterMs: 0,
    };
    this.progressStatusId = status.id;
    this.notify(status);
  }

  private dismissProgress(): void {
    if (!this.progressStatusId) return;
    this.statusStore.dismiss(this.progressStatusId);
    this.ownedStatusIds.delete(this.progressStatusId);
    this.progressStatusId = null;
  }

  private notifyPersistent(kind: 'warning' | 'error', message: string, detail?: string): void {
    this.notify(createStatusMessage(kind, message, { detail, dismissAfterMs: 0 }));
  }

  private notify(status: StatusMessage): void {
    const priority = status.kind === 'error' || status.kind === 'warning' ? 30 : 10;
    if (!this.statusStore.notify(status, priority)) return;
    this.ownedStatusIds.add(status.id);
    if (this.progressStatusId && status.id !== this.progressStatusId) {
      this.ownedStatusIds.delete(this.progressStatusId);
      this.progressStatusId = null;
    }
  }

  private clearOwnedStatus(): void {
    const current = this.statusStore.getSnapshot();
    if (current && this.ownedStatusIds.has(current.id)) this.statusStore.dismiss(current.id);
    this.ownedStatusIds.clear();
    this.progressStatusId = null;
  }
}
