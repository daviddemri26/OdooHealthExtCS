import { defineConfig } from 'wxt';

const extensionName = 'OdooHealthExtCS';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: extensionName,
    short_name: extensionName,
    description: 'Fast account health and industry updates for Odoo Customer Success.',
    permissions: ['storage'],
    action: {
      default_title: `${extensionName} settings`,
    },
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      96: 'icons/icon-96.png',
      128: 'icons/icon-128.png',
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'odoo-health-ext-cs@daviddemri26.github.io',
              strict_min_version: '142.0',
              data_collection_permissions: {
                required: ['none'],
              },
            },
          },
        }
      : {}),
  }),
});
