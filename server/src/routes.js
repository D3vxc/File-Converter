import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from './config.js';
import { zipFiles } from './engines/archive.js';
import { FORMATS, conversionMap, countConversions, extOf, resolveConversion } from './formats.js';
import { activeJobsFor, createJob, deleteJob, getJob, jobDir, newJobId, publicJob, stats, totalWaiting } from './jobs.js';
import { capabilities } from './tools.js';

const router = Router();
const IMAGE_EXTS = new Set(['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'svg', 'bmp']);

const TOOLS = {
  'merge-pdf': { min: 2, accept: (e) => e === 'pdf', lane: 'light' },
  'split-pdf': { min: 1, max: 1, accept: (e) => e === 'pdf', lane: 'light' },
  'compress-pdf': { min: 1, max: 1, accept: (e) => e === 'pdf', lane: 'heavy' },
  'images-to-pdf': { min: 1, accept: (e) => IMAGE_EXTS.has(e) && (e !== 'bmp' || capabilities.media), lane: 'light' },
  'edit-pdf': { min: 1, max: 1, accept: (e) => e === 'pdf', lane: 'light' },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clientId = (req) => req.ip || 'unknown';

// Reject before receiving bytes when the server or this client is saturated.
function admission(req, res, next) {
  if (totalWaiting() >= config.maxQueuedTotal) {
    res.set('Retry-After', '30');
    return next(new HttpError(503, 'We are very busy right now. Please try again in a moment.'));
  }
  if (activeJobsFor(clientId(req)) >= config.maxActiveJobsPerClient) {
    res.set('Retry-After', '10');
    return next(new HttpError(429, 'You have many files converting already. Let some finish first.'));
  }
  req.jobId = newJobId();
  req.jobInDir = path.join(jobDir(req.jobId), 'in');
  fs.mkdirSync(req.jobInDir, { recursive: true });
  // Clean up if the upload is aborted or rejected.
  res.on('close', () => {
    if (!getJob(req.jobId)) fsp.rm(jobDir(req.jobId), { recursive: true, force: true }).catch(() => {});
  });
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, req.jobInDir),
    filename: (req, file, cb) => {
      req.fileIndex = (req.fileIndex ?? -1) + 1;
      cb(null, `${String(req.fileIndex).padStart(3, '0')}.${extOf(decodeName(file.originalname)) || 'bin'}`);
    },
  }),
  limits: { fileSize: config.maxFileSize, files: config.maxFilesPerRequest, fields: 20, fieldSize: 1024 * 1024 },
});

// Browsers send UTF-8 names but busboy decodes them as latin1.
function decodeName(name) {
  try {
    const utf8 = Buffer.from(name, 'latin1').toString('utf8');
    return utf8.includes('�') ? name : utf8;
  } catch {
    return name;
  }
}

function parseOptions(raw) {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    throw new HttpError(400, 'Invalid options');
  }
}

const inputsOf = (req) =>
  (req.files || []).map((f) => {
    const name = decodeName(f.originalname);
    return { path: f.path, name, ext: extOf(name), size: f.size };
  });

router.get('/formats', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    formats: FORMATS,
    conversions: conversionMap(),
    totalConversions: countConversions(),
    capabilities,
    tools: Object.keys(TOOLS),
    limits: { maxFileSize: config.maxFileSize, maxFiles: config.maxFilesPerRequest, retentionMinutes: config.fileTtlMs / 60000 },
    support: { kofi: config.kofiUrl, buyMeACoffee: config.bmcUrl },
  });
});

router.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  // clientIp lets operators confirm TRUST_PROXY is right (it's the caller's own address).
  res.json({ ok: true, uptime: Math.round(process.uptime()), clientIp: req.ip, queue: stats() });
});

router.post('/convert', admission, upload.array('file', 1), (req, res) => {
  const [input] = inputsOf(req);
  if (!input) throw new HttpError(400, 'No file received');
  const target = extOf(`x.${String(req.body.target || '').toLowerCase()}`);
  const plan = resolveConversion(input.ext, target);
  if (!plan) throw new HttpError(400, `Converting ${input.ext.toUpperCase() || 'this file'} to ${target.toUpperCase()} is not supported`);
  const job = createJob({
    id: req.jobId,
    clientId: clientId(req),
    kind: 'convert',
    lane: plan.lane,
    engine: plan.engine,
    inputs: [input],
    target,
    options: parseOptions(req.body.options),
  });
  res.status(202).json(publicJob(job));
});

router.post('/tools/:tool', admission, upload.array('file', config.maxFilesPerRequest), (req, res) => {
  const tool = TOOLS[req.params.tool];
  if (!tool) throw new HttpError(404, 'Unknown tool');
  const inputs = inputsOf(req);
  if (inputs.length < tool.min) throw new HttpError(400, `Please add at least ${tool.min} file${tool.min > 1 ? 's' : ''}`);
  if (tool.max && inputs.length > tool.max) throw new HttpError(400, `This tool takes ${tool.max} file at a time`);
  const bad = inputs.find((i) => !tool.accept(i.ext));
  if (bad) throw new HttpError(400, `"${bad.name}" is not supported by this tool`);
  const job = createJob({
    id: req.jobId,
    clientId: clientId(req),
    kind: req.params.tool,
    lane: tool.lane,
    inputs,
    target: req.params.tool === 'split-pdf' ? 'zip' : 'pdf',
    options: parseOptions(req.body.options),
  });
  res.status(202).json(publicJob(job));
});

// Batch status: GET /jobs?ids=a,b,c — one request per poll for all of a user's files.
router.get('/jobs', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 100);
  res.json(Object.fromEntries(ids.map((id) => [id, publicJob(getJob(id)) || { id, status: 'missing' }])));
});

router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) throw new HttpError(404, 'This file has expired or does not exist');
  res.set('Cache-Control', 'no-store');
  res.json(publicJob(job));
});

router.get('/jobs/:id/download', (req, res, next) => {
  const job = getJob(req.params.id);
  if (!job || job.status !== 'done') throw new HttpError(404, 'This file has expired or is not ready yet');
  res.set('Cache-Control', 'private, no-store');
  res.download(job.result.path, job.result.name, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) next(new HttpError(404, 'File is no longer available'));
  });
});

router.delete('/jobs/:id', async (req, res) => {
  await deleteJob(req.params.id);
  res.status(204).end();
});

// Download several results as one zip, streamed (nothing buffered in memory).
router.get('/download-zip', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200);
  const done = ids.map(getJob).filter((j) => j?.status === 'done');
  if (!done.length) throw new HttpError(404, 'Nothing to download');
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="converted-files.zip"', 'Cache-Control': 'no-store' });
  await zipFiles(done.map((j) => j.result.path), res, { names: done.map((j) => j.result.name) });
});

// Errors
router.use((req, _res, next) => next(new HttpError(404, 'Not found')));
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File is too large. The limit is ${Math.round(config.maxFileSize / 1024 / 1024)} MB.`
        : err.code === 'LIMIT_FILE_COUNT'
          ? `Too many files. The limit is ${config.maxFilesPerRequest} per upload.`
          : 'Upload failed';
    return res.status(413).json({ error: msg });
  }
  const status = err.status || 500;
  if (status >= 500 && status !== 503) console.error(err);
  if (!res.headersSent) res.status(status).json({ error: status >= 500 && status !== 503 ? 'Something went wrong on our side' : err.message });
  else res.end();
});

export default router;
