import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { createStatusMessage, StatusStore } from '../../content/status';
import { OdooGatewayError } from '../../odoo/gateway';
import type { OdooFieldAnchor } from '../../odoo/layout';
import type { QuoteShareGateway, QuoteShareRoute } from '../../odoo/share-link-contracts';
import { patchSettings } from '../../shared/settings';
import type { ExtensionSettings } from '../../shared/types';

interface QuoteShareControlProps {
  gateway: QuoteShareGateway;
  route: QuoteShareRoute;
  isRouteCurrent: (route: QuoteShareRoute) => boolean;
  settings: ExtensionSettings;
  theme: 'light' | 'dark';
  anchor: OdooFieldAnchor | null;
  panelContainer: HTMLElement;
  statusStore: StatusStore;
  clipboard?: Pick<Clipboard, 'writeText'>;
}

function isTargetEnabled(settings: ExtensionSettings, route: QuoteShareRoute): boolean {
  return route.target === 'renewal_quotation'
    ? settings.shareLinkTargets.renewalQuotations
    : settings.shareLinkTargets.salesQuotations;
}

function panelStyle(anchor: OdooFieldAnchor): CSSProperties {
  return {
    top: anchor.top,
    left: anchor.left,
    maxWidth: anchor.maxWidth,
    fontFamily: anchor.fontFamily,
    fontSize: anchor.fontSize,
    lineHeight: anchor.lineHeight,
    '--odoo-label-color': anchor.labelColor,
    '--odoo-value-color': anchor.valueColor,
    '--odoo-link-color': anchor.linkColor,
  } as CSSProperties;
}

export function QuoteShareControl({
  gateway,
  route,
  isRouteCurrent,
  settings,
  theme,
  anchor,
  panelContainer,
  statusStore,
  clipboard = navigator.clipboard,
}: QuoteShareControlProps): React.JSX.Element | null {
  const [eligible, setEligible] = useState(false);
  const [pending, setPending] = useState(false);
  const generationRef = useRef(0);
  const { recordId, pathname, target } = route;
  const routeSnapshot = useMemo(
    () => ({ model: 'sale.order' as const, recordId, pathname, target }),
    [pathname, recordId, target],
  );
  const configured =
    settings.enabled && settings.features.shareLinks && isTargetEnabled(settings, route);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setEligible(false);
    setPending(false);
    if (!configured) return;
    void gateway
      .inspectQuoteShareTarget(routeSnapshot.recordId, routeSnapshot.target, routeSnapshot.pathname)
      .then((result) => {
        if (
          generationRef.current === generation &&
          isRouteCurrent(routeSnapshot) &&
          result.quoteId === routeSnapshot.recordId &&
          result.target === routeSnapshot.target
        ) {
          setEligible(result.eligible);
        }
      })
      .catch(() => undefined);
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [configured, gateway, isRouteCurrent, routeSnapshot]);

  const copyShareLink = useCallback(async (): Promise<void> => {
    if (!eligible || pending || !isRouteCurrent(routeSnapshot)) return;
    const generation = generationRef.current;
    setPending(true);
    try {
      const result = await gateway.getQuoteShareLink(
        routeSnapshot.recordId,
        routeSnapshot.target,
        routeSnapshot.pathname,
      );
      if (generationRef.current !== generation || !isRouteCurrent(routeSnapshot)) return;
      await clipboard.writeText(result.shareLink);
      if (generationRef.current !== generation || !isRouteCurrent(routeSnapshot)) return;
      if (settings.successToasts.shareLinks) {
        const message = createStatusMessage('success', 'Share link copied.', {
          dismissAfterMs: 7_000,
          suppressAction: {
            label: "Don't show again",
            run: async () => {
              try {
                await patchSettings({ successToasts: { shareLinks: false } });
                statusStore.dismiss(message.id);
              } catch {
                statusStore.notify(
                  createStatusMessage('error', 'The confirmation preference could not be saved.'),
                );
              }
            },
          },
        });
        statusStore.notify(message);
      }
    } catch (error) {
      if (generationRef.current !== generation || !isRouteCurrent(routeSnapshot)) return;
      const message =
        error instanceof OdooGatewayError
          ? error.message
          : 'The share link could not be copied to the clipboard.';
      statusStore.notify(createStatusMessage('error', message));
    } finally {
      if (generationRef.current === generation && isRouteCurrent(routeSnapshot)) setPending(false);
    }
  }, [clipboard, eligible, gateway, isRouteCurrent, pending, routeSnapshot, settings, statusStore]);

  const content = useMemo(() => {
    if (!configured || !eligible || !anchor) return null;
    return (
      <div className={`extension-shell theme-${theme}`} data-theme={theme}>
        <section
          className="native-field-stack native-field-stack-ready quote-share-stack"
          style={panelStyle(anchor)}
          aria-label="Quote share link"
        >
          <button
            type="button"
            className="quote-share-button"
            aria-label="Copy share link"
            title="Copy share link"
            aria-busy={pending}
            disabled={pending}
            onClick={() => void copyShareLink()}
          >
            {pending ? (
              <span className="quote-share-spinner" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="18" cy="5" r="2.5" />
                <circle cx="6" cy="12" r="2.5" />
                <circle cx="18" cy="19" r="2.5" />
                <path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" />
              </svg>
            )}
          </button>
        </section>
      </div>
    );
  }, [anchor, configured, copyShareLink, eligible, pending, theme]);

  return content ? createPortal(content, panelContainer) : null;
}
