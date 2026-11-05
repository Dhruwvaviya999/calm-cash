// Generates the PWA and Apple touch icons from the CalmCash mark (src/app/icon.svg: the emerald
// tile with the sprout). Run after changing the mark, then commit the PNGs:
//
//   node apps/web/scripts/generate-app-icons.mjs
//
// sharp is resolved through Next.js (which ships it for image optimisation), so this script adds
// no dependency of its own.
import { Buffer } from 'node:buffer';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromNext = createRequire(createRequire(import.meta.url).resolve('next/package.json'));
const sharp = requireFromNext('sharp');

const BRAND = '#047755';
const MARK = '#f3fbf7';

const mark = await readFile(join(webRoot, 'src/app/icon.svg'), 'utf8');
const sproutPaths = [...mark.matchAll(/<path d="([^"]+)"\/>/g)].map((match) => match[1]);
if (sproutPaths.length === 0) throw new Error('No sprout paths found in icon.svg.');

/**
 * A full-bleed square (no transparent corners) with the sprout scaled to `share` of the side.
 * Maskable icons keep the sprout inside the central 80 % safe zone; Apple icons are rounded by iOS.
 */
function fullBleed(size, share) {
  const scale = (size * share) / 24;
  const offset = (size - 24 * scale) / 2;
  const paths = sproutPaths.map((d) => `<path d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BRAND}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${MARK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</g>
</svg>`;
}

const outputs = [
  // `any` icons: the mark exactly as in the browser tab (rounded tile, transparent corners).
  { file: 'public/icons/icon-192.png', size: 192, svg: mark },
  { file: 'public/icons/icon-512.png', size: 512, svg: mark },
  // Android adaptive icons crop to a circle or squircle: the sprout stays in the safe zone.
  { file: 'public/icons/maskable-192.png', size: 192, svg: fullBleed(192, 0.5) },
  { file: 'public/icons/maskable-512.png', size: 512, svg: fullBleed(512, 0.5) },
  // iOS home screen: opaque square, rounded by the system. Next.js links it automatically.
  { file: 'src/app/apple-icon.png', size: 180, svg: fullBleed(180, 0.6) },
];

await mkdir(join(webRoot, 'public/icons'), { recursive: true });
for (const { file, size, svg } of outputs) {
  await sharp(Buffer.from(svg), { density: Math.ceil((72 * size) / 32) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(webRoot, file));
  process.stdout.write(`wrote ${file} (${size}×${size})\n`);
}
