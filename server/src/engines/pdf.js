import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { extractText, getDocumentProxy } from 'unpdf';
import { tools } from '../tools.js';
import { run } from './run.js';

const A4 = [595.28, 841.89];

export async function imagesToPdf(inputs, output, { pageSize = 'fit', margin } = {}) {
  const doc = await PDFDocument.create();
  for (const input of inputs) {
    const img = sharp(input, { failOn: 'none' }).rotate();
    const meta = await img.metadata();
    const emb = meta.hasAlpha
      ? await doc.embedPng(await img.png().toBuffer())
      : await doc.embedJpg(await img.jpeg({ quality: 90 }).toBuffer());

    if (pageSize === 'a4' || pageSize === 'letter') {
      const [pw, ph] = pageSize === 'letter' ? [612, 792] : A4;
      const landscape = emb.width > emb.height;
      const W = landscape ? ph : pw;
      const H = landscape ? pw : ph;
      const m = Number(margin ?? 24);
      const s = Math.min((W - 2 * m) / emb.width, (H - 2 * m) / emb.height, 1);
      const w = emb.width * s;
      const h = emb.height * s;
      doc.addPage([W, H]).drawImage(emb, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
    } else {
      const w = emb.width * 0.75;
      const h = emb.height * 0.75;
      doc.addPage([w, h]).drawImage(emb, { x: 0, y: 0, width: w, height: h });
    }
  }
  await fs.writeFile(output, await doc.save());
}

export async function mergePdfs(inputs, output) {
  const out = await PDFDocument.create();
  for (const input of inputs) {
    const src = await PDFDocument.load(await fs.readFile(input), { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  await fs.writeFile(output, await out.save({ useObjectStreams: true }));
}

/** "1-3, 5, 8-" -> [[0,2],[4,4],[7,last]] (0-based, inclusive) */
export function parseRanges(spec, pageCount) {
  if (!spec || !String(spec).trim()) return Array.from({ length: pageCount }, (_, i) => [i, i]);
  const ranges = [];
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d*)\s*(-?)\s*(\d*)\s*$/.exec(part);
    if (!m || (!m[1] && !m[3])) throw new Error(`Invalid page range "${part.trim()}"`);
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : pageCount) : a;
    const lo = Math.max(1, Math.min(a, b));
    const hi = Math.min(pageCount, Math.max(a, b));
    if (lo > pageCount) throw new Error(`Page ${lo} does not exist (document has ${pageCount} pages)`);
    ranges.push([lo - 1, hi - 1]);
  }
  return ranges;
}

export async function splitPdf(input, outDir, baseName, { ranges } = {}) {
  const src = await PDFDocument.load(await fs.readFile(input), { ignoreEncryption: true });
  const parts = parseRanges(ranges, src.getPageCount());
  const files = [];
  for (const [lo, hi] of parts) {
    const doc = await PDFDocument.create();
    const idx = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    (await doc.copyPages(src, idx)).forEach((p) => doc.addPage(p));
    const name = lo === hi ? `${baseName}-page-${lo + 1}.pdf` : `${baseName}-pages-${lo + 1}-${hi + 1}.pdf`;
    const file = path.join(outDir, name);
    await fs.writeFile(file, await doc.save());
    files.push(file);
  }
  return files;
}

export async function compressPdf(input, output, { level = 'ebook', signal } = {}) {
  const settings = { screen: '/screen', ebook: '/ebook', printer: '/printer' }[level] || '/ebook';
  if (tools.gs) {
    await run(tools.gs, [
      '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=${settings}`,
      '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER', `-sOutputFile=${output}`, input,
    ], { signal });
  } else {
    const doc = await PDFDocument.load(await fs.readFile(input), { ignoreEncryption: true });
    await fs.writeFile(output, await doc.save({ useObjectStreams: true }));
  }
  // Never hand back a bigger file than we received.
  const [a, b] = await Promise.all([fs.stat(input), fs.stat(output)]);
  if (b.size >= a.size) await fs.copyFile(input, output);
}

export async function pdfToText(input, output) {
  const pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(input)));
  const { text } = await extractText(pdf, { mergePages: false });
  await fs.writeFile(output, text.map((t) => `${t.trim()}\n`).join('\n\f\n'), 'utf8');
}

export async function pdfToImages({ input, outDir, baseName, to, options = {}, signal }) {
  const dpi = Math.min(300, Math.max(50, Number(options.dpi) || 150));
  const prefix = path.join(outDir, baseName);
  if (tools.pdftoppm) {
    await run(tools.pdftoppm, [to === 'jpg' ? '-jpeg' : '-png', '-r', String(dpi), input, prefix], { signal });
  } else {
    await run(tools.gs, [
      '-dNOPAUSE', '-dBATCH', '-dSAFER', '-dQUIET', `-sDEVICE=${to === 'jpg' ? 'jpeg' : 'png16m'}`,
      `-r${dpi}`, `-sOutputFile=${prefix}-%03d.${to}`, input,
    ], { signal });
  }
  const files = (await fs.readdir(outDir))
    .filter((f) => f.startsWith(baseName) && /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map((f) => path.join(outDir, f));
  return files;
}

/** Plain text -> PDF using a standard font (no external tools). */
export async function textToPdf(text, output) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 11;
  const lineH = size * 1.45;
  const [W, H] = A4;
  const margin = 56;
  const maxW = W - margin * 2;
  // Standard fonts only cover WinAnsi; replace anything else.
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '?');

  const lines = [];
  for (const para of clean.split('\n')) {
    if (!para) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const tryLine = line + word;
      if (font.widthOfTextAtSize(tryLine, size) <= maxW) {
        line = tryLine;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = word.trimStart();
      while (font.widthOfTextAtSize(line, size) > maxW) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxW) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }

  const perPage = Math.floor((H - margin * 2) / lineH);
  for (let i = 0; i < Math.max(1, lines.length); i += perPage) {
    const page = doc.addPage([W, H]);
    lines.slice(i, i + perPage).forEach((l, j) => {
      if (l) page.drawText(l, { x: margin, y: H - margin - (j + 1) * lineH + 4, size, font, color: rgb(0.1, 0.1, 0.12) });
    });
  }
  await fs.writeFile(output, await doc.save());
}

