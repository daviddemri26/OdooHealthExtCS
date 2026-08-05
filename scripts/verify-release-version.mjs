import { readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const expectedTag = `v${packageJson.version}`;
const actualTag =
  process.env.GITHUB_REF_NAME ?? process.argv.slice(2).find((argument) => argument !== '--');

if (!actualTag) throw new Error('A release tag is required. Set GITHUB_REF_NAME or pass the tag.');
if (actualTag !== expectedTag) {
  throw new Error(
    `Release tag ${actualTag} does not match package version ${packageJson.version}.`,
  );
}

for (const target of ['chrome-mv3', 'firefox-mv3']) {
  const manifest = JSON.parse(
    await readFile(path.join(projectRoot, '.output', target, 'manifest.json'), 'utf8'),
  );
  if (manifest.version !== packageJson.version) {
    throw new Error(
      `${target} manifest version ${manifest.version} does not match ${packageJson.version}.`,
    );
  }
}

process.stdout.write(`Verified release version ${packageJson.version} for ${actualTag}.\n`);
