// End-to-end: boots the API, uploads generated fixtures, converts, downloads.
// Run with: npm test (from /server)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import AdmZip from 'adm-zip';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.LIGHT_CONCURRENCY = '4';
process.env.HEAVY_CONCURRENCY = '2';
const { createApp } = await import('../src/app.js');
const { tools } = await import('../src/tools.js');

let base;
let server;
const fx = {};

async function makeFixtures() {
  const f = (n) => path.join(tmp, n);
  fx.png = f('photo.png');
  await sharp({ create: { width: 320, height: 200, channels: 4, background: { r: 90, g: 120, b: 250, alpha: 0.8 } } }).png().toFile(fx.png);
  fx.jpg = f('photo.jpg');
  await sharp(fx.png).jpeg().toFile(fx.jpg);
  fx.svg = f('logo.svg');
  await fs.writeFile(fx.svg, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#f60"/></svg>');

  fx.csv = f('people.csv');
  await fs.writeFile(fx.csv, 'name,age,city\nAda,36,London\nLinus,28,Helsinki\nGrace,45,"New York, NY"\n');
  fx.json = f('data.json');
  await fs.writeFile(fx.json, JSON.stringify({ users: [{ id: 1, name: 'Zoë', tags: ['a', 'b'], address: { city: 'Paris' } }, { id: 2, name: 'Ömer' }] }));
  fx.md = f('notes.md');
  await fs.writeFile(fx.md, '# Hello\n\nSome **bold** text and a [link](https://example.com).\n\n- one\n- two\n');
  fx.txt = f('story.txt');
  await fs.writeFile(fx.txt, 'Once upon a time — there was a converter.\n\n'.repeat(80) + 'Unicode: 日本語 ✓');

  fx.docx = f('letter.docx');
  const docx = new AdmZip();
  docx.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  docx.addFile('_rels/.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
  docx.addFile('word/document.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Dear reader, this is a DOCX.</w:t></w:r></w:p></w:body></w:document>'));
  docx.writeZip(fx.docx);

  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage([300, 400]).drawText(`Page ${i + 1}`, { x: 40, y: 300, size: 24 });
  fx.pdf = f('report.pdf');
  await fs.writeFile(fx.pdf, await pdf.save());

  fx.zip = f('bundle.zip');
  const z = new AdmZip();
  z.addFile('a.txt', Buffer.from('alpha'));
  z.addFile('dir/b.txt', Buffer.from('beta'));
  z.writeZip(fx.zip);

  if (tools.ffmpeg) {
    fx.wav = f('tone.wav');
    spawnSync(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', fx.wav]);
    fx.mp4 = f('clip.mp4');
    spawnSync(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fx.mp4]);
    fx.bmp = f('pic.bmp');
    spawnSync(tools.ffmpeg, ['-y', '-i', fx.png, fx.bmp]);
  }
}

async function upload(endpoint, files, fields = {}) {
  const form = new FormData();
  for (const file of [].concat(files)) form.append('file', new Blob([await fs.readFile(file)]), path.basename(file));
  for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  const res = await fetch(base + endpoint, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}

async function waitFor(id, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const job = await (await fetch(`${base}/api/jobs/${id}`)).json();
    if (job.status === 'done' || job.status === 'error') return job;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${id}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function convert(file, target, options) {
  const { status, body } = await upload('/api/convert', file, { target, ...(options ? { options } : {}) });
  assert.equal(status, 202, JSON.stringify(body));
  const job = await waitFor(body.id);
  assert.equal(job.status, 'done', `${path.basename(file)} → ${target}: ${job.error}`);
  const res = await fetch(`${base}/api/jobs/${body.id}/download`);
  assert.equal(res.status, 200);
  return { job, buf: Buffer.from(await res.arrayBuffer()) };
}

before(async () => {
  await makeFixtures();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

describe('meta', () => {
  test('formats lists conversions', async () => {
    const r = await (await fetch(`${base}/api/formats`)).json();
    assert.ok(r.conversions.png.includes('webp'));
    assert.ok(r.totalConversions > 100);
  });
  test('rejects unsupported pair', async () => {
    const { status } = await upload('/api/convert', fx.csv, { target: 'mp4' });
    assert.equal(status, 400);
  });
});

describe('images', () => {
  for (const to of ['jpg', 'webp', 'avif', 'gif', 'tiff', 'ico', 'pdf']) {
    test(`png → ${to}`, async () => {
      const { buf } = await convert(fx.png, to);
      assert.ok(buf.length > 50);
    });
  }
  test('resize + quality', async () => {
    const { buf } = await convert(fx.jpg, 'webp', { width: 100, quality: 50 });
    const meta = await sharp(buf).metadata();
    assert.equal(meta.width, 100);
  });
  test('svg → png', async () => {
    const { buf } = await convert(fx.svg, 'png');
    assert.equal((await sharp(buf).metadata()).format, 'png');
  });
  test('bmp → jpg', { skip: !tools.ffmpeg }, async () => {
    const { buf } = await convert(fx.bmp, 'jpg');
    assert.equal((await sharp(buf).metadata()).format, 'jpeg');
  });
});

describe('media', { skip: !tools.ffmpeg }, () => {
  test('wav → mp3', async () => {
    const { buf } = await convert(fx.wav, 'mp3');
    assert.ok(buf.length > 1000);
  });
  test('wav → ogg/opus/flac', async () => {
    for (const t of ['ogg', 'opus', 'flac']) await convert(fx.wav, t);
  });
  test('mp4 → webm', async () => {
    const { buf } = await convert(fx.mp4, 'webm');
    assert.ok(buf.length > 1000);
  });
  test('mp4 → mkv (fast remux)', async () => await convert(fx.mp4, 'mkv'));
  test('mp4 → gif', async () => await convert(fx.mp4, 'gif', { fps: 8 }));
  test('mp4 → mp3 (extract audio)', async () => await convert(fx.mp4, 'mp3'));
  test('mp4 → mp4 trimmed + 120p', async () => await convert(fx.mp4, 'mp4', { trimStart: 0.5, trimEnd: 1.5, resolution: 120 }));
});

describe('documents & data', () => {
  test('md → html', async () => {
    const { buf } = await convert(fx.md, 'html');
    assert.match(buf.toString(), /<strong>bold<\/strong>/);
  });
  test('txt → pdf (with unicode)', async () => {
    const { buf } = await convert(fx.txt, 'pdf');
    assert.ok((await PDFDocument.load(buf)).getPageCount() >= 2);
  });
  test('docx → md/html/txt', async () => {
    for (const t of ['md', 'html', 'txt']) {
      const { buf } = await convert(fx.docx, t);
      assert.match(buf.toString(), /Dear reader/);
    }
  });
  test('pdf → txt', async () => {
    const { buf } = await convert(fx.pdf, 'txt');
    assert.match(buf.toString(), /Page 2/);
  });
  test('csv → json/xlsx/yaml/xml', async () => {
    const { buf } = await convert(fx.csv, 'json');
    const rows = JSON.parse(buf.toString());
    assert.equal(rows[2].city, 'New York, NY');
    for (const t of ['xlsx', 'yaml', 'xml', 'html', 'tsv']) await convert(fx.csv, t);
  });
  test('json → csv flattens nested', async () => {
    const { buf } = await convert(fx.json, 'csv');
    assert.match(buf.toString(), /address\.city/);
    assert.match(buf.toString(), /Zoë/);
  });
  test('json → xml → json roundtrip-ish', async () => {
    const { buf } = await convert(fx.json, 'xml');
    assert.match(buf.toString(), /<users>/);
  });
  test('zip → tgz', async () => {
    const { buf, job } = await convert(fx.zip, 'tgz');
    assert.equal(job.result.name, 'bundle.tar.gz');
    assert.ok(buf.length > 20);
  });
});

describe('pdf tools', () => {
  test('edit text in place', async () => {
    const { getDocumentProxy } = await import('unpdf');
    const textOf = async (buf) => {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const pages = [];
      for (let p = 1; p <= pdf.numPages; p++) pages.push((await (await pdf.getPage(p)).getTextContent()).items.map((i) => i.str).join(' ').trim());
      return pages;
    };
    // fx.pdf has "Page N" in 24pt Helvetica at (40, 300) on each page.
    const run = { transform: [24, 0, 0, 24, 40, 300], width: 70, height: 24 };
    const edits = [
      { ...run, page: 1, text: 'Page 9' }, // glyphs exist in the original font
      { ...run, page: 2, text: 'Страница 3' }, // needs a substitute Unicode font
    ];
    const { status, body } = await upload('/api/tools/edit-pdf', fx.pdf, { options: { edits } });
    assert.equal(status, 202, JSON.stringify(body));
    const job = await waitFor(body.id);
    assert.equal(job.status, 'done', job.error);
    const buf = Buffer.from(await (await fetch(`${base}/api/jobs/${body.id}/download`)).arrayBuffer());
    assert.deepEqual(await textOf(buf), ['Page 1', 'Page 9', 'Страница 3']);
  });
  test('edit text rejects bad edits', async () => {
    const { body } = await upload('/api/tools/edit-pdf', fx.pdf, { options: { edits: [] } });
    const job = await waitFor(body.id);
    assert.equal(job.status, 'error');
  });
  test('merge', async () => {
    const { body } = await upload('/api/tools/merge-pdf', [fx.pdf, fx.pdf]);
    const job = await waitFor(body.id);
    assert.equal(job.status, 'done');
    const buf = Buffer.from(await (await fetch(`${base}/api/jobs/${body.id}/download`)).arrayBuffer());
    assert.equal((await PDFDocument.load(buf)).getPageCount(), 6);
  });
  test('split ranges', async () => {
    const { body } = await upload('/api/tools/split-pdf', fx.pdf, { options: { ranges: '1, 2-3' } });
    const job = await waitFor(body.id);
    assert.equal(job.status, 'done', job.error);
    assert.match(job.result.name, /\.zip$/);
  });
  test('compress', async () => {
    const { body } = await upload('/api/tools/compress-pdf', fx.pdf);
    assert.equal((await waitFor(body.id)).status, 'done');
  });
  test('images → pdf', async () => {
    const { body } = await upload('/api/tools/images-to-pdf', [fx.png, fx.jpg], { options: { pageSize: 'a4' } });
    const job = await waitFor(body.id);
    assert.equal(job.status, 'done', job.error);
  });
  test('bad page range gives friendly error', async () => {
    const { body } = await upload('/api/tools/split-pdf', fx.pdf, { options: { ranges: '9' } });
    const job = await waitFor(body.id);
    assert.equal(job.status, 'error');
    assert.match(job.error, /does not exist/);
  });
});

describe('load & fairness', () => {
  test('100 concurrent image conversions all complete', async () => {
    const ids = await Promise.all(Array.from({ length: 100 }, async () => (await upload('/api/convert', fx.png, { target: 'webp' })).body.id));
    const res = await (await fetch(`${base}/api/jobs?ids=${ids.join(',')}`)).json();
    assert.equal(Object.keys(res).length, 100);
    const jobs = await Promise.all(ids.map((id) => waitFor(id)));
    assert.ok(jobs.every((j) => j.status === 'done'));
  });
  test('download-zip bundles results', async () => {
    const a = (await upload('/api/convert', fx.png, { target: 'jpg' })).body.id;
    const b = (await upload('/api/convert', fx.png, { target: 'jpg' })).body.id;
    await waitFor(a);
    await waitFor(b);
    const res = await fetch(`${base}/api/download-zip?ids=${a},${b}`);
    const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
    assert.deepEqual(zip.getEntries().map((e) => e.entryName).sort(), ['photo (2).jpg', 'photo.jpg']);
  });
  test('delete removes job', async () => {
    const id = (await upload('/api/convert', fx.png, { target: 'jpg' })).body.id;
    await waitFor(id);
    assert.equal((await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/api/jobs/${id}`)).status, 404);
  });
});

const { capabilities } = await import('../src/tools.js');
describe('office & vector (run where LibreOffice / Poppler are installed)', () => {
  test('docx → pdf', { skip: !capabilities.office }, async () => {
    const { buf } = await convert(fx.docx, 'pdf');
    assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  });
  test('docx → epub / odt / rtf', { skip: !capabilities.office }, async () => {
    for (const t of ['epub', 'odt', 'rtf']) await convert(fx.docx, t);
  });
  test('docx → jpg / png', { skip: !capabilities.officeRaster }, async () => {
    for (const t of ['jpg', 'png']) await convert(fx.docx, t);
  });
  test('docx → svg', { skip: !capabilities.officeSvg }, async () => {
    const { buf } = await convert(fx.docx, 'svg');
    assert.match(buf.toString(), /<svg/);
  });
  test('pdf → svg (zip of pages)', { skip: !capabilities.pdfSvg }, async () => {
    const { job } = await convert(fx.pdf, 'svg');
    assert.match(job.result.name, /\.zip$/);
  });
});
