import { beforeEach, describe, expect, it } from 'vitest';

import { attachPanelHost, createExtensionHost } from '../src/content/host';

describe('content host lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById('extension-test-root')?.remove();
    document.getElementById('extension-test-root-panel')?.remove();
  });

  it('isolates styles in Shadow DOM and never leaves duplicate roots', () => {
    const first = createExtensionHost('extension-test-root', '.control { color: green; }');
    const second = createExtensionHost('extension-test-root', '.control { color: purple; }');

    expect(first.host.isConnected).toBe(false);
    expect(second.host.isConnected).toBe(true);
    expect(document.querySelectorAll('#extension-test-root')).toHaveLength(1);
    expect(document.querySelectorAll('#extension-test-root-panel')).toHaveLength(1);
    expect(second.shadow.querySelector('style')).toHaveTextContent('color: purple');
    expect(second.container.parentNode).toBe(second.shadow);
    expect(second.panelContainer.parentNode).toBe(second.panelShadow);
    expect(second.panelHost).toHaveStyle({ display: 'none' });
  });

  it('attaches the panel host to the Odoo form sheet so it shares its scroll and stack', () => {
    document.body.innerHTML = `
      <main class="o_form_view">
        <section class="o_form_sheet modal-sheet"></section>
        <section class="o_form_sheet record-sheet"><div name="date_order"></div></section>
      </main>`;
    const extension = createExtensionHost('extension-test-root', '.control { color: green; }');
    const sheet = document.querySelector<HTMLElement>('.record-sheet')!;

    expect(attachPanelHost(extension.panelHost)).toBe(sheet);
    expect(extension.panelHost.parentElement).toBe(sheet);
    expect(extension.panelHost).toHaveStyle({
      display: 'block',
      position: 'absolute',
      zIndex: '2',
    });
  });
});
