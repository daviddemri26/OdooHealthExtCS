import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import archiver from 'archiver';
import fg from 'fast-glob';

import { listTrackedSourceFiles, readSourceEntries } from './artifact-inputs.mjs';
import { assertSensitiveFiles } from './scan-sensitive.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const artifactDirectory = path.join(projectRoot, 'artifacts');
const normalizedDate = new Date('2000-01-01T00:00:00.000Z');
const trackedSourceFiles = listTrackedSourceFiles(projectRoot);

// Recheck the exact source-archive allow-list here so direct invocations cannot bypass the scan.
await assertSensitiveFiles({ rootDirectory: projectRoot, relativePaths: trackedSourceFiles });

await rm(artifactDirectory, { recursive: true, force: true });
await mkdir(artifactDirectory, { recursive: true });

async function createZipFromEntries(entries, destination) {
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

async function createDirectoryZip(sourceDirectory, destination) {
  const files = await fg('**/*', {
    cwd: sourceDirectory,
    onlyFiles: true,
    followSymbolicLinks: false,
    dot: true,
  });
  files.sort();
  const entries = await Promise.all(
    files.map(async (relativePath) => {
      const absolutePath = path.join(sourceDirectory, relativePath);
      const fileStats = await lstat(absolutePath);
      if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
        throw new Error(`Only regular build files may enter an artifact: ${relativePath}`);
      }
      return {
        relativePath,
        contents: await readFile(absolutePath),
      };
    }),
  );
  await createZipFromEntries(entries, destination);
}

const chromeName = `OdooHealthExtCS-v${version}-chrome.zip`;
const firefoxName = `OdooHealthExtCS-v${version}-firefox.zip`;
const sourceName = `OdooHealthExtCS-v${version}-source.zip`;

await createDirectoryZip(
  path.join(projectRoot, '.output/chrome-mv3'),
  path.join(artifactDirectory, chromeName),
);
await createDirectoryZip(
  path.join(projectRoot, '.output/firefox-mv3'),
  path.join(artifactDirectory, firefoxName),
);
await createZipFromEntries(
  readSourceEntries(projectRoot, trackedSourceFiles),
  path.join(artifactDirectory, sourceName),
);

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
  sourceFiles: trackedSourceFiles,
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
