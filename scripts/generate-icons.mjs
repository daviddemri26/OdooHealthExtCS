import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(projectRoot, 'assets/brand/odoo-health-ext-cs-icon.svg');
const outputDirectory = path.join(projectRoot, 'public/icons');
const sizes = [16, 32, 48, 96, 128, 256, 512];
const shouldWrite = process.argv.slice(2).includes('--write');

try {
  await access(sourcePath);
} catch {
  throw new Error(
    'The approved icon is missing at assets/brand/odoo-health-ext-cs-icon.svg. Tagged releases must not use a placeholder.',
  );
}

const source = await readFile(sourcePath);
if (shouldWrite) await mkdir(outputDirectory, { recursive: true });

await Promise.all(
  sizes.map(async (size) => {
    const destination = path.join(outputDirectory, `icon-${size}.png`);
    const generated = await sharp(source, { density: 1024 })
      .resize(size, size, { fit: 'contain' })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();

    if (shouldWrite) {
      await writeFile(destination, generated);
      return;
    }

    let approved;
    try {
      approved = await readFile(destination);
    } catch {
      throw new Error(
        `The approved ${size}px icon is missing. Run "pnpm icons:generate" and review every generated asset before committing it.`,
      );
    }

    const [generatedPixels, approvedPixels] = await Promise.all([
      sharp(generated).ensureAlpha().raw().toBuffer(),
      sharp(approved).ensureAlpha().raw().toBuffer(),
    ]);
    if (!generatedPixels.equals(approvedPixels)) {
      throw new Error(
        `The approved ${size}px icon no longer matches the source SVG. Run "pnpm icons:generate" and review every generated asset before committing it.`,
      );
    }
  }),
);

process.stdout.write(
  shouldWrite
    ? `Generated ${sizes.length} icon sizes from the approved SVG.\n`
    : `Verified ${sizes.length} approved icon sizes against the source SVG.\n`,
);
