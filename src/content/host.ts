import { findOrderDateAnchor } from '../odoo/routes';

export interface ExtensionHost {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  container: HTMLDivElement;
  panelHost: HTMLDivElement;
  panelShadow: ShadowRoot;
  panelContainer: HTMLDivElement;
}

function createShadowContainer(
  host: HTMLDivElement,
  styles: string,
  documentRoot: Document,
): { shadow: ShadowRoot; container: HTMLDivElement } {
  const shadow = host.attachShadow({ mode: 'open' });
  const style = documentRoot.createElement('style');
  style.textContent = styles;
  const container = documentRoot.createElement('div');
  shadow.append(style, container);
  return { shadow, container };
}

export function createExtensionHost(
  rootId: string,
  styles: string,
  documentRoot: Document = document,
): ExtensionHost {
  documentRoot.getElementById(rootId)?.remove();
  documentRoot.getElementById(`${rootId}-panel`)?.remove();

  const host = documentRoot.createElement('div');
  host.id = rootId;
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '1080';
  host.style.pointerEvents = 'none';
  host.setAttribute('data-extension', 'OdooHealthExtCS');

  const panelHost = documentRoot.createElement('div');
  panelHost.id = `${rootId}-panel`;
  panelHost.style.position = 'absolute';
  panelHost.style.inset = '0';
  panelHost.style.zIndex = '2';
  panelHost.style.display = 'none';
  panelHost.style.pointerEvents = 'none';
  panelHost.setAttribute('data-extension-panel', 'OdooHealthExtCS');

  const { shadow, container } = createShadowContainer(host, styles, documentRoot);
  const { shadow: panelShadow, container: panelContainer } = createShadowContainer(
    panelHost,
    styles,
    documentRoot,
  );
  documentRoot.documentElement.append(host);
  documentRoot.documentElement.append(panelHost);

  return { host, shadow, container, panelHost, panelShadow, panelContainer };
}

export function attachPanelHost(
  panelHost: HTMLDivElement,
  documentRoot: Document = document,
): HTMLElement | null {
  const sheet =
    findOrderDateAnchor(documentRoot)?.closest<HTMLElement>('.o_form_sheet') ??
    documentRoot.querySelector<HTMLElement>('.o_form_view .o_form_sheet');
  if (!sheet) {
    panelHost.style.display = 'none';
    return null;
  }
  if (panelHost.parentElement !== sheet) sheet.append(panelHost);
  panelHost.style.display = 'block';
  return sheet;
}
