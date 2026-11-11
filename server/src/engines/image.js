import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { decodeImageToPng } from './media.js';
import { imagesToPdf } from './pdf.js';

// Many images convert in parallel, so keep each one from grabbing every core
// and keep libvips' cache small to bound memory per process.
sharp.concurrency(Math.max(1, Math.floor(config.cpus / 2)));
sharp.cache({ memory: 64, files: 0, items: 50 });

const clampQ = (q, d = 82) => {
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? Math.min(100, Math.max(1, Math.round(n))) : d;
};
const dim = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(16384, Math.round(n)) : undefined;
};

function open(input, from, animated) {
  return sharp(input, {
    animated,
    failOn: 'none',
    limitInputPixels: 268_402_689,
    ...(from === 'svg' ? { density: 192 } : {}),
  });
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.buf)]);
}

export async function convertImage({ input, output, from, to, options = {}, signal, workDir }) {
  if (from === 'bmp') {
    const tmp = path.join(workDir, 'decoded.png');
    await decodeImageToPng(input, tmp, signal);
    input = tmp;
    from = 'png';
  }

  if (to === 'pdf') return imagesToPdf([input], output, { pageSize: options.pageSize });

  if (to === 'ico') {
    const sizes = [16, 32, 48, 64, 128, 256];
    const images = await Promise.all(
      sizes.map(async (size) => ({
        size,
        buf: await open(input, from, false)
          .rotate()
          .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer(),
      })),
    );
    await fs.writeFile(output, buildIco(images));
    return;
  }

  const animated = ['gif', 'webp'].includes(from) && ['gif', 'webp'].includes(to);
  let img = open(input, from, animated).rotate();

  const width = dim(options.width);
  const height = dim(options.height);
  if (width || height) {
    img = img.resize({
      width,
      height,
      fit: ['cover', 'contain', 'fill', 'inside'].includes(options.fit) ? options.fit : 'inside',
      withoutEnlargement: !options.enlarge,
      background: { r: 255, g: 255, b: 255, alpha: to === 'jpg' ? 1 : 0 },
    });
  }
  if (options.grayscale) img = img.grayscale();
  // sharp strips EXIF/GPS by default (good for privacy); keep only if asked.
  if (options.keepMetadata) img = img.keepMetadata();

  const q = clampQ(options.quality);
  switch (to) {
    case 'jpg':
      img = img.flatten({ background: options.background || '#ffffff' }).jpeg({ quality: q, mozjpeg: true });
      break;
    case 'png':
      img = img.png({ compressionLevel: 9, effort: 7, ...(q < 100 && options.compress ? { palette: true, quality: q } : {}) });
      break;
    case 'webp':
      img = img.webp({ quality: q, effort: 4 });
      break;
    case 'avif':
      img = img.avif({ quality: Math.round(q * 0.7), effort: 3 });
      break;
    case 'gif':
      img = img.gif({ effort: 7 });
      break;
    case 'tiff':
      img = img.tiff({ quality: q, compression: 'lzw' });
      break;
    default:
      throw new Error(`Unsupported image target: ${to}`);
  }
  await img.toFile(output);

  // "Compress" (same format, no resize) must never return a bigger file.
  if (from === to && !width && !height && !options.grayscale) {
    const [a, b] = await Promise.all([fs.stat(input), fs.stat(output)]);
    if (b.size >= a.size) await fs.copyFile(input, output);
  }
}
