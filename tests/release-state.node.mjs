import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDevelopmentVersion,
  assertReleaseTag,
  assertReleaseUnlocked,
  compareVersions,
  initialPublicationComplete,
  validateReleaseState,
} from '../scripts/release-state.mjs';

function releaseState(chromeStatus, firefoxStatus) {
  return validateReleaseState({
    schemaVersion: 1,
    initialVersion: '1.0.0',
    policy: 'wait-for-both-initial-publications',
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

test('keeps the development version frozen while either initial review is pending', () => {
  const state = releaseState('pending-review', 'published');

  assert.equal(initialPublicationComplete(state), false);
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

test('allows only a newer matching tag after both initial publications', () => {
  const state = releaseState('published', 'published');

  assert.equal(initialPublicationComplete(state), true);
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
