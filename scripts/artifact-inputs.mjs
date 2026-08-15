import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_GIT_FILE_LIST_BYTES = 16 * 1024 * 1024;

export function listTrackedSourceFiles(projectRoot) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: projectRoot,
    encoding: 'buffer',
    maxBuffer: MAX_GIT_FILE_LIST_BYTES,
  });
  const files = output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error('The source archive cannot be created from an empty Git file list.');
  }

  for (const relativePath of files) {
    if (
      path.isAbsolute(relativePath) ||
      relativePath.includes('\0') ||
      relativePath.includes('\\') ||
      Array.from(relativePath).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f;
      }) ||
      relativePath.split('/').some((segment) => segment === '..')
    ) {
      throw new Error(`Unsafe tracked source path: ${relativePath}`);
    }

    const fileStats = lstatSync(path.join(projectRoot, relativePath));
    if (fileStats.isSymbolicLink()) {
      throw new Error(
        `Tracked symbolic links are not allowed in the source archive: ${relativePath}`,
      );
    }
    if (!fileStats.isFile()) {
      throw new Error(`Only regular tracked files may enter the source archive: ${relativePath}`);
    }
  }

  return files;
}

export function readSourceEntries(projectRoot, relativePaths) {
  return relativePaths.map((relativePath) => ({
    relativePath,
    contents: readFileSync(path.join(projectRoot, relativePath)),
  }));
}
