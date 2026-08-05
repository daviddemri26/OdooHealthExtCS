import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const releaseType = process.argv[2];
if (!['patch', 'minor', 'major'].includes(releaseType)) {
  throw new Error('Usage: pnpm release -- patch|minor|major');
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  }).trim();
}

const branch = run('git', ['branch', '--show-current'], { capture: true });
if (branch !== 'main') throw new Error('Releases must be created from the main branch.');
if (run('git', ['status', '--porcelain'], { capture: true })) {
  throw new Error('The working tree must be clean before creating a release.');
}

run('git', ['fetch', 'origin', 'main']);
const head = run('git', ['rev-parse', 'HEAD'], { capture: true });
const originHead = run('git', ['rev-parse', 'origin/main'], { capture: true });
if (head !== originHead) throw new Error('Local main must match origin/main before release.');

run('pnpm', ['validate']);
run('pnpm', ['version', releaseType, '--no-git-tag-version']);

const packagePath = path.join(projectRoot, 'package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const version = packageJson.version;
const changelogPath = path.join(projectRoot, 'CHANGELOG.md');
const changelog = await readFile(changelogPath, 'utf8');
const date = new Date().toISOString().slice(0, 10);
const updatedChangelog = changelog.replace(
  '## [Unreleased]',
  `## [Unreleased]\n\n## [${version}] - ${date}\n\n- Release prepared from the documented Unreleased changes.`,
);
await writeFile(changelogPath, updatedChangelog);

run('pnpm', ['install', '--lockfile-only']);
run('pnpm', ['package']);
run('git', ['add', 'package.json', 'pnpm-lock.yaml', 'CHANGELOG.md']);
run('git', ['commit', '-m', `chore(release): v${version}`]);
run('git', ['tag', '-a', `v${version}`, '-m', `OdooHealthExtCS v${version}`]);
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', `v${version}`]);

process.stdout.write(`Released OdooHealthExtCS v${version}.\n`);
