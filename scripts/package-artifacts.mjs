import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import archiver from 'archiver';
import fg from 'fast-glob';

const projectRoot = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const artifactDirectory = path.join(projectRoot, 'artifacts');
const normalizedDate = new Date('2000-01-01T00:00:00.000Z');

await rm(artifactDirectory, { recursive: true, force: true });
await mkdir(artifactDirectory, { recursive: true });

async function createZip(sourceDirectory, destination, options = {}) {
  const files = await fg('**/*', {
    cwd: sourceDirectory,
    onlyFiles: true,
    dot: true,
    ignore: options.ignore ?? [],
  });
  files.sort();
  const entries = await Promise.all(
    files.map(async (relativePath) => ({
      relativePath,
      contents: await readFile(path.join(sourceDirectory, relativePath)),
    })),
  );

  await new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const { relativePath, contents } of entries) {
      archive.append(contents, {
        name: relativePath,
        date: normalizedDate,
        mode: 0o644,
      });
    }
    void archive.finalize();
  });
}

const chromeName = `OdooHealthExtCS-v${version}-chrome.zip`;
const firefoxName = `OdooHealthExtCS-v${version}-firefox.zip`;
const sourceName = `OdooHealthExtCS-v${version}-source.zip`;

await createZip(
  path.join(projectRoot, '.output/chrome-mv3'),
  path.join(artifactDirectory, chromeName),
);
await createZip(
  path.join(projectRoot, '.output/firefox-mv3'),
  path.join(artifactDirectory, firefoxName),
);
await createZip(projectRoot, path.join(artifactDirectory, sourceName), {
  ignore: [
    '.git/**',
    '.DS_Store',
    '.env',
    '.env.*',
    '.output/**',
    '.pnpm-store/**',
    '.wxt/**',
    'artifacts/**',
    'coverage/**',
    'node_modules/**',
    '*.log',
    '*.crx',
    '*.xpi',
  ],
});

const names = [chromeName, firefoxName, sourceName];
const entries = [];
for (const name of names) {
  const filePath = path.join(artifactDirectory, name);
  const bytes = await readFile(filePath);
  const fileStats = await stat(filePath);
  entries.push({
    file: name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: fileStats.size,
  });
}

const gitSha = process.env.GITHUB_SHA ?? process.env.GIT_COMMIT_SHA ?? 'local';
const manifest = {
  product: 'OdooHealthExtCS',
  version,
  gitSha,
  builtAt: new Date().toISOString(),
  targets: ['chrome-mv3', 'firefox-mv3'],
  files: entries,
};

await writeFile(
  path.join(artifactDirectory, 'release-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await writeFile(
  path.join(artifactDirectory, 'checksums.sha256'),
  `${entries.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`,
);

process.stdout.write(`Created ${entries.length} release packages in artifacts/.\n`);
