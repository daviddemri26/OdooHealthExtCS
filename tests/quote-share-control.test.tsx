import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/shared/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/settings')>();
  return { ...actual, patchSettings: vi.fn().mockResolvedValue(undefined) };
});

import { StatusStore } from '../src/content/status';
import { QuoteShareControl } from '../src/features/share-links/QuoteShareControl';
import type { OdooFieldAnchor } from '../src/odoo/layout';
import type {
  QuoteShareEligibilityResult,
  QuoteShareGateway,
  QuoteShareLinkResult,
  QuoteShareRoute,
  QuoteShareTarget,
} from '../src/odoo/share-link-contracts';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const anchor: OdooFieldAnchor = {
  top: 0,
  left: 320,
  maxWidth: 440,
  labelWidth: 64,
  columnGap: 8,
  rowGap: 4,
  fontFamily: 'Arial',
  fontSize: '14px',
  lineHeight: '21px',
  labelColor: '#555',
  valueColor: '#222',
  linkColor: '#00a09d',
};

const route: QuoteShareRoute = {
  model: 'sale.order',
  recordId: 42,
  pathname: '/odoo/sales/42',
  target: 'sales_quotation',
};

class MockQuoteShareGateway implements QuoteShareGateway {
  inspect =
    vi.fn<
      (
        quoteId: number,
        target: QuoteShareTarget,
        pathname: string,
      ) => Promise<QuoteShareEligibilityResult>
    >();
  getLink =
    vi.fn<
      (quoteId: number, target: QuoteShareTarget, pathname: string) => Promise<QuoteShareLinkResult>
    >();

  inspectQuoteShareTarget(
    quoteId: number,
    target: QuoteShareTarget,
    pathname: string,
  ): Promise<QuoteShareEligibilityResult> {
    return this.inspect(quoteId, target, pathname);
  }

  getQuoteShareLink(
    quoteId: number,
    target: QuoteShareTarget,
    pathname: string,
  ): Promise<QuoteShareLinkResult> {
    return this.getLink(quoteId, target, pathname);
  }
}

function enabledSettings(showToast = true) {
  return {
    ...DEFAULT_SETTINGS,
    features: { ...DEFAULT_SETTINGS.features, shareLinks: true },
    successToasts: { ...DEFAULT_SETTINGS.successToasts, shareLinks: showToast },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function renderControl(
  gateway: MockQuoteShareGateway,
  options: { showToast?: boolean; isCurrent?: () => boolean } = {},
) {
  const panel = document.createElement('div');
  document.body.append(panel);
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  const statusStore = new StatusStore();
  const view = render(
    <QuoteShareControl
      gateway={gateway}
      route={route}
      isRouteCurrent={() => options.isCurrent?.() ?? true}
      settings={enabledSettings(options.showToast ?? true)}
      theme="light"
      anchor={anchor}
      panelContainer={panel}
      statusStore={statusStore}
      clipboard={clipboard}
    />,
  );
  return { ...view, panel, clipboard, statusStore };
}

afterEach(() => cleanup());

describe('Quote Share control', () => {
  it('appears only after server eligibility and copies the returned link in one click', async () => {
    const gateway = new MockQuoteShareGateway();
    gateway.inspect.mockResolvedValue({ quoteId: 42, target: 'sales_quotation', eligible: true });
    const shareLink =
      'https://www.odoo.com/mail/view?model=sale.order&res_id=42&access_token=secret';
    gateway.getLink.mockResolvedValue({ quoteId: 42, target: 'sales_quotation', shareLink });
    const { clipboard, statusStore } = renderControl(gateway);

    const button = await screen.findByRole('button', { name: 'Copy share link' });
    fireEvent.click(button);
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(shareLink));
    expect(gateway.getLink).toHaveBeenCalledWith(42, 'sales_quotation', '/odoo/sales/42');
    expect(statusStore.getSnapshot()).toMatchObject({
      kind: 'success',
      message: 'Share link copied.',
    });
  });

  it('prevents duplicate requests while a copy is pending', async () => {
    const gateway = new MockQuoteShareGateway();
    gateway.inspect.mockResolvedValue({ quoteId: 42, target: 'sales_quotation', eligible: true });
    const pending = deferred<QuoteShareLinkResult>();
    gateway.getLink.mockReturnValue(pending.promise);
    const { clipboard } = renderControl(gateway);

    const button = await screen.findByRole('button', { name: 'Copy share link' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(gateway.getLink).toHaveBeenCalledOnce();
    pending.resolve({
      quoteId: 42,
      target: 'sales_quotation',
      shareLink: 'https://www.odoo.com/mail/view?model=sale.order&res_id=42&access_token=secret',
    });
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledOnce());
  });

  it('copies silently when success confirmations are disabled', async () => {
    const gateway = new MockQuoteShareGateway();
    gateway.inspect.mockResolvedValue({ quoteId: 42, target: 'sales_quotation', eligible: true });
    gateway.getLink.mockResolvedValue({
      quoteId: 42,
      target: 'sales_quotation',
      shareLink: 'https://www.odoo.com/mail/view?model=sale.order&res_id=42&access_token=secret',
    });
    const { clipboard, statusStore } = renderControl(gateway, { showToast: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy share link' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledOnce());
    expect(statusStore.getSnapshot()).toBeNull();
  });

  it('always reports copy errors even when success confirmations are disabled', async () => {
    const gateway = new MockQuoteShareGateway();
    gateway.inspect.mockResolvedValue({ quoteId: 42, target: 'sales_quotation', eligible: true });
    gateway.getLink.mockRejectedValue(new Error('clipboard unavailable'));
    const { statusStore } = renderControl(gateway, { showToast: false });

    fireEvent.click(await screen.findByRole('button', { name: 'Copy share link' }));
    await waitFor(() =>
      expect(statusStore.getSnapshot()).toMatchObject({
        kind: 'error',
        message: 'The share link could not be copied to the clipboard.',
      }),
    );
  });

  it('discards a completed request after SPA navigation', async () => {
    const gateway = new MockQuoteShareGateway();
    gateway.inspect.mockResolvedValue({ quoteId: 42, target: 'sales_quotation', eligible: true });
    const pending = deferred<QuoteShareLinkResult>();
    gateway.getLink.mockReturnValue(pending.promise);
    let current = true;
    const { clipboard, statusStore } = renderControl(gateway, { isCurrent: () => current });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy share link' }));
    current = false;
    pending.resolve({
      quoteId: 42,
      target: 'sales_quotation',
      shareLink: 'https://www.odoo.com/mail/view?model=sale.order&res_id=42&access_token=secret',
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(statusStore.getSnapshot()).toBeNull();
  });

  it('stays hidden when the server rejects the target', async () => {
    const gateway = new MockQuoteShareGateway();
    gateway.inspect.mockResolvedValue({ quoteId: 42, target: 'sales_quotation', eligible: false });
    renderControl(gateway);
    await waitFor(() => expect(gateway.inspect).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Copy share link' })).not.toBeInTheDocument();
  });
});
