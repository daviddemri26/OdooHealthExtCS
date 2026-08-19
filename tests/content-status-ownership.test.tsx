import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContentApp } from '../src/content/ContentApp';
import { createStatusMessage, StatusStore } from '../src/content/status';
import type { ExtensionSettings, SubscriptionRoute } from '../src/shared/types';
import { MockGateway } from './helpers/mock-gateway';

const settings: ExtensionSettings = {
  schemaVersion: 5,
  enabled: true,
  healthListPreview: false,
  features: { health: false, industry: false, renewals: true, shareLinks: false },
  successToasts: { health: true, industry: true, renewals: true, shareLinks: true },
  shareLinkTargets: { renewalQuotations: true, salesQuotations: true },
  renewalDefaults: { discountTenthsByYears: { 1: 0, 2: 30, 3: 60, 4: 80, 5: 100 } },
  appearance: 'dark',
};

function route(recordId: number): SubscriptionRoute {
  return {
    model: 'sale.order',
    recordId,
    pathname: `/odoo/subscriptions/${recordId}`,
  };
}

describe('ContentApp status ownership', () => {
  it('keeps a leased progress toast above ordinary success messages while errors stay visible', () => {
    const statusStore = new StatusStore();
    const progress = createStatusMessage('info', 'Creating renewal quotations (1 of 5)…', {
      dismissAfterMs: 0,
    });
    expect(statusStore.notify(progress, 10)).toBe(true);

    expect(statusStore.notify(createStatusMessage('success', 'Health updated.'))).toBe(false);
    expect(statusStore.getSnapshot()?.id).toBe(progress.id);

    const error = createStatusMessage('error', 'Odoo rejected the update.');
    expect(statusStore.notify(error)).toBe(true);
    expect(statusStore.getSnapshot()?.id).toBe(error.id);
  });

  it('does not dismiss a persistent Renewals progress toast on load or route changes', async () => {
    const statusStore = new StatusStore();
    const progress = createStatusMessage('info', 'Creating renewal quotations (2 of 5)…', {
      detail: 'Keep this Odoo tab open.',
      dismissAfterMs: 0,
    });
    statusStore.notify(progress);
    const panelContainer = document.createElement('div');
    document.body.append(panelContainer);

    const view = render(
      <ContentApp
        gateway={new MockGateway()}
        route={route(42)}
        isRouteCurrent={() => true}
        healthEligible
        industryEligible
        settings={settings}
        detectedTheme="dark"
        anchor={null}
        panelContainer={panelContainer}
        statusStore={statusStore}
      />,
    );

    await waitFor(() => expect(statusStore.getSnapshot()?.id).toBe(progress.id));
    expect(screen.getByText('Creating renewal quotations (2 of 5)…')).toBeInTheDocument();

    view.rerender(
      <ContentApp
        gateway={new MockGateway()}
        route={route(43)}
        isRouteCurrent={() => true}
        healthEligible
        industryEligible
        settings={settings}
        detectedTheme="dark"
        anchor={null}
        panelContainer={panelContainer}
        statusStore={statusStore}
      />,
    );

    await waitFor(() => expect(statusStore.getSnapshot()?.id).toBe(progress.id));
    expect(screen.getByText('Keep this Odoo tab open.')).toBeInTheDocument();

    view.rerender(
      <ContentApp
        gateway={new MockGateway()}
        route={route(43)}
        isRouteCurrent={() => true}
        healthEligible
        industryEligible
        settings={{ ...settings, enabled: false }}
        detectedTheme="dark"
        anchor={null}
        panelContainer={panelContainer}
        statusStore={statusStore}
      />,
    );

    expect(screen.getByText('Creating renewal quotations (2 of 5)…')).toBeInTheDocument();
    expect(screen.getByText('Keep this Odoo tab open.')).toBeInTheDocument();
    panelContainer.remove();
  });
});
