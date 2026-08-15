import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import archiver from 'archiver';

import { listZipEntries, verifyReleaseAssets } from '../scripts/verify-release-assets.mjs';

async function createZip(destination, entries) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const archive = archiver('zip');
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const [name, contents] of entries) archive.append(contents, { name });
    void archive.finalize();
  });
}

async function replaceZipEntryName(zipPath, originalName, replacementName) {
  assert.equal(Buffer.byteLength(originalName), Buffer.byteLength(replacementName));
  const bytes = await readFile(zipPath);
  const original = Buffer.from(originalName);
  const replacement = Buffer.from(replacementName);
  let replacements = 0;
  let offset = 0;
  while ((offset = bytes.indexOf(original, offset)) >= 0) {
    replacement.copy(bytes, offset);
    replacements += 1;
    offset += replacement.length;
  }
  assert.ok(replacements >= 2, 'ZIP entry name should exist in local and central records');
  await writeFile(zipPath, bytes);
}

async function createReleaseFixture(directory, unsafePackageIndex) {
  const version = '2.0.0';
  const names = [
    `OdooHealthExtCS-v${version}-chrome.zip`,
    `OdooHealthExtCS-v${version}-firefox.zip`,
    `OdooHealthExtCS-v${version}-source.zip`,
  ];
  for (const [index, name] of names.entries()) {
    const zipPath = path.join(directory, name);
    await createZip(zipPath, [['safe.txt', 'safe']]);
    if (index === unsafePackageIndex) {
      await replaceZipEntryName(zipPath, 'safe.txt', '../x.txt');
    }
  }
  const files = [];
  for (const file of names) {
    const bytes = await readFile(path.join(directory, file));
    files.push({
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    });
  }
  await writeFile(
    path.join(directory, 'release-manifest.json'),
    JSON.stringify({ version, gitSha: 'abc123', sourceFiles: ['safe.txt'], files }),
  );
  await writeFile(
    path.join(directory, 'checksums.sha256'),
    `${files.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`,
  );
  return { names, version };
}

test('lists ZIP entries from the central directory', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'odoo-health-zip-'));
  const zipPath = path.join(directory, 'source.zip');
  await createZip(zipPath, [
    ['a.txt', 'a'],
    ['nested/b.txt', 'b'],
  ]);
  assert.deepEqual(listZipEntries(await readFile(zipPath)), ['a.txt', 'nested/b.txt']);
});

test('rejects disagreement between local and central ZIP paths', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'odoo-health-zip-mismatch-'));
  const zipPath = path.join(directory, 'source.zip');
  await createZip(zipPath, [['safe.txt', 'safe']]);
  const bytes = await readFile(zipPath);
  const localNameOffset = bytes.indexOf(Buffer.from('safe.txt'));
  assert.ok(localNameOffset >= 0);
  Buffer.from('../x.txt').copy(bytes, localNameOffset);

  assert.throws(() => listZipEntries(bytes), /local and central entry names do not match/);
});

test('verifies checksums, git identity, and exact source entries', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'odoo-health-release-'));
  await mkdir(directory, { recursive: true });
  const version = '2.0.0';
  const names = [
    `OdooHealthExtCS-v${version}-chrome.zip`,
    `OdooHealthExtCS-v${version}-firefox.zip`,
    `OdooHealthExtCS-v${version}-source.zip`,
  ];
  await createZip(path.join(directory, names[0]), [['manifest.json', '{}']]);
  await createZip(path.join(directory, names[1]), [['manifest.json', '{}']]);
  await createZip(path.join(directory, names[2]), [
    ['package.json', '{}'],
    ['src/main.ts', 'export {};'],
  ]);
  const files = [];
  for (const file of names) {
    const bytes = await readFile(path.join(directory, file));
    files.push({
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    });
  }
  await writeFile(
    path.join(directory, 'release-manifest.json'),
    JSON.stringify({
      version,
      gitSha: 'abc123',
      sourceFiles: ['package.json', 'src/main.ts'],
      files,
    }),
  );
  await writeFile(
    path.join(directory, 'checksums.sha256'),
    `${files.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`,
  );

  await assert.doesNotReject(
    verifyReleaseAssets({
      artifactDirectory: directory,
      expectedVersion: version,
      expectedGitSha: 'abc123',
      expectedSourceFiles: ['package.json', 'src/main.ts'],
    }),
  );
});

test('rejects a source manifest that differs from the tracked allow-list', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'odoo-health-release-allowlist-'));
  const version = '2.0.0';
  const names = [
    `OdooHealthExtCS-v${version}-chrome.zip`,
    `OdooHealthExtCS-v${version}-firefox.zip`,
    `OdooHealthExtCS-v${version}-source.zip`,
  ];
  await createZip(path.join(directory, names[0]), [['manifest.json', '{}']]);
  await createZip(path.join(directory, names[1]), [['manifest.json', '{}']]);
  await createZip(path.join(directory, names[2]), [['unexpected.txt', 'unexpected']]);
  const files = [];
  for (const file of names) {
    const bytes = await readFile(path.join(directory, file));
    files.push({
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    });
  }
  await writeFile(
    path.join(directory, 'release-manifest.json'),
    JSON.stringify({
      version,
      gitSha: 'abc123',
      sourceFiles: ['unexpected.txt'],
      files,
    }),
  );
  await writeFile(
    path.join(directory, 'checksums.sha256'),
    `${files.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`,
  );

  await assert.rejects(
    verifyReleaseAssets({
      artifactDirectory: directory,
      expectedVersion: version,
      expectedGitSha: 'abc123',
      expectedSourceFiles: ['package.json'],
    }),
    /tracked-source allow-list/,
  );
});

test('rejects unsafe internal paths in Chrome, Firefox, and source ZIPs', async () => {
  for (const unsafePackageIndex of [0, 1, 2]) {
    const directory = mkdtempSync(path.join(tmpdir(), 'odoo-health-release-unsafe-'));
    const { names, version } = await createReleaseFixture(directory, unsafePackageIndex);

    await assert.rejects(
      verifyReleaseAssets({
        artifactDirectory: directory,
        expectedVersion: version,
        expectedGitSha: 'abc123',
        expectedSourceFiles: ['safe.txt'],
      }),
      new RegExp(`Unsafe ZIP entry in ${names[unsafePackageIndex].replaceAll('.', '\\.')}`),
    );
  }
});
