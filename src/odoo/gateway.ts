import type {
  CompatibilityCode,
  OdooDomain,
  OdooFieldDefinition,
  OdooGateway,
  OdooRecord,
} from '../shared/types';
import {
  ODOO_BRIDGE_CHANNEL,
  ODOO_BRIDGE_ORIGIN,
  ODOO_BRIDGE_VERSION,
  bridgeFailure,
  isOdooBridgeResponse,
  parseCustomerDataUndoResult,
  parseHealthMutationResult,
  parseIndustryMutationResult,
  parseRenewalCreatedQuoteResult,
  parseRenewalDiscountApplyResult,
  parseRenewalDiscountClearResult,
  parseRenewalPreflightResult,
  parseRenewalQuoteSummary,
  parseRenewalShareLinkResult,
  type OdooBridgeCall,
  type OdooConnectionProbeResult,
  type OdooBridgeRequest,
} from './bridge-protocol';
import {
  CUSTOMER_DATA_GATEWAY_TIMEOUT_MS,
  type CustomerDataBridgeOperation,
  type CustomerDataMutationGateway,
  type CustomerDataUndoResult,
  type HealthMutationResult,
  type IndustryMutationResult,
} from './customer-data-contracts';
import type {
  RenewalBridgeOperation,
  RenewalCreatedQuoteResult,
  RenewalDiscountApplyResult,
  RenewalDiscountClearResult,
  RenewalGateway,
  RenewalPreflightResponse,
  RenewalQuoteSummary,
  RenewalShareLinkResult,
  RenewalSourceFingerprint,
  RenewalTargetYears,
} from './renewal-contracts';
import { RENEWAL_GATEWAY_TIMEOUT_MS } from './renewal-contracts';

export { RENEWAL_GATEWAY_TIMEOUT_MS } from './renewal-contracts';

interface BridgeWindow {
  readonly location: Pick<Location, 'origin'>;
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: OdooGatewayError) => void;
  timeout: ReturnType<typeof globalThis.setTimeout>;
}

type OutboundBridgeRequest =
  | { kind: 'ping' }
  | { kind: 'probe' }
  | { kind: 'call'; call: OdooBridgeCall }
  | { kind: 'customerData'; operation: CustomerDataBridgeOperation }
  | { kind: 'renewal'; operation: RenewalBridgeOperation };

export class OdooGatewayError extends Error {
  constructor(
    public readonly code: CompatibilityCode,
    message: string,
  ) {
    super(message);
    this.name = 'OdooGatewayError';
  }
}

function randomIdentifier(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class PageContextOdooGateway
  implements OdooGateway, CustomerDataMutationGateway, RenewalGateway
{
  private readonly clientId = randomIdentifier('client');
  private readonly pending = new Map<string, PendingRequest>();
  private readonly handleMessageBound = (event: MessageEvent): void => this.handleMessage(event);
  private readyPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly messageWindow: BridgeWindow = window,
    private readonly timeoutMs = 15_000,
    private readonly bridgeReadyTimeoutMs = 1_500,
  ) {
    this.messageWindow.addEventListener('message', this.handleMessageBound);
  }

  async read<T extends OdooRecord>(model: string, ids: number[], fields: string[]): Promise<T[]> {
    return this.callKw<T[]>(model, 'read', [ids, fields], {});
  }

  async fieldsGet(
    model: string,
    fields: string[],
    attributes = ['type', 'relation', 'readonly', 'string'],
  ): Promise<Record<string, OdooFieldDefinition>> {
    return this.callKw(model, 'fields_get', [], {
      allfields: fields,
      attributes,
    });
  }

  async searchRead<T extends OdooRecord>(
    model: string,
    domain: OdooDomain,
    fields: string[],
    options: { limit?: number; order?: string } = {},
  ): Promise<T[]> {
    return this.callKw<T[]>(model, 'search_read', [domain], {
      fields,
      limit: options.limit ?? 100,
      ...(options.order ? { order: options.order } : {}),
    });
  }

  async applyHealthState(
    sourceOrderId: number,
    nextState: 'high' | 'medium' | 'low' | null,
  ): Promise<HealthMutationResult> {
    const result = await this.customerData({ name: 'applyHealthState', sourceOrderId, nextState });
    const parsed = parseHealthMutationResult(result, sourceOrderId);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async undoHealthState(
    sourceOrderId: number,
    expectedAppliedHealthTagIds: number[],
    restoreHealthTagIds: number[],
  ): Promise<CustomerDataUndoResult> {
    const result = await this.customerData({
      name: 'undoHealthState',
      sourceOrderId,
      expectedAppliedHealthTagIds,
      restoreHealthTagIds,
    });
    const parsed = parseCustomerDataUndoResult(result);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async applyIndustry(
    sourceOrderId: number,
    expectedPartnerId: number,
    nextIndustryId: number | null,
  ): Promise<IndustryMutationResult> {
    const result = await this.customerData({
      name: 'applyIndustry',
      sourceOrderId,
      expectedPartnerId,
      nextIndustryId,
    });
    const parsed = parseIndustryMutationResult(result, sourceOrderId, expectedPartnerId);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async undoIndustry(
    sourceOrderId: number,
    expectedPartnerId: number,
    expectedAppliedIndustryId: number | null,
    restoreIndustryId: number | null,
  ): Promise<CustomerDataUndoResult> {
    const result = await this.customerData({
      name: 'undoIndustry',
      sourceOrderId,
      expectedPartnerId,
      expectedAppliedIndustryId,
      restoreIndustryId,
    });
    const parsed = parseCustomerDataUndoResult(result);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async preflightRenewal(sourceOrderId: number): Promise<RenewalPreflightResponse> {
    const result = await this.renewal({ name: 'preflightRenewal', sourceOrderId });
    const parsed = parseRenewalPreflightResult(result, sourceOrderId);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async createNativeRenewal(
    sourceOrderId: number,
    runId: string,
    expected: RenewalSourceFingerprint,
    requiredCopyYears: RenewalTargetYears[],
    requiresDiscount: boolean,
  ): Promise<RenewalCreatedQuoteResult> {
    const result = await this.renewal({
      name: 'createNativeRenewal',
      sourceOrderId,
      runId,
      expected,
      requiredCopyYears,
      requiresDiscount,
    });
    const parsed = parseRenewalCreatedQuoteResult(result, sourceOrderId);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async copyNativePlan(
    sourceQuoteId: number,
    years: RenewalTargetYears,
    runId: string,
  ): Promise<RenewalCreatedQuoteResult> {
    const result = await this.renewal({
      name: 'copyNativePlan',
      sourceQuoteId,
      years,
      runId,
    });
    const parsed = parseRenewalCreatedQuoteResult(result, sourceQuoteId);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async clearNativeMultiYearDiscount(
    quoteId: number,
    runId: string,
  ): Promise<RenewalDiscountClearResult> {
    const result = await this.renewal({
      name: 'clearNativeMultiYearDiscount',
      quoteId,
      runId,
    });
    const parsed = parseRenewalDiscountClearResult(result);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async applyNativeGlobalDiscount(
    quoteId: number,
    percentageTenths: number,
    runId: string,
  ): Promise<RenewalDiscountApplyResult> {
    const result = await this.renewal({
      name: 'applyNativeGlobalDiscount',
      quoteId,
      percentageTenths,
      runId,
    });
    const parsed = parseRenewalDiscountApplyResult(result);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async getNativeShareLink(quoteId: number, runId: string): Promise<RenewalShareLinkResult> {
    const result = await this.renewal({
      name: 'getNativeShareLink',
      quoteId,
      runId,
    });
    const parsed = parseRenewalShareLinkResult(result, quoteId);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async readRenewalQuoteSummary(quoteId: number, runId: string): Promise<RenewalQuoteSummary> {
    const result = await this.renewal({
      name: 'readRenewalQuoteSummary',
      quoteId,
      runId,
    });
    const parsed = parseRenewalQuoteSummary(result, quoteId);
    if (!parsed) throw this.incompatibleResponse();
    return parsed;
  }

  async finishRenewalRun(runId: string): Promise<void> {
    const result = await this.renewal({ name: 'finishRenewalRun', runId });
    if (result !== true) throw this.incompatibleResponse();
  }

  async checkConnection(): Promise<OdooConnectionProbeResult> {
    await this.ensureReady();
    const result = await this.sendRequest({ kind: 'probe' }, this.timeoutMs, false);
    if (
      !result ||
      typeof result !== 'object' ||
      (result as { authenticated?: unknown }).authenticated !== true ||
      ('userDisplayName' in result &&
        typeof (result as { userDisplayName?: unknown }).userDisplayName !== 'string')
    ) {
      const failure = bridgeFailure('incompatible_response');
      throw new OdooGatewayError(failure.code, failure.message);
    }
    return result as OdooConnectionProbeResult;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.messageWindow.removeEventListener('message', this.handleMessageBound);
    const failure = bridgeFailure('bridge_unavailable');
    for (const request of this.pending.values()) {
      globalThis.clearTimeout(request.timeout);
      request.reject(new OdooGatewayError(failure.code, failure.message));
    }
    this.pending.clear();
    this.readyPromise = null;
  }

  private async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.sendRequest({ kind: 'ping' }, this.bridgeReadyTimeoutMs, true).then(
        () => undefined,
      );
    }
    try {
      await this.readyPromise;
    } catch (error) {
      this.readyPromise = null;
      throw error;
    }
  }

  private async callKw<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown>,
  ): Promise<T> {
    await this.ensureReady();
    const call: OdooBridgeCall = { model, method, args, kwargs };
    return (await this.sendRequest({ kind: 'call', call }, this.timeoutMs, false)) as T;
  }

  private async renewal(operation: RenewalBridgeOperation): Promise<unknown> {
    await this.ensureReady();
    return this.sendRequest(
      { kind: 'renewal', operation },
      Math.max(this.timeoutMs, RENEWAL_GATEWAY_TIMEOUT_MS),
      false,
    );
  }

  private async customerData(operation: CustomerDataBridgeOperation): Promise<unknown> {
    await this.ensureReady();
    return this.sendRequest(
      { kind: 'customerData', operation },
      Math.max(this.timeoutMs, CUSTOMER_DATA_GATEWAY_TIMEOUT_MS),
      false,
    );
  }

  private incompatibleResponse(): OdooGatewayError {
    const failure = bridgeFailure('incompatible_response');
    return new OdooGatewayError(failure.code, failure.message);
  }

  private sendRequest(
    requestBody: OutboundBridgeRequest,
    timeoutMs: number,
    isReadyCheck: boolean,
  ): Promise<unknown> {
    if (this.disposed || this.messageWindow.location.origin !== ODOO_BRIDGE_ORIGIN) {
      const failure = bridgeFailure('bridge_unavailable');
      return Promise.reject(new OdooGatewayError(failure.code, failure.message));
    }

    const requestId = randomIdentifier('request');
    const base = {
      channel: ODOO_BRIDGE_CHANNEL,
      version: ODOO_BRIDGE_VERSION,
      direction: 'request',
      clientId: this.clientId,
      requestId,
    } as const;
    let request: OdooBridgeRequest;
    if (requestBody.kind === 'call') {
      request = { ...base, kind: 'call', call: requestBody.call };
    } else if (requestBody.kind === 'customerData') {
      request = { ...base, kind: 'customerData', operation: requestBody.operation };
    } else if (requestBody.kind === 'renewal') {
      request = { ...base, kind: 'renewal', operation: requestBody.operation };
    } else {
      request = { ...base, kind: requestBody.kind };
    }

    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        this.pending.delete(requestId);
        const failure = bridgeFailure(isReadyCheck ? 'bridge_unavailable' : 'timeout');
        reject(new OdooGatewayError(failure.code, failure.message));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      try {
        this.messageWindow.postMessage(request, ODOO_BRIDGE_ORIGIN);
      } catch {
        globalThis.clearTimeout(timeout);
        this.pending.delete(requestId);
        const failure = bridgeFailure('bridge_unavailable');
        reject(new OdooGatewayError(failure.code, failure.message));
      }
    });
  }

  private handleMessage(event: MessageEvent): void {
    if (
      event.source !== (this.messageWindow as unknown as MessageEventSource) ||
      event.origin !== ODOO_BRIDGE_ORIGIN ||
      !isOdooBridgeResponse(event.data) ||
      event.data.clientId !== this.clientId
    ) {
      return;
    }

    const request = this.pending.get(event.data.requestId);
    if (!request) return;
    this.pending.delete(event.data.requestId);
    globalThis.clearTimeout(request.timeout);
    if (event.data.ok) {
      request.resolve(event.data.result);
    } else {
      request.reject(new OdooGatewayError(event.data.failure.code, event.data.failure.message));
    }
  }
}
