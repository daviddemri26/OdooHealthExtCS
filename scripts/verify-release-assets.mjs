import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { listTrackedSourceFiles } from './artifact-inputs.mjs';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_END_RECORD_SEARCH = 65_557;

export function listZipEntries(bytes) {
  const searchStart = Math.max(0, bytes.length - MAX_END_RECORD_SEARCH);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('ZIP end-of-central-directory record is missing.');

  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const directorySize = bytes.readUInt32LE(endOffset + 12);
  const directoryOffset = bytes.readUInt32LE(endOffset + 16);
  const directoryEnd = directoryOffset + directorySize;
  if (directoryEnd > endOffset || directoryEnd > bytes.length) {
    throw new Error('ZIP central directory bounds are invalid.');
  }

  const entries = [];
  let offset = directoryOffset;
  while (offset < directoryEnd) {
    if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error('ZIP central directory entry is invalid.');
    }
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nextOffset = nameStart + fileNameLength + extraLength + commentLength;
    if (nextOffset > directoryEnd) throw new Error('ZIP entry exceeds central directory bounds.');
    const centralName = bytes.subarray(nameStart, nameStart + fileNameLength);

    if (
      localHeaderOffset + 30 > directoryOffset ||
      bytes.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER
    ) {
      throw new Error('ZIP local file header is invalid.');
    }
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const localNameStart = localHeaderOffset + 30;
    const localRecordEnd = localNameStart + localNameLength + localExtraLength;
    if (localRecordEnd > directoryOffset) {
      throw new Error('ZIP local file header exceeds file-data bounds.');
    }
    const localName = bytes.subarray(localNameStart, localNameStart + localNameLength);
    if (!centralName.equals(localName)) {
      throw new Error('ZIP local and central entry names do not match.');
    }

    entries.push(centralName.toString('utf8'));
    offset = nextOffset;
  }
  if (entries.length !== entryCount) {
    throw new Error(
      `ZIP entry count ${entries.length} does not match declared count ${entryCount}.`,
    );
  }
  return entries;
}

export function assertSafeZipEntries(entries, archiveName) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${archiveName} must contain at least one regular file.`);
  }
  if (new Set(entries).size !== entries.length) {
    throw new Error(`${archiveName} contains duplicate ZIP entries.`);
  }
  for (const entry of entries) {
    if (
      typeof entry !== 'string' ||
      entry.length === 0 ||
      entry.endsWith('/') ||
      path.isAbsolute(entry) ||
      entry.includes('\\') ||
      Array.from(entry).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f;
      }) ||
      entry.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error(`Unsafe ZIP entry in ${archiveName}: ${String(entry)}`);
    }
  }
}

function assertSafeSourceFileList(sourceFiles) {
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    throw new Error('Release manifest sourceFiles must be a non-empty array.');
  }
  const sorted = [...sourceFiles].sort((left, right) => left.localeCompare(right));
  if (
    new Set(sourceFiles).size !== sourceFiles.length ||
    !sourceFiles.every((file, i) => file === sorted[i])
  ) {
    throw new Error('Release manifest sourceFiles must be unique and sorted.');
  }
  for (const file of sourceFiles) {
    if (
      typeof file !== 'string' ||
      file.length === 0 ||
      path.isAbsolute(file) ||
      file.includes('\\') ||
      Array.from(file).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f;
      }) ||
      file.split('/').some((segment) => segment === '..')
    ) {
      throw new Error(`Unsafe source archive entry: ${String(file)}`);
    }
  }
}

export async function verifyReleaseAssets({
  artifactDirectory,
  expectedVersion,
  expectedGitSha,
  expectedSourceFiles,
}) {
  const manifest = JSON.parse(
    await readFile(path.join(artifactDirectory, 'release-manifest.json'), 'utf8'),
  );
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `Release manifest version ${manifest.version} does not match ${expectedVersion}.`,
    );
  }
  if (expectedGitSha && manifest.gitSha !== expectedGitSha) {
    throw new Error(`Release manifest gitSha ${manifest.gitSha} does not match ${expectedGitSha}.`);
  }
  assertSafeSourceFileList(manifest.sourceFiles);
  if (expectedSourceFiles && manifest.sourceFiles.join('\n') !== expectedSourceFiles.join('\n')) {
    throw new Error('Release manifest sourceFiles do not match the tracked-source allow-list.');
  }

  if (!Array.isArray(manifest.files) || manifest.files.length !== 3) {
    throw new Error('Release manifest must describe exactly three packages.');
  }
  const expectedNames = [
    `OdooHealthExtCS-v${expectedVersion}-chrome.zip`,
    `OdooHealthExtCS-v${expectedVersion}-firefox.zip`,
    `OdooHealthExtCS-v${expectedVersion}-source.zip`,
  ];
  const actualNames = manifest.files.map((entry) => entry.file).sort();
  if (actualNames.join('\n') !== [...expectedNames].sort().join('\n')) {
    throw new Error(`Unexpected release package set: ${actualNames.join(', ')}`);
  }

  const checksumLines = (await readFile(path.join(artifactDirectory, 'checksums.sha256'), 'utf8'))
    .trim()
    .split('\n');
  const checksums = new Map(
    checksumLines.map((line) => {
      const match = line.match(/^([a-f0-9]{64}) {2}([^/]+)$/);
      if (!match) throw new Error(`Invalid checksum line: ${line}`);
      return [match[2], match[1]];
    }),
  );
  if (checksumLines.length !== expectedNames.length || checksums.size !== expectedNames.length) {
    throw new Error('checksums.sha256 must describe exactly the release packages.');
  }
  for (const expectedName of expectedNames) {
    if (!checksums.has(expectedName)) {
      throw new Error(`checksums.sha256 is missing ${expectedName}.`);
    }
  }

  for (const entry of manifest.files) {
    const bytes = await readFile(path.join(artifactDirectory, entry.file));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.sha256 || digest !== checksums.get(entry.file)) {
      throw new Error(`Checksum mismatch for ${entry.file}.`);
    }
    if (bytes.length !== entry.bytes) throw new Error(`Byte count mismatch for ${entry.file}.`);
    assertSafeZipEntries(listZipEntries(bytes), entry.file);
  }

  const sourceName = `OdooHealthExtCS-v${expectedVersion}-source.zip`;
  const sourceEntries = listZipEntries(await readFile(path.join(artifactDirectory, sourceName)));
  if (sourceEntries.join('\n') !== manifest.sourceFiles.join('\n')) {
    throw new Error('Source ZIP entries do not exactly match release-manifest sourceFiles.');
  }

  return manifest;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  const artifactDirectory = path.resolve(process.argv[2] ?? 'artifacts');
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const expectedVersion =
    process.env.RELEASE_VERSION ??
    JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).version;
  await verifyReleaseAssets({
    artifactDirectory,
    expectedVersion,
    expectedGitSha: process.env.RELEASE_GIT_SHA,
    expectedSourceFiles: listTrackedSourceFiles(projectRoot),
  });
  process.stdout.write(`Verified release assets for ${expectedVersion}.\n`);
}
