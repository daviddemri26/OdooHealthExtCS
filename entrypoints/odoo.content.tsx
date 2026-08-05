import { createRoot, type Root } from 'react-dom/client';

import { ContentApp, type AnchorPosition } from '../src/content/ContentApp';
import { createExtensionHost } from '../src/content/host';
import contentStyles from '../src/content/styles.css?inline';
import {
  findHealthAnchor,
  isRenderedSubscriptionForm,
  parseSubscriptionRoute,
} from '../src/odoo/routes';
import { DEFAULT_SETTINGS, getSettings, subscribeToSettings } from '../src/shared/settings';
import type { ExtensionSettings, SubscriptionRoute } from '../src/shared/types';

const ROOT_ID = 'odoo-health-ext-cs-root';

function parseColor(value: string): [number, number, number] | null {
  const match = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function detectOdooTheme(): 'light' | 'dark' {
  const sample =
    findHealthAnchor() ?? document.querySelector<HTMLElement>('.o_web_client') ?? document.body;
  const color = parseColor(getComputedStyle(sample).backgroundColor);
  if (!color) return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const [red, green, blue] = color;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance < 0.48 ? 'dark' : 'light';
}

function getAnchorPosition(): AnchorPosition {
  const anchor = findHealthAnchor();
  if (!anchor) return { top: 92, right: 28 };
  const bounds = anchor.getBoundingClientRect();
  return {
    top: Math.max(82, Math.min(bounds.top + 28, window.innerHeight - 170)),
    right: Math.max(24, window.innerWidth - bounds.right + 24),
  };
}

function getActiveRoute(): SubscriptionRoute | null {
  const route = parseSubscriptionRoute(window.location);
  if (!route || !isRenderedSubscriptionForm(route.pathname)) return null;
  return route;
}

export default defineContentScript({
  matches: ['https://www.odoo.com/odoo*'],
  runAt: 'document_idle',
  main(ctx) {
    const { host, container } = createExtensionHost(ROOT_ID, contentStyles);

    const root: Root = createRoot(container);
    let settings: ExtensionSettings = DEFAULT_SETTINGS;
    let lastHref = window.location.href;
    let scheduled = 0;

    const render = (): void => {
      root.render(
        <ContentApp
          route={getActiveRoute()}
          settings={settings}
          detectedTheme={detectOdooTheme()}
          anchor={getAnchorPosition()}
        />,
      );
    };

    const scheduleRender = (): void => {
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(render, 90);
    };

    const initialize = async (): Promise<void> => {
      settings = await getSettings();
      render();
    };

    const observer = new MutationObserver(scheduleRender);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    const routeInterval = window.setInterval(() => {
      if (window.location.href === lastHref) return;
      lastHref = window.location.href;
      scheduleRender();
    }, 500);

    const unsubscribe = subscribeToSettings((nextSettings) => {
      settings = nextSettings;
      render();
    });

    window.addEventListener('popstate', scheduleRender);
    window.addEventListener('hashchange', scheduleRender);
    window.addEventListener('resize', scheduleRender);
    window.addEventListener('scroll', scheduleRender, { passive: true });
    const colorScheme = matchMedia('(prefers-color-scheme: dark)');
    colorScheme.addEventListener('change', scheduleRender);

    void initialize();

    ctx.onInvalidated(() => {
      observer.disconnect();
      window.clearInterval(routeInterval);
      window.clearTimeout(scheduled);
      unsubscribe();
      window.removeEventListener('popstate', scheduleRender);
      window.removeEventListener('hashchange', scheduleRender);
      window.removeEventListener('resize', scheduleRender);
      window.removeEventListener('scroll', scheduleRender);
      colorScheme.removeEventListener('change', scheduleRender);
      root.unmount();
      host.remove();
    });
  },
});
