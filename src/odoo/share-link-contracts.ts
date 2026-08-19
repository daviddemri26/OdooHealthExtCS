export type QuoteShareTarget = 'renewal_quotation' | 'sales_quotation';

export const QUOTE_SHARE_GATEWAY_TIMEOUT_MS = 30_000;
export const QUOTE_SHARE_RUNTIME_TIMEOUT_MS = 15_000;

export interface QuoteShareRoute {
  model: 'sale.order';
  recordId: number;
  pathname: string;
  target: QuoteShareTarget;
}

export interface QuoteShareEligibilityResult {
  quoteId: number;
  target: QuoteShareTarget;
  eligible: boolean;
}

export interface QuoteShareLinkResult {
  quoteId: number;
  target: QuoteShareTarget;
  shareLink: string;
}

export type QuoteShareBridgeOperation =
  | {
      name: 'inspectQuoteShareTarget';
      quoteId: number;
      target: QuoteShareTarget;
      pathname: string;
    }
  | {
      name: 'getQuoteShareLink';
      quoteId: number;
      target: QuoteShareTarget;
      pathname: string;
    };

export interface QuoteShareGateway {
  inspectQuoteShareTarget(
    quoteId: number,
    target: QuoteShareTarget,
    pathname: string,
  ): Promise<QuoteShareEligibilityResult>;
  getQuoteShareLink(
    quoteId: number,
    target: QuoteShareTarget,
    pathname: string,
  ): Promise<QuoteShareLinkResult>;
}
