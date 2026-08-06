import { installOdooBridge } from '../src/odoo/bridge-runtime';

export default defineContentScript({
  matches: ['https://www.odoo.com/odoo*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installOdooBridge(window);
  },
});
