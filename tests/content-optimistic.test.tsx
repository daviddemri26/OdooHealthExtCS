import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { patchSettings } = vi.hoisted(() => ({
  patchSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/shared/compatibility', () => ({
  setCompatibilityStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/shared/settings', () => ({ patchSettings }));

import { ContentApp } from '../src/content/ContentApp';
import { StatusStore } from '../src/content/status';
import { OdooGatewayError } from '../src/odoo/gateway';
import type { OdooFieldAnchor } from '../src/odoo/layout';
import type {
  HealthMutationResult,
  IndustryMutationResult,
} from '../src/odoo/customer-data-contracts';
import type { ExtensionSettings } from '../src/shared/types';
import { MockGateway } from './helpers/mock-gateway';

const settings: ExtensionSettings = {
  schemaVersion: 5,
  enabled: true,
  healthListPreview: true,
  features: { health: true, industry: true, renewals: false, shareLinks: false },
  successToasts: { health: true, industry: true, renewals: true, shareLinks: true },
  shareLinkTargets: { renewalQuotations: true, salesQuotations: true },
  renewalDefaults: { discountTenthsByYears: { 1: 0, 2: 30, 3: 60, 4: 80, 5: 100 } },
  appearance: 'dark',
};

const anchor: OdooFieldAnchor = {
  top: 0,
  left: 300,
  maxWidth: 440,
  labelWidth: 64,
  columnGap: 8,
  rowGap: 4,
  fontFamily: 'Arial',
  fontSize: '14px',
  lineHeight: '21px',
  labelColor: '#aaa',
  valueColor: '#fff',
  linkColor: '#00a09d',
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function configuredGateway(): MockGateway {
  const gateway = new MockGateway();
  gateway.fields['sale.order'] = { tag_ids: { type: 'many2many', relation: 'crm.tag' } };
  gateway.fields['res.partner'] = {
    industry_id: { type: 'many2one', relation: 'res.partner.industry' },
  };
  gateway.reads['sale.order'] = [
    {
      id: 42,
      tag_ids: [11],
      partner_id: [81, 'Demo Customer'],
      subscription_state: 'in_progress',
    },
  ];
  gateway.reads['res.partner'] = [{ id: 81, industry_id: [2, 'Education'] }];
  gateway.searches['crm.tag'] = [
    { id: 11, name: 'Health - High' },
    { id: 12, name: 'Health - Medium' },
    { id: 13, name: 'Health - Low' },
  ];
  gateway.searches['res.partner.industry'] = [
    { id: 2, name: 'Education' },
    { id: 3, name: 'Technology' },
  ];
  return gateway;
}

function renderContent(
  gateway: MockGateway,
  appSettings: ExtensionSettings = settings,
  statusStore?: StatusStore,
): {
  panel: HTMLDivElement;
  unmount: () => void;
  invalidateRoute: (recordId: number) => void;
  rerenderRoute: (recordId: number) => void;
} {
  const panel = document.createElement('div');
  document.body.append(panel);
  let activeRecordId = 42;
  const isRouteCurrent = (candidate: { recordId: number }): boolean =>
    candidate.recordId === activeRecordId;
  const view = render(
    <ContentApp
      gateway={gateway}
      route={{ model: 'sale.order', recordId: 42, pathname: '/odoo/sale.order/42' }}
      isRouteCurrent={isRouteCurrent}
      healthEligible
      industryEligible
      settings={appSettings}
      detectedTheme="dark"
      anchor={anchor}
      panelContainer={panel}
      statusStore={statusStore}
    />,
  );
  return {
    panel,
    invalidateRoute: (recordId) => {
      activeRecordId = recordId;
    },
    rerenderRoute: (recordId) => {
      activeRecordId = recordId;
      view.rerender(
        <ContentApp
          gateway={gateway}
          route={{
            model: 'sale.order',
            recordId,
            pathname: `/odoo/sale.order/${recordId}`,
          }}
          isRouteCurrent={isRouteCurrent}
          healthEligible
          industryEligible
          settings={appSettings}
          detectedTheme="dark"
          anchor={anchor}
          panelContainer={panel}
          statusStore={statusStore}
        />,
      );
    },
    unmount: () => {
      view.unmount();
      panel.remove();
    },
  };
}

describe('optimistic Odoo controls', () => {
  beforeEach(() => patchSettings.mockClear());

  it('keeps empty Health and a signed Industry partner available after form loading', async () => {
    const gateway = configuredGateway();
    gateway.reads['sale.order'] = [
      {
        id: 42,
        tag_ids: [],
        partner_id: [-81, 'Synthetic Customer'],
        subscription_state: 'in_progress',
      },
    ];
    gateway.reads['res.partner'] = [{ id: -81, industry_id: [2, 'Education'] }];
    const view = renderContent(gateway);
    try {
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('Not set'),
      );
      expect(within(view.panel).getByRole('button', { name: 'Education' })).toBeEnabled();
      expect(within(view.panel).getByRole('button', { name: 'Set health to Low' })).toBeEnabled();
      expect(document.querySelector('[role="status"]')).not.toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it('updates Health immediately and restores it when Odoo rejects the write', async () => {
    const gateway = configuredGateway();
    const mutation = deferred<HealthMutationResult>();
    gateway.applyHealthState = vi.fn(() => mutation.promise);
    const view = renderContent(gateway);
    try {
      expect(view.panel.querySelector('.native-field-stack')).not.toBeInTheDocument();
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
      expect(view.panel.querySelector('.native-field-stack')).toHaveClass(
        'native-field-stack-ready',
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to Low' }));
      expect(view.panel.querySelector('.health-current')).toHaveTextContent('Low');

      mutation.reject(new OdooGatewayError('server_error', 'Odoo could not complete the request.'));
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
    } finally {
      view.unmount();
    }
  });

  it('does not show a Health success toast when that preference is disabled', async () => {
    const gateway = configuredGateway();
    const applyHealthState = vi.spyOn(gateway, 'applyHealthState');
    const view = renderContent(gateway, {
      ...settings,
      features: { health: true, industry: false, renewals: false, shareLinks: false },
      successToasts: { health: false, industry: true, renewals: true, shareLinks: true },
    });
    try {
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to Low' }));
      await waitFor(() => expect(applyHealthState).toHaveBeenCalledOnce());
      expect(document.querySelector('[role="status"]')).not.toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it('keeps ownership of a higher-priority Health warning when success is rejected', async () => {
    const gateway = configuredGateway();
    gateway.reads['sale.order'] = [{ id: 42, tag_ids: [11, 12] }];
    const view = renderContent(gateway, {
      ...settings,
      features: { health: true, industry: false, renewals: false, shareLinks: false },
    });
    const warning = 'Multiple health tags were found. Choose one value to clean them up.';
    try {
      await waitFor(() => expect(document.body).toHaveTextContent(warning));
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to Low' }));
      await waitFor(() =>
        expect(gateway.customerDataCalls).toContainEqual({
          name: 'applyHealthState',
          sourceOrderId: 42,
          nextState: 'low',
        }),
      );
      expect(document.body).toHaveTextContent(warning);

      gateway.reads['sale.order'] = [{ id: 43, tag_ids: [13] }];
      view.rerenderRoute(43);
      await waitFor(() => expect(document.body).not.toHaveTextContent(warning));
    } finally {
      view.unmount();
    }
  });

  it('disables only the Health success toast from its confirmation action', async () => {
    const gateway = configuredGateway();
    const view = renderContent(gateway, {
      ...settings,
      successToasts: { health: true, industry: false, renewals: true, shareLinks: true },
    });
    try {
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to Low' }));
      const suppress = await within(document.body).findByRole('button', {
        name: "Don't show again",
      });
      fireEvent.click(suppress);
      await waitFor(() =>
        expect(patchSettings).toHaveBeenCalledWith({ successToasts: { health: false } }),
      );
    } finally {
      view.unmount();
    }
  });

  it('updates Industry immediately and restores it when Odoo rejects the write', async () => {
    const gateway = configuredGateway();
    const mutation = deferred<IndustryMutationResult>();
    gateway.applyIndustry = vi.fn(() => mutation.promise);
    const view = renderContent(gateway);
    try {
      await waitFor(() =>
        expect(within(view.panel).getByRole('button', { name: 'Education' })).toBeInTheDocument(),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Education' }));
      fireEvent.click(within(view.panel).getByRole('option', { name: 'Technology' }));
      expect(within(view.panel).getByRole('button', { name: 'Technology' })).toBeInTheDocument();

      mutation.reject(new OdooGatewayError('server_error', 'Odoo could not complete the request.'));
      await waitFor(() =>
        expect(within(view.panel).getByRole('button', { name: 'Education' })).toBeInTheDocument(),
      );
    } finally {
      view.unmount();
    }
  });

  it('does not restore stale Health UI or show an error after SPA navigation', async () => {
    const gateway = configuredGateway();
    const mutation = deferred<HealthMutationResult>();
    gateway.applyHealthState = vi.fn(() => mutation.promise);
    const view = renderContent(gateway, {
      ...settings,
      features: { health: true, industry: false, renewals: false, shareLinks: false },
    });
    try {
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to Low' }));

      gateway.reads['sale.order'] = [{ id: 43, tag_ids: [13] }];
      view.rerenderRoute(43);
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('Low'),
      );

      mutation.reject(new OdooGatewayError('server_error', 'Odoo could not complete the request.'));
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('Low'),
      );
      expect(document.querySelector('[role="alert"]')).not.toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it('does not restore stale Industry UI or show an error after SPA navigation', async () => {
    const gateway = configuredGateway();
    const mutation = deferred<IndustryMutationResult>();
    gateway.applyIndustry = vi.fn(() => mutation.promise);
    const view = renderContent(gateway, {
      ...settings,
      features: { health: false, industry: true, renewals: false, shareLinks: false },
    });
    try {
      await waitFor(() =>
        expect(within(view.panel).getByRole('button', { name: 'Education' })).toBeInTheDocument(),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Education' }));
      fireEvent.click(within(view.panel).getByRole('option', { name: 'Technology' }));

      gateway.reads['sale.order'] = [{ id: 43, partner_id: [82, 'New Customer'] }];
      gateway.reads['res.partner'] = [{ id: 82, industry_id: [3, 'Technology'] }];
      view.rerenderRoute(43);
      await waitFor(() =>
        expect(within(view.panel).getByRole('button', { name: 'Technology' })).toBeInTheDocument(),
      );

      mutation.reject(new OdooGatewayError('server_error', 'Odoo could not complete the request.'));
      await waitFor(() =>
        expect(within(view.panel).getByRole('button', { name: 'Technology' })).toBeInTheDocument(),
      );
      expect(document.querySelector('[role="alert"]')).not.toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it('unlocks Health on the new SPA record while the previous mutation is still pending', async () => {
    const gateway = configuredGateway();
    const staleMutation = deferred<HealthMutationResult>();
    const applyHealthState = vi
      .spyOn(gateway, 'applyHealthState')
      .mockImplementationOnce(() => staleMutation.promise)
      .mockResolvedValueOnce({
        sourceOrderId: 43,
        beforeHealthTagIds: [13],
        appliedHealthTagIds: [11],
        state: 'high',
      });
    const view = renderContent(gateway, {
      ...settings,
      features: { health: true, industry: false, renewals: false, shareLinks: false },
      successToasts: { ...settings.successToasts, health: false },
    });
    try {
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to Low' }));

      gateway.reads['sale.order'] = [{ id: 43, tag_ids: [13] }];
      view.rerenderRoute(43);
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('Low'),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to High' }));

      await waitFor(() => expect(applyHealthState).toHaveBeenCalledTimes(2));
      expect(applyHealthState).toHaveBeenLastCalledWith(43, 'high');
      expect(view.panel.querySelector('.health-current')).toHaveTextContent('High');

      staleMutation.resolve({
        sourceOrderId: 42,
        beforeHealthTagIds: [11],
        appliedHealthTagIds: [13],
        state: 'low',
      });
      await staleMutation.promise;
      expect(view.panel.querySelector('.health-current')).toHaveTextContent('High');
    } finally {
      view.unmount();
    }
  });

  it('unlocks Industry on the new SPA record while the previous mutation is still pending', async () => {
    const gateway = configuredGateway();
    const staleMutation = deferred<IndustryMutationResult>();
    const applyIndustry = vi
      .spyOn(gateway, 'applyIndustry')
      .mockImplementationOnce(() => staleMutation.promise)
      .mockResolvedValueOnce({
        sourceOrderId: 43,
        partnerId: 82,
        beforeIndustryId: 3,
        appliedIndustryId: 2,
      });
    const view = renderContent(gateway, {
      ...settings,
      features: { health: false, industry: true, renewals: false, shareLinks: false },
      successToasts: { ...settings.successToasts, industry: false },
    });
    try {
      await waitFor(() =>
        expect(within(view.panel).getByRole('button', { name: 'Education' })).toBeInTheDocument(),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Education' }));
      fireEvent.click(within(view.panel).getByRole('option', { name: 'Technology' }));

      gateway.reads['sale.order'] = [{ id: 43, partner_id: [82, 'New Customer'] }];
      gateway.reads['res.partner'] = [{ id: 82, industry_id: [3, 'Technology'] }];
      view.rerenderRoute(43);
      await waitFor(() =>
        expect(within(view.panel).getByRole('button', { name: 'Technology' })).toBeInTheDocument(),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Technology' }));
      fireEvent.click(within(view.panel).getByRole('option', { name: 'Education' }));

      await waitFor(() => expect(applyIndustry).toHaveBeenCalledTimes(2));
      expect(applyIndustry).toHaveBeenLastCalledWith(43, 82, 2);
      expect(within(view.panel).getByRole('button', { name: 'Education' })).toBeInTheDocument();

      staleMutation.resolve({
        sourceOrderId: 42,
        partnerId: 81,
        beforeIndustryId: 2,
        appliedIndustryId: 3,
      });
      await staleMutation.promise;
      expect(within(view.panel).getByRole('button', { name: 'Education' })).toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it('does not publish stale Health success or Undo after SPA navigation', async () => {
    const gateway = configuredGateway();
    const mutation = deferred<HealthMutationResult>();
    gateway.applyHealthState = vi.fn(() => mutation.promise);
    const statusStore = new StatusStore();
    const view = renderContent(
      gateway,
      {
        ...settings,
        features: { health: true, industry: false, renewals: false, shareLinks: false },
      },
      statusStore,
    );
    try {
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to Low' }));
      gateway.reads['sale.order'] = [{ id: 43, tag_ids: [13] }];
      view.rerenderRoute(43);

      mutation.resolve({
        sourceOrderId: 42,
        beforeHealthTagIds: [11],
        appliedHealthTagIds: [13],
        state: 'low',
      });
      await waitFor(() => expect(statusStore.getSnapshot()).toBeNull());
      expect(gateway.customerDataCalls).toHaveLength(0);
    } finally {
      view.unmount();
    }
  });

  it('rejects a stale Health completion before React rerenders the new SPA route', async () => {
    const gateway = configuredGateway();
    const mutation = deferred<HealthMutationResult>();
    gateway.applyHealthState = vi.fn(() => mutation.promise);
    const statusStore = new StatusStore();
    const view = renderContent(
      gateway,
      {
        ...settings,
        features: { health: true, industry: false, renewals: false, shareLinks: false },
      },
      statusStore,
    );
    try {
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to Low' }));
      view.invalidateRoute(43);

      mutation.resolve({
        sourceOrderId: 42,
        beforeHealthTagIds: [11],
        appliedHealthTagIds: [13],
        state: 'low',
      });
      await mutation.promise;
      await Promise.resolve();
      expect(gateway.applyHealthState).toHaveBeenCalledOnce();
      expect(statusStore.getSnapshot()).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('invalidates an already-present Health Undo action after SPA navigation', async () => {
    const gateway = configuredGateway();
    const statusStore = new StatusStore();
    const view = renderContent(
      gateway,
      {
        ...settings,
        features: { health: true, industry: false, renewals: false, shareLinks: false },
      },
      statusStore,
    );
    try {
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to Low' }));
      await waitFor(() => expect(statusStore.getSnapshot()?.action).toBeDefined());
      const staleUndo = statusStore.getSnapshot()?.action;

      gateway.reads['sale.order'] = [{ id: 43, tag_ids: [13] }];
      view.rerenderRoute(43);
      await waitFor(() => expect(statusStore.getSnapshot()).toBeNull());
      await staleUndo?.run();

      expect(gateway.customerDataCalls).toEqual([
        { name: 'applyHealthState', sourceOrderId: 42, nextState: 'low' },
      ]);
      expect(statusStore.getSnapshot()).toBeNull();
    } finally {
      view.unmount();
    }
  });
});
