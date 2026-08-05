import { beforeEach, describe, expect, it } from 'vitest';

import { createExtensionHost } from '../src/content/host';

describe('content host lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById('extension-test-root')?.remove();
  });

  it('isolates styles in Shadow DOM and never leaves duplicate roots', () => {
    const first = createExtensionHost('extension-test-root', '.control { color: green; }');
    const second = createExtensionHost('extension-test-root', '.control { color: purple; }');

    expect(first.host.isConnected).toBe(false);
    expect(second.host.isConnected).toBe(true);
    expect(document.querySelectorAll('#extension-test-root')).toHaveLength(1);
    expect(second.shadow.querySelector('style')).toHaveTextContent('color: purple');
    expect(second.container.parentNode).toBe(second.shadow);
  });
});
