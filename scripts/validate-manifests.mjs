import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const targets = [
  { browser: 'chrome', directory: '.output/chrome-mv3' },
  { browser: 'firefox', directory: '.output/firefox-mv3' },
];
const expectedMatch = 'https://www.odoo.com/odoo*';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const target of targets) {
  const manifestPath = path.join(projectRoot, target.directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  assert(manifest.manifest_version === 3, `${target.browser}: manifest_version must be 3.`);
  assert(manifest.background === undefined, `${target.browser}: no background process is allowed.`);
  assert(
    Array.isArray(manifest.permissions) &&
      manifest.permissions.length === 1 &&
      manifest.permissions[0] === 'storage',
    `${target.browser}: storage must be the only API permission.`,
  );
  assert(
    manifest.host_permissions === undefined || manifest.host_permissions.length === 0,
    `${target.browser}: broad host_permissions are not allowed.`,
  );
  assert(
    Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 1,
    `${target.browser}: exactly one content script is required.`,
  );
  assert(
    JSON.stringify(manifest.content_scripts[0].matches) === JSON.stringify([expectedMatch]),
    `${target.browser}: content script must match only ${expectedMatch}.`,
  );

  if (target.browser === 'firefox') {
    assert(
      manifest.browser_specific_settings?.gecko?.id === 'odoo-health-ext-cs@daviddemri26.github.io',
      'firefox: a stable extension ID is required.',
    );
    assert(
      manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required?.[0] ===
        'none',
      'firefox: the no-data-collection declaration is required.',
    );
  }

  for (const iconPath of Object.values(manifest.icons ?? {})) {
    await access(path.join(projectRoot, target.directory, iconPath));
  }

  process.stdout.write(`Validated ${target.browser} MV3 manifest.\n`);
}
