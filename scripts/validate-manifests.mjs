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
    Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 2,
    `${target.browser}: exactly two content scripts are required.`,
  );
  for (const contentScript of manifest.content_scripts) {
    assert(
      JSON.stringify(contentScript.matches) === JSON.stringify([expectedMatch]),
      `${target.browser}: every content script must match only ${expectedMatch}.`,
    );
    assert(
      contentScript.all_frames === undefined || contentScript.all_frames === false,
      `${target.browser}: content scripts must run only in the top frame.`,
    );
  }
  const mainScripts = manifest.content_scripts.filter(
    (contentScript) => contentScript.world === 'MAIN',
  );
  const isolatedScripts = manifest.content_scripts.filter(
    (contentScript) => contentScript.world === undefined || contentScript.world === 'ISOLATED',
  );
  assert(
    mainScripts.length === 1 && mainScripts[0].run_at === 'document_start',
    `${target.browser}: one MAIN-world bridge must run at document_start.`,
  );
  assert(
    isolatedScripts.length === 1 && isolatedScripts[0].run_at === 'document_idle',
    `${target.browser}: one isolated UI script must run at document_idle.`,
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
