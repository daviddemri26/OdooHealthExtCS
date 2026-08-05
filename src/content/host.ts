export interface ExtensionHost {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  container: HTMLDivElement;
}

export function createExtensionHost(
  rootId: string,
  styles: string,
  documentRoot: Document = document,
): ExtensionHost {
  documentRoot.getElementById(rootId)?.remove();

  const host = documentRoot.createElement('div');
  host.id = rootId;
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483000';
  host.style.pointerEvents = 'none';
  host.setAttribute('data-extension', 'OdooHealthExtCS');

  const shadow = host.attachShadow({ mode: 'open' });
  const style = documentRoot.createElement('style');
  style.textContent = styles;
  const container = documentRoot.createElement('div');
  shadow.append(style, container);
  documentRoot.documentElement.append(host);

  return { host, shadow, container };
}
