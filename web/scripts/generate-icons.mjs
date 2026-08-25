/**
 * Generates the favicon set from public/icon-512.png.
 *
 * Run with `npm run icons -w web` after changing the logo. The output is committed, because
 * these are static assets that should not need a build step to exist.
 *
 * favicon.ico is assembled by hand: sharp has no ICO encoder, but the format allows a PNG
 * payload per entry (Vista and later), so an ICO is just a small header wrapped around the
 * PNGs we already generated. Browsers still request /favicon.ico by default, and so do some
 * crawlers, so it is worth having a real one rather than a 404.
 */
import { Buffer } from 'node:buffer';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SOURCE = join(PUBLIC_DIR, 'icon-512.png');

/** [output filename, pixel size, options] */
const PNG_ICONS = [
  ['favicon-16.png', 16],
  ['favicon-32.png', 32],
  ['favicon-48.png', 48],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

/** Sizes bundled into favicon.ico. Keep small — every entry is a full PNG. */
const ICO_SIZES = [16, 32, 48];

async function renderPng(size, { opaque = false } = {}) {
  let pipeline = sharp(SOURCE).resize(size, size, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

  // Apple ignores transparency and composites on black, which turns a dark logo into a
  // smudge. Flatten onto white so the home-screen icon matches the light app icon.
  if (opaque) pipeline = pipeline.flatten({ background: '#ffffff' });

  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

/** Wraps already-encoded PNGs in an ICONDIR + ICONDIRENTRY header. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const DIR_ENTRY_BYTES = 16;
  let offset = header.length + entries.length * DIR_ENTRY_BYTES;

  const directory = entries.map(({ size, data }) => {
    const entry = Buffer.alloc(DIR_ENTRY_BYTES);
    // 0 means 256 in this field; none of our sizes hit that, but encode it correctly anyway.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size, 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...directory, ...entries.map((e) => e.data)]);
}

async function main() {
  for (const [name, size] of PNG_ICONS) {
    const data = await renderPng(size, { opaque: name === 'apple-touch-icon.png' });
    await writeFile(join(PUBLIC_DIR, name), data);
    console.log(`${name.padEnd(22)} ${size}x${size}  ${(data.length / 1024).toFixed(1)} kB`);
  }

  const icoEntries = await Promise.all(
    ICO_SIZES.map(async (size) => ({ size, data: await renderPng(size) })),
  );
  const ico = buildIco(icoEntries);
  await writeFile(join(PUBLIC_DIR, 'favicon.ico'), ico);
  console.log(`${'favicon.ico'.padEnd(22)} ${ICO_SIZES.join('/')}  ${(ico.length / 1024).toFixed(1)} kB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
