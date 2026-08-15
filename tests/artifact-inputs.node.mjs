import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listTrackedSourceFiles } from '../scripts/artifact-inputs.mjs';

function createRepository() {
  const directory = mkdtempSync(path.join(tmpdir(), 'odoo-health-source-'));
  execFileSync('git', ['init', '-q'], { cwd: directory });
  writeFileSync(path.join(directory, '.gitignore'), '*.pem\nignored/**\n');
  writeFileSync(path.join(directory, 'tracked.txt'), 'safe\n');
  execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: directory });
  return directory;
}

test('source inputs contain only tracked regular files', () => {
  const repository = createRepository();
  mkdirSync(path.join(repository, 'ignored'));
  const ignoredPrivateKeyMarker = ['-----BEGIN ', 'PRIVATE KEY-----', '\n'].join('');
  writeFileSync(path.join(repository, 'ignored.pem'), ignoredPrivateKeyMarker);
  writeFileSync(path.join(repository, 'ignored', 'notes.txt'), 'private notes\n');
  const outside = path.join(repository, '..', `${path.basename(repository)}-untracked-outside.txt`);
  writeFileSync(outside, 'outside\n');
  symlinkSync(outside, path.join(repository, 'untracked-external-link'));

  assert.deepEqual(listTrackedSourceFiles(repository), ['.gitignore', 'tracked.txt']);
});

test('source inputs reject a tracked symbolic link', () => {
  const repository = createRepository();
  const outside = path.join(repository, '..', `${path.basename(repository)}-outside.txt`);
  writeFileSync(outside, 'outside\n');
  symlinkSync(outside, path.join(repository, 'external-link'));
  execFileSync('git', ['add', 'external-link'], { cwd: repository });

  assert.throws(
    () => listTrackedSourceFiles(repository),
    /Tracked symbolic links are not allowed in the source archive: external-link/,
  );
});
