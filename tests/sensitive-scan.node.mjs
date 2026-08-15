import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listTrackedSourceFiles } from '../scripts/artifact-inputs.mjs';
import { scanSensitiveFiles } from '../scripts/scan-sensitive.mjs';

function createRepository(files) {
  const directory = mkdtempSync(path.join(tmpdir(), 'odoo-health-sensitive-'));
  execFileSync('git', ['init', '-q'], { cwd: directory });
  for (const [relativePath, contents] of Object.entries(files)) {
    writeFileSync(path.join(directory, relativePath), contents);
    execFileSync('git', ['add', relativePath], { cwd: directory });
  }
  return directory;
}

async function scanRepository(repository) {
  return scanSensitiveFiles({
    rootDirectory: repository,
    relativePaths: listTrackedSourceFiles(repository),
  });
}

test('rejects tracked private-key containers before source packaging', async () => {
  const repository = createRepository({
    'signing.key': Buffer.from([0x30, 0x82, 0x01, 0x00]),
    'safe.txt': 'safe\n',
  });

  const result = await scanRepository(repository);
  assert.ok(
    result.failures.includes('signing.key: private key or credential container'),
    result.failures.join('\n'),
  );
});

test('rejects tracked environment files even when dotfiles have no conventional extension', async () => {
  const repository = createRepository({
    '.env': 'AMO_API_SECRET=local-only\n',
    'safe.txt': 'safe\n',
  });

  const result = await scanRepository(repository);
  assert.ok(
    result.failures.includes('.env: environment credential file'),
    result.failures.join('\n'),
  );
});

test('scans text files with no extension for credential material', async () => {
  const privateKey = ['-----BEGIN ', 'PRIVATE KEY-----', '\nlocal-only\n'].join('');
  const repository = createRepository({ CREDENTIALS: privateKey, 'safe.txt': 'safe\n' });

  const result = await scanRepository(repository);
  assert.ok(
    result.failures.includes('CREDENTIALS: private key material'),
    result.failures.join('\n'),
  );
});

test('does not decode binary payloads into credential false positives', async () => {
  const tokenLikeBytes = Buffer.from(['gh', 'p_', 'a'.repeat(24)].join(''));
  const binary = Buffer.concat([Buffer.from([0x00, 0xff, 0x80, 0x01]), tokenLikeBytes]);
  const repository = createRepository({ 'fixture.bin': binary, 'safe.txt': 'safe\n' });

  const result = await scanRepository(repository);
  assert.deepEqual(result.failures, ['fixture.bin: unapproved binary file']);
  assert.ok(!result.failures.some((failure) => failure.includes('GitHub credential')));
});
