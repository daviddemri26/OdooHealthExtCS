import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import fg from 'fast-glob';

import { listTrackedSourceFiles } from './artifact-inputs.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const generatedScanRoots = ['.output/chrome-mv3', '.output/firefox-mv3'];
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const prohibited = [
  { label: 'captured Odoo session object', pattern: /__session_info__\s*=\s*{/i },
  { label: 'captured CSRF credential', pattern: /csrf_token\s*[:=]\s*["'][a-f0-9]{20,}/i },
  { label: 'embedded Odoo access token', pattern: /access_token=[a-z0-9_-]{20,}/i },
  { label: 'private key material', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'GitHub credential', pattern: /gh[pousr]_[a-z0-9]{20,}/i },
  { label: 'Google API credential', pattern: /AIza[a-z0-9_-]{30,}/i },
  {
    label: 'known customer fixture',
    pattern: new RegExp(
      [['Anova', ' Cabinet'].join(''), ['Brandon', ' Yu'].join(''), "L[’']Ébéniste"].join('|'),
      'i',
    ),
  },
  {
    label: 'known production record identifier',
    pattern: new RegExp(
      [['606', '7287'].join(''), ['196', '22939'].join(''), ['752', '9333'].join('')].join('|'),
    ),
  },
];

const prohibitedSourcePaths = [
  {
    label: 'private key or credential container',
    pattern: /(?:^|\/)[^/]+\.(?:jks|key|keystore|p12|pem|pfx)$/i,
  },
  {
    label: 'environment credential file',
    pattern: /(?:^|\/)\.env(?:\..+)?$/i,
  },
];

const approvedRasterDigests = new Map([
  [
    'assets/brand/store-capture-chrome.jpg',
    '748f6197e5420fb3de49e6597ca83419352aa9a0630afdd6c9b5777a31c24ba5',
  ],
  ['icons/icon-16.png', '875cf8da094a21974131547dd0d3e7e4a9f78d8572fecfa696e8fdad61945ede'],
  ['icons/icon-32.png', '862a39650f135dfb61924880cc4705fec42466ac5766badcf93badd14edf2b8d'],
  ['icons/icon-48.png', 'e760ab126ffecfc83473d76f832251838ad35df47c58dcb2e9fe2a07384ae08b'],
  ['icons/icon-64.png', '4668d9b591e078968ec3bd40be2fb3389d37fd22493d5ac203568dcc7f53d304'],
  ['icons/icon-96.png', '718c26578e44f4583bb4fdbaa891be2fd793936a2d00af480bdeaeb0de5bcf92'],
  ['icons/icon-128.png', '90e87b50984a7d4e90444e82952c70653390c2ff80d6b2a0266d862690d74f7c'],
  ['public/icons/icon-16.png', 'e80d60d8cbca3403ace33794f979c4c9ec400a000f8f324af65b3abe7fc897ad'],
  ['public/icons/icon-32.png', '09f7ef64c1fb2577e34fa92d0087543ffa335ae9ead14afcebc9e305fb3c474f'],
  ['public/icons/icon-48.png', '6f55b28608763ab1d304e4d7efe6ed5c5a59ec6ddef271cb6fdbfe2795950687'],
  ['public/icons/icon-96.png', 'a902b6da16e9364595b05c696ff01dfea104a9683cd2121a99280300dac08a09'],
  ['public/icons/icon-128.png', '2da8625e6c9794639f12a4b3b4557be14ac10ea8efc2eeba099231c989f9102d'],
  ['public/icons/icon-256.png', '7f8e6dd53889b2a2df3553e4a29670c0a311f5bf4db7e64d228b983917188a7c'],
  ['public/icons/icon-512.png', '4e1de3db4a6943bc23de1d30df95730a296368635b51c4687d78680b2d99172a'],
]);

function isRasterPath(relativePath) {
  return /\.(?:jpe?g|png|webp)$/i.test(relativePath);
}

function expectedRasterDigest(relativePath) {
  const directDigest = approvedRasterDigests.get(relativePath);
  if (directDigest) return directDigest;

  const generatedIcon = relativePath.match(
    /^\.output\/(?:chrome|firefox)-mv3\/icons\/(icon-\d+\.png)$/,
  );
  return generatedIcon ? approvedRasterDigests.get(`public/icons/${generatedIcon[1]}`) : undefined;
}

export function isProbablyText(bytes) {
  if (bytes.length === 0) return true;
  if (bytes.includes(0)) return false;

  let content;
  try {
    content = utf8Decoder.decode(bytes);
  } catch {
    return false;
  }

  let unexpectedControls = 0;
  for (const character of content) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) {
      unexpectedControls += 1;
    }
  }
  return unexpectedControls / Math.max(content.length, 1) <= 0.01;
}

export async function scanSensitiveFiles({ rootDirectory, relativePaths }) {
  const files = [...new Set(relativePaths)].sort((left, right) => left.localeCompare(right));
  const failures = [];

  for (const relativePath of files) {
    const absolutePath = path.join(rootDirectory, relativePath);
    const fileStats = await lstat(absolutePath);
    if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
      failures.push(`${relativePath}: only regular files may be scanned and packaged`);
      continue;
    }

    for (const rule of prohibitedSourcePaths) {
      if (rule.pattern.test(relativePath)) failures.push(`${relativePath}: ${rule.label}`);
    }

    const bytes = await readFile(absolutePath);
    if (isRasterPath(relativePath)) {
      const approvedDigest = expectedRasterDigest(relativePath);
      const actualDigest = createHash('sha256').update(bytes).digest('hex');
      if (!approvedDigest || actualDigest !== approvedDigest) {
        failures.push(`${relativePath}: unapproved raster image`);
      }
      continue;
    }

    // Do not decode arbitrary bytes as text: that would create token-shaped false positives.
    // Unapproved binaries are rejected outright so no opaque source file bypasses the gate.
    if (!isProbablyText(bytes)) {
      failures.push(`${relativePath}: unapproved binary file`);
      continue;
    }

    const content = utf8Decoder.decode(bytes);
    for (const rule of prohibited) {
      if (rule.pattern.test(content)) failures.push(`${relativePath}: ${rule.label}`);
    }
  }

  return { files, failures };
}

export async function assertSensitiveFiles(options) {
  const result = await scanSensitiveFiles(options);
  if (result.failures.length > 0) {
    throw new Error(
      `Sensitive-data scan failed:\n${result.failures.map((failure) => `- ${failure}`).join('\n')}`,
    );
  }
  return result;
}

export async function collectReleaseScanFiles(rootDirectory) {
  const generatedFiles = await fg(
    generatedScanRoots.map((root) => `${root}/**/*`),
    {
      cwd: rootDirectory,
      onlyFiles: true,
      followSymbolicLinks: false,
      dot: true,
    },
  );
  return [...new Set([...listTrackedSourceFiles(rootDirectory), ...generatedFiles])].sort(
    (left, right) => left.localeCompare(right),
  );
}

async function main() {
  const files = await collectReleaseScanFiles(projectRoot);
  const result = await assertSensitiveFiles({ rootDirectory: projectRoot, relativePaths: files });
  process.stdout.write(`Sensitive-data scan passed for ${result.files.length} files.\n`);
}

const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (entryPoint === fileURLToPath(import.meta.url)) await main();
