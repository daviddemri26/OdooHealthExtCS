import { readFile } from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

const projectRoot = path.resolve(import.meta.dirname, '..');
const scanRoots = [
  'entrypoints',
  'src',
  'tests',
  'docs',
  'store',
  'assets',
  'icons',
  'public',
  '.github',
  '.output/chrome-mv3',
  '.output/firefox-mv3',
];
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const prohibited = [
  { label: 'captured Odoo session object', pattern: /__session_info__\s*=\s*{/i },
  { label: 'captured CSRF credential', pattern: /csrf_token\s*[:=]\s*["'][a-f0-9]{20,}/i },
  { label: 'embedded Odoo access token', pattern: /access_token=[a-z0-9_-]{20,}/i },
  { label: 'private key material', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'GitHub credential', pattern: /gh[pousr]_[a-z0-9]{20,}/i },
  { label: 'Google API credential', pattern: /AIza[a-z0-9_-]{30,}/i },
  { label: 'known customer fixture', pattern: /Anova Cabinet|Brandon Yu|L[’']Ébéniste/i },
  { label: 'known production record identifier', pattern: /6067287|19622939|7529333/ },
];

const files = await fg(
  scanRoots.map((root) => `${root}/**/*`),
  {
    cwd: projectRoot,
    onlyFiles: true,
    dot: true,
    ignore: ['public/icons/*.png'],
  },
);

const failures = [];
for (const relativePath of files) {
  if (/\.(?:jpe?g|png|webp)$/i.test(relativePath)) {
    if (
      !/^(?:icons|public\/icons|\.output\/(?:chrome|firefox)-mv3\/icons)\/icon-\d+\.png$/.test(
        relativePath,
      )
    ) {
      failures.push(`${relativePath}: unapproved raster image`);
    }
    continue;
  }
  if (!textExtensions.has(path.extname(relativePath))) continue;
  const content = await readFile(path.join(projectRoot, relativePath), 'utf8');
  for (const rule of prohibited) {
    if (rule.pattern.test(content)) failures.push(`${relativePath}: ${rule.label}`);
  }
}

if (failures.length > 0) {
  throw new Error(
    `Sensitive-data scan failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`,
  );
}

process.stdout.write(`Sensitive-data scan passed for ${files.length} files.\n`);
