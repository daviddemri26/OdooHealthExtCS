import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertRemoteReleaseTagAbsent,
  incrementVersion,
  pushAtomicRelease,
} from '../scripts/release-git.mjs';

function git(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (error) {
    if (allowFailure) return error;
    throw error;
  }
}

function createRunner(cwd) {
  return (command, args) => {
    assert.equal(command, 'git');
    return git(cwd, args);
  };
}

test('release version increments remain deterministic', () => {
  assert.equal(incrementVersion('1.2.1', 'patch'), '1.2.2');
  assert.equal(incrementVersion('1.2.1', 'minor'), '1.3.0');
  assert.equal(incrementVersion('1.2.1', 'major'), '2.0.0');
  assert.throws(() => incrementVersion('1.2.1-beta.1', 'major'), /Unsupported package version/);
});

test('remote tag preflight and release push use the closed Git commands', () => {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    return '';
  };

  assertRemoteReleaseTagAbsent(run, 'v2.0.0');
  pushAtomicRelease(run, { tag: 'v2.0.0' });

  assert.deepEqual(calls, [
    {
      command: 'git',
      args: ['ls-remote', '--tags', '--refs', 'origin', 'refs/tags/v2.0.0'],
      options: { capture: true },
    },
    {
      command: 'git',
      args: ['push', '--atomic', 'origin', 'main', 'v2.0.0'],
      options: undefined,
    },
  ]);
});

test('the release entrypoint preflights and performs one atomic publication', async () => {
  const releaseScript = await readFile(
    path.resolve(import.meta.dirname, '../scripts/release.mjs'),
    'utf8',
  );

  assert.match(releaseScript, /assertRemoteReleaseTagAbsent\(run, expectedTag\)/);
  assert.match(releaseScript, /pushAtomicRelease\(run, \{ tag: expectedTag \}\)/);
  assert.doesNotMatch(releaseScript, /run\('git', \['push'/);
});

test('an atomic push rejected for the tag cannot partially update remote main', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'odoo-release-atomic-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const remote = path.join(temporaryRoot, 'remote.git');
  const working = path.join(temporaryRoot, 'working');
  await mkdir(working);
  git(temporaryRoot, ['init', '--bare', remote]);
  git(working, ['init']);
  git(working, ['config', 'user.name', 'Release Test']);
  git(working, ['config', 'user.email', 'release-test@example.invalid']);
  await writeFile(path.join(working, 'version.txt'), '1.0.0\n');
  git(working, ['add', 'version.txt']);
  git(working, ['commit', '-m', 'initial']);
  git(working, ['branch', '-M', 'main']);
  git(working, ['remote', 'add', 'origin', remote]);
  git(working, ['push', '-u', 'origin', 'main']);

  const initialRemoteMain = git(working, ['rev-parse', 'origin/main']);
  await writeFile(path.join(working, 'version.txt'), '2.0.0\n');
  git(working, ['add', 'version.txt']);
  git(working, ['commit', '-m', 'release']);
  git(working, ['tag', '-a', 'v2.0.0', '-m', 'v2.0.0']);

  const updateHook = path.join(remote, 'hooks', 'update');
  await writeFile(updateHook, '#!/bin/sh\ncase "$1" in\n  refs/tags/*) exit 1 ;;\nesac\nexit 0\n');
  await chmod(updateHook, 0o755);

  assertRemoteReleaseTagAbsent(createRunner(working), 'v2.0.0');
  assert.throws(
    () => pushAtomicRelease(createRunner(working), { tag: 'v2.0.0' }),
    /Command failed/,
  );
  assert.equal(
    git(working, ['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0],
    initialRemoteMain,
  );
  assert.equal(git(working, ['ls-remote', '--tags', '--refs', 'origin', 'refs/tags/v2.0.0']), '');

  await rm(updateHook);
  pushAtomicRelease(createRunner(working), { tag: 'v2.0.0' });
  assert.equal(
    git(working, ['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0],
    git(working, ['rev-parse', 'HEAD']),
  );
  assert.throws(
    () => assertRemoteReleaseTagAbsent(createRunner(working), 'v2.0.0'),
    /already exists/,
  );
});
