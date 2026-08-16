import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const verifiedActionPins = new Map([
  ['actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803', 'v6.1.0'],
  ['pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271', 'v6.0.9'],
  ['actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38', 'v6.5.0'],
  ['actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', 'v7.0.1'],
  ['actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b', 'v5.0.0'],
  ['actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa', 'v3.0.1'],
  ['actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e', 'v4.0.5'],
  ['actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', 'v8.0.1'],
  ['actions/attest-build-provenance@0f67c3f4856b2e3261c31976d6725780e5e4c373', 'v4.1.1'],
  ['google-github-actions/auth@c200f3691d83b41bf9bbd8638997a462592937ed', 'v2.1.13'],
]);

async function read(relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

function jobBlock(workflow, jobName) {
  const escaped = jobName.replaceAll('-', '\\-');
  const match = workflow.match(
    new RegExp(`^  ${escaped}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\n|(?![\\s\\S]))`, 'm'),
  );
  assert.ok(match, `Missing workflow job: ${jobName}`);
  return match[0];
}

test('privileged and package workflows pin every external action to a commit', async () => {
  const seenPins = new Set();
  for (const workflow of [
    '.github/workflows/ci.yml',
    '.github/workflows/pages.yml',
    '.github/workflows/release.yml',
    '.github/workflows/firefox-submit.yml',
  ]) {
    const contents = await read(workflow);
    const references = [...contents.matchAll(/uses:\s+([^\s#]+)\s+#\s+(v\d+\.\d+\.\d+)\s*$/gm)];
    assert.ok(references.length > 0, `${workflow} should use verified external actions`);
    for (const [, reference, version] of references) {
      assert.match(reference, /@[a-f0-9]{40}$/, `${reference} in ${workflow} is not SHA-pinned`);
      assert.equal(
        verifiedActionPins.get(reference),
        version,
        `${reference} in ${workflow} is not one of the live-verified immutable releases`,
      );
      seenPins.add(reference);
    }
  }
  assert.deepEqual(seenPins, new Set(verifiedActionPins.keys()));
});

test('release stays silent and Firefox signs the validated package', async () => {
  const release = await read('.github/workflows/release.yml');
  const recovery = await read('.github/workflows/firefox-submit.yml');
  const updateMetadata = JSON.parse(await read('store/firefox-update.json'));

  assert.doesNotMatch(release, /--generate-notes/);
  assert.match(release, /--notes ""/);
  assert.doesNotMatch(release, /pnpm (?:icons|build:firefox)/);
  assert.match(release, /--source-dir firefox-release/);
  assert.match(release, /--amo-metadata store\/firefox-update\.json/);
  assert.match(recovery, /gh attestation verify/);
  assert.match(recovery, /RELEASE_GIT_SHA/);
  assert.deepEqual(Object.keys(updateMetadata), ['version']);
  assert.deepEqual(Object.keys(updateMetadata.version), ['approval_notes']);
});

test('release isolates dependency builds from publishing privileges', async () => {
  const release = await read('.github/workflows/release.yml');
  const build = jobBlock(release, 'build');
  const attest = jobBlock(release, 'attest');
  const publish = jobBlock(release, 'publish-github');
  const chrome = jobBlock(release, 'chrome');
  const firefox = jobBlock(release, 'firefox');

  assert.match(build, /contents: read/);
  assert.match(build, /persist-credentials: false/);
  assert.match(build, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(build, /contents: write|id-token: write|attestations: write/);

  assert.match(attest, /id-token: write/);
  assert.match(attest, /attestations: write/);
  assert.doesNotMatch(attest, /actions\/checkout|pnpm install|contents: write/);

  assert.match(publish, /contents: write/);
  assert.match(publish, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.match(publish, /gh release (?:create|upload)/);
  assert.doesNotMatch(publish, /actions\/checkout|pnpm install|id-token: write/);
  assert.equal([...release.matchAll(/contents: write/g)].length, 1);

  assert.match(chrome, /persist-credentials: false/);
  assert.match(chrome, /run: node scripts\/publish-chrome\.mjs/);
  assert.doesNotMatch(chrome, /pnpm\/action-setup|pnpm install|pnpm exec/);
  assert.match(firefox, /pnpm install --frozen-lockfile --ignore-scripts/);
});

test('release recovery reuses only the original attested tag artifacts', async () => {
  const release = await read('.github/workflows/release.yml');
  const build = jobBlock(release, 'build');
  const chrome = jobBlock(release, 'chrome');
  const firefox = jobBlock(release, 'firefox');
  const storesDisabled = jobBlock(release, 'stores-disabled');

  assert.match(release, /workflow_dispatch:/);
  assert.match(release, /release_tag:/);
  assert.match(release, /source_run_id:/);
  assert.match(release, /RELEASE_TAG: \$\{\{ inputs\.release_tag \|\| github\.ref_name \}\}/);
  assert.match(build, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(build, /ref: refs\/tags\/\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(build, /git_sha=\$\(git rev-parse HEAD\)/);
  assert.match(build, /gh run download "\$SOURCE_RUN_ID"/);
  assert.match(build, /\.event == "push"/);
  assert.match(build, /\.head_branch == \$tag/);
  assert.match(build, /\.head_sha == \$sha/);
  assert.match(build, /\.path == "\.github\/workflows\/release\.yml"/);
  assert.match(build, /\.name == "build" and \.conclusion == "success"/);
  assert.match(build, /\.name == "attest" and \.conclusion == "success"/);
  assert.match(build, /\.name == "publish-github" and \.conclusion == "failure"/);
  assert.match(build, /\.name == "chrome"/);
  assert.match(build, /startswith\("Firefox —"\)/);
  assert.match(build, /gh attestation verify/);
  assert.match(build, /--source-ref "\$RELEASE_SOURCE_REF"/);
  assert.match(build, /--source-digest "\$RELEASE_GIT_SHA"/);
  assert.match(build, /RELEASE_GIT_SHA: \$\{\{ steps\.identity\.outputs\.git_sha \}\}/);
  assert.match(chrome, /RELEASE_GIT_SHA: \$\{\{ needs\.build\.outputs\.git_sha \}\}/);
  assert.match(firefox, /RELEASE_GIT_SHA: \$\{\{ needs\.build\.outputs\.git_sha \}\}/);
  for (const storeJob of [chrome, firefox, storesDisabled]) {
    assert.match(storeJob, /if: \$\{\{ always\(\)/);
    assert.match(storeJob, /needs\.build\.result == 'success'/);
    assert.match(storeJob, /needs\.publish-github\.result == 'success'/);
  }
  assert.match(chrome, /needs\.build\.outputs\.chrome_ready == 'true'/);
  assert.match(chrome, /vars\.CHROME_PUBLISH_ENABLED == 'true'/);
  assert.match(firefox, /needs\.build\.outputs\.firefox_ready == 'true'/);
  assert.match(firefox, /vars\.FIREFOX_PUBLISH_ENABLED == 'true'/);
  assert.match(storesDisabled, /needs\.build\.outputs\.chrome_ready != 'true'/);
  assert.match(storesDisabled, /vars\.CHROME_PUBLISH_ENABLED != 'true'/);
  assert.match(storesDisabled, /needs\.build\.outputs\.firefox_ready != 'true'/);
  assert.match(storesDisabled, /vars\.FIREFOX_PUBLISH_ENABLED != 'true'/);
  assert.match(release, /if: \$\{\{ github\.event_name == 'push' \}\}[\s\S]*?pnpm package/);
  assert.match(release, /needs\.attest\.result == 'skipped'/);
  assert.doesNotMatch(release, /\$\{\{ github\.sha \}\}|\$GITHUB_REF_NAME/);
});

test('Firefox recovery binds every release asset to the exact tag build identity', async () => {
  const recovery = await read('.github/workflows/firefox-submit.yml');

  assert.match(recovery, /persist-credentials: false/);
  assert.match(recovery, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.match(recovery, /RELEASE_GIT_SHA: \$\{\{ steps\.release\.outputs\.git_sha \}\}/);
  assert.match(
    recovery,
    /RELEASE_SIGNER_WORKFLOW: github\.com\/\$\{\{ github\.repository \}\}\/\.github\/workflows\/release\.yml/,
  );
  assert.match(
    recovery,
    /RELEASE_SOURCE_REF: refs\/tags\/\$\{\{ steps\.release\.outputs\.tag \}\}/,
  );
  assert.match(recovery, /for artifact in artifacts\/\*/);
  assert.match(recovery, /--signer-workflow "\$RELEASE_SIGNER_WORKFLOW"/);
  assert.match(recovery, /--signer-digest "\$RELEASE_GIT_SHA"/);
  assert.match(recovery, /--source-digest "\$RELEASE_GIT_SHA"/);
  assert.match(recovery, /--source-ref "\$RELEASE_SOURCE_REF"/);
  assert.match(recovery, /--predicate-type "https:\/\/slsa\.dev\/provenance\/v1"/);
  assert.match(recovery, /--deny-self-hosted-runners/);
});
