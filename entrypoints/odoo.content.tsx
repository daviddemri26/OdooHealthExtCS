import { createRoot, type Root } from 'react-dom/client';
import { browser } from 'wxt/browser';

import { ContentApp } from '../src/content/ContentApp';
import { attachPanelHost, createExtensionHost } from '../src/content/host';
import { StatusStore } from '../src/content/status';
import contentStyles from '../src/content/styles.css?inline';
import { isHealthEligibleSubscription } from '../src/features/health/eligibility';
import { SubscriptionListHealthPreview } from '../src/features/health/list-preview';
import { isIndustryEligibleSubscription } from '../src/features/industry/eligibility';
import { RenewalController } from '../src/features/renewals/controller';
import {
  attachRenewalButtonHost,
  findNativeRenewButton,
  type RenewalButtonHost,
} from '../src/features/renewals/native-host';
import { RenewalQuoteSmartButtonManager } from '../src/features/renewals/smart-button';
import { RenewalPopover } from '../src/features/renewals/RenewalPopover';
import { QuoteShareControl } from '../src/features/share-links/QuoteShareControl';
import {
  getRenderedQuoteShareRoute,
  getRenderedSubscriptionRoute,
  isExactQuoteShareRoute,
  isExactSubscriptionRoute,
  parseSubscriptionRoute,
} from '../src/odoo/routes';
import { OdooGatewayError, PageContextOdooGateway } from '../src/odoo/gateway';
import { measureOrderDateAnchor } from '../src/odoo/layout';
import { setCompatibilityStatus } from '../src/shared/compatibility';
import {
  isLiveConnectionRequest,
  type LiveConnectionIdentity,
} from '../src/shared/live-connection';
import { DEFAULT_SETTINGS, getSettings, subscribeToSettings } from '../src/shared/settings';
import type { ConnectionCode, ExtensionSettings, SubscriptionRoute } from '../src/shared/types';
import type { QuoteShareRoute } from '../src/odoo/share-link-contracts';

const ROOT_ID = 'odoo-health-ext-cs-root';
const RENEWAL_BUTTON_ROOT_ID = `${ROOT_ID}-renewal-button`;
const CONNECTION_CODES = new Set<ConnectionCode>([
  'bridge_unavailable',
  'timeout',
  'network',
  'session_expired',
  'access_denied',
  'incompatible_endpoint',
  'incompatible_response',
  'server_error',
]);

function getConnectionFailureCode(error: unknown): ConnectionCode {
  if (error instanceof OdooGatewayError && CONNECTION_CODES.has(error.code as ConnectionCode)) {
    return error.code as ConnectionCode;
  }
  return 'server_error';
}

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
  return getRenderedSubscriptionRoute(window.location);
}

function getActiveQuoteShareRoute(): QuoteShareRoute | null {
  return getRenderedQuoteShareRoute(window.location);
}

function isQuoteShareTargetEnabled(settings: ExtensionSettings, route: QuoteShareRoute): boolean {
  return route.target === 'renewal_quotation'
    ? settings.shareLinkTargets.renewalQuotations
    : settings.shareLinkTargets.salesQuotations;
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
    const listHealthPreview = new SubscriptionListHealthPreview(gateway);
    const statusStore = new StatusStore();
    let active = true;
    let renewalSourcePathname: string | null = null;
    const renewalController = new RenewalController({
      gateway,
      statusStore,
      isSourceActive: (sourceOrderId) => {
        if (!active) return false;
        const route = parseSubscriptionRoute(window.location);
        return isExactSubscriptionRoute(route, sourceOrderId, renewalSourcePathname);
      },
    });
    const renewalQuoteSmartButton = new RenewalQuoteSmartButtonManager();
    const isCurrentSubscriptionRoute = (candidate: SubscriptionRoute): boolean =>
      isExactSubscriptionRoute(
        parseSubscriptionRoute(window.location),
        candidate.recordId,
        candidate.pathname,
      );
    const isCurrentQuoteShareRoute = (candidate: QuoteShareRoute): boolean =>
      isExactQuoteShareRoute(getRenderedQuoteShareRoute(window.location), candidate);

    const root: Root = createRoot(container);
    let settings: ExtensionSettings = DEFAULT_SETTINGS;
    let settingsReady = false;
    let lastHref = window.location.href;
    let scheduled = 0;
    let connectionCheckSequence = 0;
    let liveConnectionIdentity: LiveConnectionIdentity | null = null;
    let renewalButtonHost: RenewalButtonHost | null = null;

    const removeRenewalButtonHost = (): void => {
      renewalButtonHost?.detach();
      renewalButtonHost = null;
    };

    const syncRenewalButtonHost = (visible: boolean): RenewalButtonHost | null => {
      if (!visible) {
        removeRenewalButtonHost();
        return null;
      }

      const sourceButton = findNativeRenewButton();
      if (!sourceButton) {
        removeRenewalButtonHost();
        return null;
      }
      if (renewalButtonHost?.host.isConnected && renewalButtonHost.sourceButton === sourceButton) {
        return renewalButtonHost;
      }

      removeRenewalButtonHost();
      renewalButtonHost = attachRenewalButtonHost(RENEWAL_BUTTON_ROOT_ID, '');
      return renewalButtonHost;
    };

    const refreshConnectionStatus = async (): Promise<void> => {
      const sequence = ++connectionCheckSequence;
      let ok = true;
      let code: ConnectionCode = 'ready';
      try {
        const result = await gateway.checkConnection();
        liveConnectionIdentity = result.userDisplayName
          ? { userDisplayName: result.userDisplayName }
          : null;
      } catch (error) {
        ok = false;
        code = getConnectionFailureCode(error);
        liveConnectionIdentity = null;
      }
      if (!active || sequence !== connectionCheckSequence) return;
      try {
        await setCompatibilityStatus(ok, code);
      } catch {
        // Connection status is informational and must never block the extension UI.
      }
    };

    const render = (): void => {
      const route = getActiveRoute();
      const quoteShareRoute = getActiveQuoteShareRoute();
      const healthEligible = Boolean(route && isHealthEligibleSubscription());
      const industryEligible = Boolean(route && isIndustryEligibleSubscription());
      const customerDataRoute = route && (healthEligible || industryEligible) ? route : null;
      const configuredRenewals = Boolean(
        route && settingsReady && settings.enabled && settings.features.renewals,
      );
      const configuredQuoteShareRoute =
        quoteShareRoute &&
        settingsReady &&
        settings.enabled &&
        settings.features.shareLinks &&
        isQuoteShareTargetEnabled(settings, quoteShareRoute)
          ? quoteShareRoute
          : null;
      const currentRenewal = renewalController.getSnapshot();
      const renewalRunInFlight =
        currentRenewal.phase === 'preflight' || currentRenewal.phase === 'running';
      const renewalSessionRetained =
        currentRenewal.sourceOrderId !== null &&
        (renewalRunInFlight ||
          currentRenewal.draftFrozen ||
          currentRenewal.phase === 'success' ||
          currentRenewal.phase === 'partial' ||
          currentRenewal.phase === 'unknown');
      const renewalContextMatches = Boolean(
        route &&
        currentRenewal.sourceOrderId === route.recordId &&
        renewalSourcePathname === route.pathname,
      );

      if (configuredRenewals && route) {
        if (!renewalRunInFlight || renewalContextMatches) {
          if (!renewalContextMatches) {
            renewalController.clear();
            renewalSourcePathname = route.pathname;
          }
          renewalController.configure({
            sourceOrderId: route.recordId,
            discountTenthsByYears: settings.renewalDefaults.discountTenthsByYears,
            showSuccessConfirmation: settings.successToasts.renewals,
          });
        }
      } else if (!renewalRunInFlight && (!renewalSessionRetained || !renewalContextMatches)) {
        renewalController.clear();
        renewalSourcePathname = null;
      }

      const renewalSnapshot = renewalController.getSnapshot();
      const renewalBelongsToRoute = Boolean(
        route &&
        renewalSnapshot.sourceOrderId === route.recordId &&
        renewalSourcePathname === route.pathname,
      );
      const renewalHost = syncRenewalButtonHost(
        configuredRenewals && renewalBelongsToRoute && renewalSnapshot.eligibility === 'eligible',
      );
      renewalQuoteSmartButton.sync({
        enabled: renewalBelongsToRoute && (configuredRenewals || renewalRunInFlight),
        sourceOrderId: renewalBelongsToRoute ? renewalSnapshot.sourceOrderId : null,
        visibleRenewalQuoteCount: renewalSnapshot.visibleRenewalQuoteCount,
      });
      void listHealthPreview.sync(settingsReady && settings.enabled && settings.healthListPreview);
      if (customerDataRoute || configuredQuoteShareRoute) attachPanelHost(panelHost);
      else panelHost.style.display = 'none';
      const theme = settings.appearance === 'auto' ? detectOdooTheme() : settings.appearance;
      root.render(
        <>
          <ContentApp
            gateway={gateway}
            route={customerDataRoute}
            isRouteCurrent={isCurrentSubscriptionRoute}
            healthEligible={healthEligible}
            industryEligible={industryEligible}
            settings={settings}
            detectedTheme={detectOdooTheme()}
            anchor={customerDataRoute ? measureOrderDateAnchor() : null}
            panelContainer={panelContainer}
            statusStore={statusStore}
          />
          {configuredQuoteShareRoute ? (
            <QuoteShareControl
              gateway={gateway}
              route={configuredQuoteShareRoute}
              isRouteCurrent={isCurrentQuoteShareRoute}
              settings={settings}
              theme={theme}
              anchor={measureOrderDateAnchor()}
              panelContainer={panelContainer}
              statusStore={statusStore}
            />
          ) : null}
          {renewalHost && renewalBelongsToRoute ? (
            <RenewalPopover
              controller={renewalController}
              caretContainer={renewalHost.container}
              theme={theme}
              routeKey={`${route?.recordId ?? 'none'}:${route?.pathname ?? ''}`}
            />
          ) : null}
        </>,
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
      settingsReady = true;
      renderNow();
    };

    const observer = new MutationObserver(scheduleRender);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['class', 'style'],
    });

    const routeInterval = window.setInterval(() => {
      if (window.location.href === lastHref) return;
      lastHref = window.location.href;
      listHealthPreview.invalidate();
      scheduleRender();
      void refreshConnectionStatus();
    }, 500);

    const unsubscribe = subscribeToSettings((nextSettings) => {
      settings = nextSettings;
      settingsReady = true;
      renderNow();
    });
    const unsubscribeRenewals = renewalController.subscribe(scheduleRender);

    const handleRuntimeMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
      message,
      sender,
      sendResponse,
    ) => {
      if (!isLiveConnectionRequest(message)) return undefined;
      if (sender.id && sender.id !== browser.runtime.id) return undefined;

      // Firefox does not reliably treat a plain synchronous object returned by an
      // onMessage listener as the message response. Keep the channel open and use
      // sendResponse explicitly so both Firefox and Chromium receive the same
      // freshly checked identity.
      void gateway
        .checkConnection()
        .then((result) => {
          liveConnectionIdentity = result.userDisplayName
            ? { userDisplayName: result.userDisplayName }
            : null;
          sendResponse(liveConnectionIdentity);
        })
        .catch(() => {
          liveConnectionIdentity = null;
          sendResponse(null);
        });
      return true;
    };
    browser.runtime.onMessage.addListener(handleRuntimeMessage);

    const handleSpaNavigation = (): void => {
      listHealthPreview.invalidate();
      scheduleRender();
    };
    window.addEventListener('popstate', handleSpaNavigation);
    window.addEventListener('hashchange', handleSpaNavigation);
    window.addEventListener('resize', scheduleRender);
    const colorScheme = matchMedia('(prefers-color-scheme: dark)');
    colorScheme.addEventListener('change', scheduleRender);
    const handleOnline = (): void => void refreshConnectionStatus();
    window.addEventListener('online', handleOnline);

    void initialize();
    void refreshConnectionStatus();

    ctx.onInvalidated(() => {
      active = false;
      connectionCheckSequence += 1;
      listHealthPreview.destroy();
      renewalController.dispose();
      renewalQuoteSmartButton.detach();
      gateway.dispose();
      observer.disconnect();
      window.clearInterval(routeInterval);
      window.clearTimeout(scheduled);
      unsubscribe();
      unsubscribeRenewals();
      browser.runtime.onMessage.removeListener(handleRuntimeMessage);
      window.removeEventListener('popstate', handleSpaNavigation);
      window.removeEventListener('hashchange', handleSpaNavigation);
      window.removeEventListener('resize', scheduleRender);
      window.removeEventListener('online', handleOnline);
      colorScheme.removeEventListener('change', scheduleRender);
      root.unmount();
      removeRenewalButtonHost();
      panelHost.remove();
      host.remove();
    });
  },
});
