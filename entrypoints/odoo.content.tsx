import { createRoot, type Root } from 'react-dom/client';

import { ContentApp } from '../src/content/ContentApp';
import { attachPanelHost, createExtensionHost } from '../src/content/host';
import contentStyles from '../src/content/styles.css?inline';
import { isRenderedSubscriptionForm, parseSubscriptionRoute } from '../src/odoo/routes';
import { PageContextOdooGateway } from '../src/odoo/gateway';
import { measureOrderDateAnchor } from '../src/odoo/layout';
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
    document.querySelector<HTMLElement>('.o_form_view .o_form_sheet') ??
    document.querySelector<HTMLElement>('.o_form_view .o_form_sheet_bg') ??
    document.querySelector<HTMLElement>('.o_web_client') ??
    document.body;
  const color = parseColor(getComputedStyle(sample).backgroundColor);
  if (!color) return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const [red, green, blue] = color;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance < 0.48 ? 'dark' : 'light';
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
    const { host, container, panelHost, panelContainer } = createExtensionHost(
      ROOT_ID,
      contentStyles,
    );
    const gateway = new PageContextOdooGateway();

    const root: Root = createRoot(container);
    let settings: ExtensionSettings = DEFAULT_SETTINGS;
    let lastHref = window.location.href;
    let scheduled = 0;

    const render = (): void => {
      const route = getActiveRoute();
      if (route) attachPanelHost(panelHost);
      else panelHost.style.display = 'none';
      root.render(
        <ContentApp
          gateway={gateway}
          route={route}
          settings={settings}
          detectedTheme={detectOdooTheme()}
          anchor={route ? measureOrderDateAnchor() : null}
          panelContainer={panelContainer}
        />,
      );
    };

    const scheduleRender = (): void => {
      if (scheduled) return;
      scheduled = window.setTimeout(() => {
        scheduled = 0;
        render();
      }, 90);
    };

    const renderNow = (): void => {
      window.clearTimeout(scheduled);
      scheduled = 0;
      render();
    };

    const initialize = async (): Promise<void> => {
      try {
        settings = await getSettings();
      } catch {
        settings = DEFAULT_SETTINGS;
      }
      renderNow();
    };

    const observer = new MutationObserver(scheduleRender);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    const routeInterval = window.setInterval(() => {
      if (window.location.href === lastHref) return;
      lastHref = window.location.href;
      scheduleRender();
    }, 500);

    const unsubscribe = subscribeToSettings((nextSettings) => {
      settings = nextSettings;
      renderNow();
    });

    window.addEventListener('popstate', scheduleRender);
    window.addEventListener('hashchange', scheduleRender);
    window.addEventListener('resize', scheduleRender);
    const colorScheme = matchMedia('(prefers-color-scheme: dark)');
    colorScheme.addEventListener('change', scheduleRender);

    void initialize();

    ctx.onInvalidated(() => {
      gateway.dispose();
      observer.disconnect();
      window.clearInterval(routeInterval);
      window.clearTimeout(scheduled);
      unsubscribe();
      window.removeEventListener('popstate', scheduleRender);
      window.removeEventListener('hashchange', scheduleRender);
      window.removeEventListener('resize', scheduleRender);
      colorScheme.removeEventListener('change', scheduleRender);
      root.unmount();
      panelHost.remove();
      host.remove();
    });
  },
});
