import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(projectRoot, 'assets/brand/odoo-health-ext-cs-icon.svg');
const outputDirectory = path.join(projectRoot, 'public/icons');
const sizes = [16, 32, 48, 96, 128, 256, 512];

try {
  await access(sourcePath);
} catch {
  throw new Error(
    'The approved icon is missing at assets/brand/odoo-health-ext-cs-icon.svg. Tagged releases must not use a placeholder.',
  );
}

const source = await readFile(sourcePath);
await mkdir(outputDirectory, { recursive: true });

await Promise.all(
  sizes.map((size) =>
    sharp(source, { density: 1024 })
      .resize(size, size, { fit: 'contain' })
      .png({ compressionLevel: 9, palette: false })
      .toFile(path.join(outputDirectory, `icon-${size}.png`)),
  ),
);

process.stdout.write(`Generated ${sizes.length} icon sizes from the approved SVG.\n`);
