import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { saveSettings } = vi.hoisted(() => ({
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/shared/compatibility', () => ({
  setCompatibilityStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/shared/settings', () => ({ saveSettings }));

import { ContentApp } from '../src/content/ContentApp';
import type { OdooFieldAnchor } from '../src/odoo/layout';
import type { ExtensionSettings } from '../src/shared/types';
import { MockGateway } from './helpers/mock-gateway';

const settings: ExtensionSettings = {
  schemaVersion: 3,
  enabled: true,
  healthListPreview: true,
  features: { health: true, industry: true },
  successToasts: { health: true, industry: true },
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
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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
): {
  panel: HTMLDivElement;
  unmount: () => void;
} {
  const panel = document.createElement('div');
  document.body.append(panel);
  const view = render(
    <ContentApp
      gateway={gateway}
      route={{ model: 'sale.order', recordId: 42, pathname: '/odoo/sale.order/42' }}
      settings={appSettings}
      detectedTheme="dark"
      anchor={anchor}
      panelContainer={panel}
    />,
  );
  return {
    panel,
    unmount: () => {
      view.unmount();
      panel.remove();
    },
  };
}

describe('optimistic Odoo controls', () => {
  beforeEach(() => saveSettings.mockClear());

  it('updates Health immediately and restores it when Odoo rejects the write', async () => {
    const gateway = configuredGateway();
    const write = deferred<boolean>();
    gateway.write = vi.fn(() => write.promise);
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

      write.resolve(false);
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
    } finally {
      view.unmount();
    }
  });

  it('does not show a Health success toast when that preference is disabled', async () => {
    const gateway = configuredGateway();
    gateway.write = vi.fn().mockResolvedValue(true);
    const view = renderContent(gateway, {
      ...settings,
      features: { health: true, industry: false },
      successToasts: { health: false, industry: true },
    });
    try {
      await waitFor(() =>
        expect(view.panel.querySelector('.health-current')).toHaveTextContent('High'),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Set health to Low' }));
      await waitFor(() => expect(gateway.write).toHaveBeenCalledOnce());
      expect(document.querySelector('[role="status"]')).not.toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it('disables only the Health success toast from its confirmation action', async () => {
    const gateway = configuredGateway();
    gateway.write = vi.fn().mockResolvedValue(true);
    const view = renderContent(gateway, {
      ...settings,
      successToasts: { health: true, industry: false },
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
        expect(saveSettings).toHaveBeenCalledWith({
          ...settings,
          successToasts: { health: false, industry: false },
        }),
      );
    } finally {
      view.unmount();
    }
  });

  it('updates Industry immediately and restores it when Odoo rejects the write', async () => {
    const gateway = configuredGateway();
    const write = deferred<boolean>();
    gateway.write = vi.fn(() => write.promise);
    const view = renderContent(gateway);
    try {
      await waitFor(() =>
        expect(within(view.panel).getByRole('button', { name: 'Education' })).toBeInTheDocument(),
      );
      fireEvent.click(within(view.panel).getByRole('button', { name: 'Education' }));
      fireEvent.click(within(view.panel).getByRole('option', { name: 'Technology' }));
      expect(within(view.panel).getByRole('button', { name: 'Technology' })).toBeInTheDocument();

      write.resolve(false);
      await waitFor(() =>
        expect(within(view.panel).getByRole('button', { name: 'Education' })).toBeInTheDocument(),
      );
    } finally {
      view.unmount();
    }
  });
});
