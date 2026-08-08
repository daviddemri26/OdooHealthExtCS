import { readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const releaseStatePath = path.join(projectRoot, 'store/release-state.json');
const packagePath = path.join(projectRoot, 'package.json');
const allowedStatuses = new Set([
  'pending-review',
  'ready-to-publish',
  'published',
  'action-required',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseVersion(version, label = 'version') {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  assert(match, `${label} must use the X.Y.Z format.`);
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left, 'Left version');
  const rightParts = parseVersion(right, 'Right version');
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  return 0;
}

export function validateReleaseState(state) {
  assert(state?.schemaVersion === 2, 'store/release-state.json must use schemaVersion 2.');
  parseVersion(state.initialVersion, 'Initial version');
  assert(
    state.policy === 'independent-store-publications',
    'The release policy must allow each published store to update independently.',
  );

  const chrome = state.stores?.chrome;
  const firefox = state.stores?.firefox;
  assert(chrome, 'Chrome release state is required.');
  assert(firefox, 'Firefox release state is required.');
  assert(
    /^[a-p]{32}$/.test(chrome.itemId),
    'Chrome itemId must be a 32-character public extension ID.',
  );
  assert(
    chrome.listingUrl.includes(chrome.itemId),
    'Chrome listingUrl must contain the configured itemId.',
  );
  assert(
    typeof firefox.addonId === 'string' && firefox.addonId.length > 0,
    'Firefox addonId is required.',
  );
  assert(
    firefox.listingUrl.startsWith('https://addons.mozilla.org/'),
    'Firefox listingUrl must use addons.mozilla.org.',
  );

  for (const [browser, store] of Object.entries(state.stores)) {
    assert(
      allowedStatuses.has(store.status),
      `${browser} status must be pending-review, ready-to-publish, published, or action-required.`,
    );
  }

  return state;
}

export function storeCanReceiveUpdates(state, browser) {
  assert(browser === 'chrome' || browser === 'firefox', `Unsupported store: ${browser}.`);
  return state.stores[browser].status === 'published';
}

export function anyStoreCanReceiveUpdates(state) {
  return storeCanReceiveUpdates(state, 'chrome') || storeCanReceiveUpdates(state, 'firefox');
}

export async function loadReleaseContext() {
  const [stateContents, packageContents] = await Promise.all([
    readFile(releaseStatePath, 'utf8'),
    readFile(packagePath, 'utf8'),
  ]);
  const state = validateReleaseState(JSON.parse(stateContents));
  const packageJson = JSON.parse(packageContents);
  parseVersion(packageJson.version, 'Package version');
  return { packageJson, state };
}

export function assertDevelopmentVersion({ packageJson, state }) {
  if (!anyStoreCanReceiveUpdates(state)) {
    assert(
      packageJson.version === state.initialVersion,
      `Keep package version ${state.initialVersion} until at least one initial store version is published.`,
    );
  }
}

export function assertReleaseUnlocked({ packageJson, state }) {
  assert(
    anyStoreCanReceiveUpdates(state),
    'Release is locked until at least one initial store status is changed to published.',
  );
  assert(
    compareVersions(packageJson.version, state.initialVersion) >= 0,
    `Package version cannot be older than initial version ${state.initialVersion}.`,
  );
}

export function assertReleaseTag({ packageJson, state }, tag) {
  assertReleaseUnlocked({ packageJson, state });
  assert(
    compareVersions(packageJson.version, state.initialVersion) > 0,
    `Automated store releases must be newer than initial version ${state.initialVersion}.`,
  );
  assert(
    tag === `v${packageJson.version}`,
    `Release tag ${tag} must match v${packageJson.version}.`,
  );
}

export function releaseStatusSummary({ packageJson, state }) {
  const chromeReady = storeCanReceiveUpdates(state, 'chrome');
  const firefoxReady = storeCanReceiveUpdates(state, 'firefox');
  return [
    `Development version: ${packageJson.version}`,
    `Initial store version: ${state.initialVersion}`,
    `Chrome: ${state.stores.chrome.status} (${state.stores.chrome.itemId}); automated updates ${chromeReady ? 'eligible' : 'blocked'}`,
    `Firefox: ${state.stores.firefox.status} (${state.stores.firefox.addonId}); automated updates ${firefoxReady ? 'eligible' : 'blocked'}`,
    `Version release gate: ${chromeReady || firefoxReady ? 'unlocked' : 'locked'}`,
  ].join('\n');
}
