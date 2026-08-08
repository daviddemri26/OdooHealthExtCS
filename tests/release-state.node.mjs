import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDevelopmentVersion,
  assertReleaseTag,
  assertReleaseUnlocked,
  anyStoreCanReceiveUpdates,
  compareVersions,
  storeCanReceiveUpdates,
  validateReleaseState,
} from '../scripts/release-state.mjs';

function releaseState(chromeStatus, firefoxStatus) {
  return validateReleaseState({
    schemaVersion: 2,
    initialVersion: '1.0.0',
    policy: 'independent-store-publications',
    stores: {
      chrome: {
        itemId: 'hckohbbpednejhdjbiidmodchebpgpbn',
        listingUrl: 'https://chromewebstore.google.com/detail/hckohbbpednejhdjbiidmodchebpgpbn/',
        status: chromeStatus,
      },
      firefox: {
        addonId: 'odoo-health-ext-cs@daviddemri26.github.io',
        listingUrl: 'https://addons.mozilla.org/en-US/firefox/addon/odoohealthextcs/',
        status: firefoxStatus,
      },
    },
  });
}

test('keeps the development version frozen while no initial store is published', () => {
  const state = releaseState('ready-to-publish', 'pending-review');

  assert.equal(anyStoreCanReceiveUpdates(state), false);
  assert.doesNotThrow(() => assertDevelopmentVersion({ packageJson: { version: '1.0.0' }, state }));
  assert.throws(
    () => assertDevelopmentVersion({ packageJson: { version: '1.0.1' }, state }),
    /Keep package version 1\.0\.0/,
  );
  assert.throws(
    () => assertReleaseUnlocked({ packageJson: { version: '1.0.0' }, state }),
    /Release is locked/,
  );
});

test('allows a newer matching tag when Chrome alone is published', () => {
  const state = releaseState('published', 'pending-review');

  assert.equal(anyStoreCanReceiveUpdates(state), true);
  assert.equal(storeCanReceiveUpdates(state, 'chrome'), true);
  assert.equal(storeCanReceiveUpdates(state, 'firefox'), false);
  assert.doesNotThrow(() =>
    assertReleaseTag({ packageJson: { version: '1.0.1' }, state }, 'v1.0.1'),
  );
  assert.throws(
    () => assertReleaseTag({ packageJson: { version: '1.0.0' }, state }, 'v1.0.0'),
    /must be newer than initial version/,
  );
  assert.throws(
    () => assertReleaseTag({ packageJson: { version: '1.1.0' }, state }, 'v1.0.1'),
    /must match v1\.1\.0/,
  );
});

test('compares semantic release versions numerically', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
});
