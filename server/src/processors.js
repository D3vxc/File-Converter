import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { convertArchive, zipFiles } from './engines/archive.js';
import { convertData } from './engines/data.js';
import { convertDoc } from './engines/doc.js';
import { convertImage } from './engines/image.js';
import { convertMedia } from './engines/media.js';
import { convertOffice } from './engines/office.js';
import { compressPdf, imagesToPdf, mergePdfs, pdfToImages, splitPdf } from './engines/pdf.js';
import { editPdfText, parseEdits } from './engines/pdfEdit.js';

const EXT_OUT = { tgz: 'tar.gz' };

export function safeBase(name) {
  const base = name.replace(/\.tar\.gz$/i, '').replace(/\.[^.]+$/, '');
  const clean = base.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || 'file';
}

const outName = (base, ext) => `${base}.${EXT_OUT[ext] || ext}`;

async function finalize(file, name) {
  const { size } = await fs.stat(file);
  return { path: file, name, size };
}

async function rasterize({ pdf, base, to, opts, signal, workDir, outDir }) {
  const pagesDir = path.join(workDir, 'pages');
  await fs.mkdir(pagesDir, { recursive: true });
  const pages = await pdfToImages({ input: pdf, outDir: pagesDir, baseName: base, to, options: opts, signal });
  if (!pages.length) throw new Error('No pages could be rendered');
  if (pages.length === 1) {
    const name = outName(base, to);
    await fs.rename(pages[0], path.join(outDir, name));
    return finalize(path.join(outDir, name), name);
  }
  const zipName = `${base}-${to}.zip`;
  await zipFiles(pages, path.join(outDir, zipName));
  return finalize(path.join(outDir, zipName), zipName);
}

/** Runs one job. Returns { path, name, size } of the result file. */
export async function processJob(job, { signal, onProgress }) {
  const dir = path.join(config.dataDir, job.id);
  const outDir = path.join(dir, 'out');
  const workDir = path.join(dir, 'work');
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });
  const [first] = job.inputs;
  const base = safeBase(first.name);
  const opts = job.options;

  switch (job.kind) {
    case 'convert': {
      const to = job.target;
      const name = outName(base, to);
      const output = path.join(outDir, name);
      const args = { input: first.path, output, from: first.ext, to, options: opts, signal, onProgress, workDir, outDir, title: base };
      switch (job.engine) {
        case 'image':
          await convertImage(args);
          break;
        case 'media':
          await convertMedia(args);
          break;
        case 'doc':
          await convertDoc(args);
          break;
        case 'office':
          await convertOffice(args);
          break;
        case 'data':
          await convertData(args);
          break;
        case 'archive':
          await convertArchive(args);
          break;
        case 'pdfraster':
          return rasterize({ pdf: first.path, base, to, opts, signal, workDir, outDir });
        case 'officeRaster': {
          // Office document -> PDF (LibreOffice) -> one image per page.
          const pdf = path.join(workDir, 'rendered.pdf');
          await convertOffice({ ...args, output: pdf, to: 'pdf' });
          onProgress(0.5);
          return rasterize({ pdf, base, to, opts, signal, workDir, outDir });
        }
        default:
          throw new Error(`Unknown engine ${job.engine}`);
      }
      return finalize(output, name);
    }

    case 'merge-pdf': {
      const name = `${base}-merged.pdf`;
      const output = path.join(outDir, name);
      await mergePdfs(job.inputs.map((i) => i.path), output, { signal });
      return finalize(output, name);
    }

    case 'split-pdf': {
      const parts = await splitPdf(first.path, workDir, base, { ranges: opts.ranges, signal });
      if (parts.length === 1) {
        const name = path.basename(parts[0]);
        await fs.rename(parts[0], path.join(outDir, name));
        return finalize(path.join(outDir, name), name);
      }
      const name = `${base}-split.zip`;
      await zipFiles(parts, path.join(outDir, name));
      return finalize(path.join(outDir, name), name);
    }

    case 'compress-pdf': {
      const name = `${base}-compressed.pdf`;
      const output = path.join(outDir, name);
      await compressPdf(first.path, output, { level: opts.level, signal });
      return finalize(output, name);
    }

    case 'images-to-pdf': {
      const name = `${job.inputs.length > 1 ? `${base}-and-${job.inputs.length - 1}-more` : base}.pdf`;
      const output = path.join(outDir, name);
      let inputs = job.inputs;
      if (inputs.some((i) => i.ext === 'bmp')) {
        const { decodeImageToPng } = await import('./engines/media.js');
        inputs = await Promise.all(
          inputs.map(async (i, k) => {
            if (i.ext !== 'bmp') return i;
            const p = path.join(workDir, `bmp-${k}.png`);
            await decodeImageToPng(i.path, p, signal);
            return { ...i, path: p };
          }),
        );
      }
      await imagesToPdf(inputs.map((i) => i.path), output, { pageSize: opts.pageSize, margin: opts.margin });
      return finalize(output, name);
    }

    case 'edit-pdf': {
      const name = `${base}-edited.pdf`;
      const output = path.join(outDir, name);
      await editPdfText(first.path, output, parseEdits(opts.edits));
      return finalize(output, name);
    }

    default:
      throw new Error(`Unknown job type ${job.kind}`);
  }
}
